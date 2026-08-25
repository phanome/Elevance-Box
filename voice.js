/** Real-time STT and Twilio-compatible TTS. */
require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');

function createSTT(onTranscript) {
  const url =
    'wss://api.deepgram.com/v1/listen' +
    '?model=nova-3' +
    '&language=multi' +
    '&encoding=mulaw' +
    '&sample_rate=8000' +
    '&channels=1' +
    '&punctuate=true' +
    '&smart_format=true' +
    '&interim_results=true' +
    '&utterance_end_ms=1000' +
    '&vad_events=true' +
    '&endpointing=300';

  console.log('[Deepgram] Connecting to live STT...');

  const connection = new WebSocket(url, {
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    },
  });

  let opened = false;

  connection.on('open', () => {
    opened = true;
    console.log('[Deepgram] Connected to live STT');
  });

  connection.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'Results') {
        const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim();
        if (!transcript) return;

        console.log(
          `[Deepgram] Transcript (${data.is_final ? 'final' : 'interim'}):`,
          transcript
        );

        onTranscript(
          transcript,
          Boolean(data.is_final),
          false
        );
      }

      if (data.type === 'UtteranceEnd') {
        console.log('[Deepgram] Utterance end');
        onTranscript('', false, true);
      }
    } catch (error) {
      console.error('[Deepgram] Message parse error:', error.message);
    }
  });

  connection.on('error', (error) => {
    console.error('[Deepgram] WS error:', error.message);
  });

  connection.on('close', (code, reason) => {
    console.log('[Deepgram] Closed:', code, reason?.toString());
    opened = false;
  });

  return {
    sendAudio(chunk) {
      if (opened && connection.readyState === WebSocket.OPEN) {
        connection.send(chunk);
      }
    },

    close() {
      try {
        if (
          connection.readyState === WebSocket.OPEN ||
          connection.readyState === WebSocket.CONNECTING
        ) {
          connection.close();
        }
      } catch (_) {}
    },
  };
}

async function textToSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!voiceId || !process.env.ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs credentials are missing');
  }

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.25,
        use_speaker_boost: true,
      },
    },
    {
      params: {
        output_format: 'ulaw_8000',
      },
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 12000,
    }
  );

  return Buffer.from(response.data);
}

function audioToTwilioChunks(audioBuffer) {
  const chunks = [];

  for (let offset = 0; offset < audioBuffer.length; offset += 160) {
    chunks.push(
      audioBuffer.subarray(offset, offset + 160).toString('base64')
    );
  }

  return chunks;
}

module.exports = {
  createSTT,
  textToSpeech,
  audioToTwilioChunks,
};