/**
 * voice.js
 * Handles all audio I/O:
 *   STT  — Deepgram real-time transcription (mulaw 8kHz from Twilio)
 *   TTS  — ElevenLabs streaming synthesis (ulaw_8000 back to Twilio)
 */

require('dotenv').config();
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const axios = require('axios');

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Creates a Deepgram live transcription session.
 * Audio format matches Twilio Media Streams: mulaw, 8000 Hz, 1 channel.
 *
 * @param {function} onTranscript  - Called with (text, isFinal)
 * @returns {{ sendAudio, close }}
 */
function createSTT(onTranscript) {
  const connection = deepgramClient.listen.live({
    model: 'nova-2',
    language: 'en-IN',          // English, India locale
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    utterance_end_ms: 1000,     // 1 second of silence = end of utterance
    vad_events: true,
    endpointing: 300,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[Deepgram] Connection open');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data?.channel?.alternatives?.[0];
    if (!alt || !alt.transcript) return;

    const text = alt.transcript.trim();
    const isFinal = data.is_final;

    if (text.length > 0) {
      onTranscript(text, isFinal);
    }
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    // Signal utterance end so agent can process even if Deepgram didn't mark final
    onTranscript('', true, true /* utteranceEnd */);
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[Deepgram] Error:', err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[Deepgram] Connection closed');
  });

  return {
    sendAudio: (chunk) => {
      if (connection.getReadyState() === 1 /* OPEN */) {
        connection.send(chunk);
      }
    },
    close: () => {
      try { connection.finish(); } catch (_) {}
    },
  };
}

/**
 * Converts text to speech using ElevenLabs streaming API.
 * Returns a Buffer of mulaw 8kHz audio ready to stream to Twilio.
 *
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function textToSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

  const response = await axios.post(
    url,
    {
      text,
      model_id: 'eleven_turbo_v2',     // Lowest latency model
      output_format: 'ulaw_8000',       // Twilio-native format, no conversion needed
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/basic',
      },
      responseType: 'arraybuffer',
      timeout: 8000,
    }
  );

  return Buffer.from(response.data);
}

/**
 * Converts a TTS audio buffer into Twilio-compatible media payload chunks.
 * Twilio expects base64-encoded mulaw audio in chunks of ~20ms (160 bytes at 8kHz).
 *
 * @param {Buffer} audioBuffer
 * @returns {string[]}  Array of base64 strings (one per 20ms chunk)
 */
function audioToTwilioChunks(audioBuffer) {
  const CHUNK_SIZE = 160; // 20ms at 8kHz
  const chunks = [];
  for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
    chunks.push(audioBuffer.slice(i, i + CHUNK_SIZE).toString('base64'));
  }
  return chunks;
}

module.exports = { createSTT, textToSpeech, audioToTwilioChunks };
