/**
 * agent.js
 * Core AI agent — orchestrates STT, LLM, TTS, classification, and mid-call actions.
 * LLM: Groq (free) running Llama 3.3 70B — OpenAI-compatible API, zero cost.
 *
 * Flow per WebSocket connection:
 *   1. Twilio sends start event → capture streamSid, greet caller
 *   2. Twilio sends audio chunks → Deepgram transcribes in real-time
 *   3. On final transcript → GPT-4o processes → classify intent
 *   4. If HOT → fire mid-call WhatsApp immediately
 *   5. If callback mentioned → schedule callback
 *   6. GPT-4o response → ElevenLabs → stream audio back to Twilio
 *   7. Call ends → send follow-up WhatsApp with full context
 */

require('dotenv').config();
const Groq = require('groq-sdk');
const { createSTT, textToSpeech, audioToTwilioChunks } = require('./voice');
const { sendMidCallWhatsApp, sendFollowUpWhatsApp } = require('./whatsapp');
const { scheduleCallback, hasCallbackRequest } = require('./scheduler');

// Groq is 100% free — sign up at groq.com, no credit card needed
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Priya, a friendly and professional sales representative from WebCraft Solutions.
You are calling a potential client to introduce professional e-commerce website development services.

LANGUAGE RULE: Speak ONLY in English. Do not switch to any other language under any circumstances.

YOUR GOAL:
- Have a natural, human-sounding conversation (not a robotic script)
- Gently uncover the prospect's needs: what they sell, their budget, how many products, timeline, features they need
- Pitch e-commerce website development as the solution to their business goals
- Never fire questions like a list — weave them naturally into conversation
- Handle vague answers gracefully ("my budget is flexible" → ask a range)

CLASSIFICATION (internal — never say these words out loud):
After EVERY user message, decide their intent:
  HOT  → Asking about price, timeline, ready to proceed, saying "yes let's do it", "how much", "when can you start"
  WARM → Interested but has a barrier: budget concerns, needs time to decide, decision-maker is someone else
  COLD → Just curious, no real need, shutting down the conversation

ACTIONS (respond with JSON when taking an action, otherwise respond with plain speech):

When you speak to the user, respond with EXACTLY this JSON:
{
  "speech": "What you want to say out loud",
  "classification": "HOT" | "WARM" | "COLD",
  "action": "none" | "whatsapp" | "schedule_callback",
  "actionContext": "The sentence(s) that triggered this action (if any)",
  "budget": "extracted budget or null",
  "timeline": "extracted timeline or null",
  "features": "extracted features or null",
  "callbackTime": "natural language time if scheduling, or null"
}

CONVERSATION STYLE:
- Sound like a real person calling from a phone
- Keep responses SHORT — 1-3 sentences max per turn
- Do NOT over-explain or list things
- It is okay to be slightly warm and personable
- If they seem busy, offer to call back

OPENING LINE (first message, use this verbatim):
"Hi, am I speaking with the right person? I'm Priya from WebCraft Solutions — we help businesses set up their online stores. Is this a good time to talk for two minutes?"`;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a new agent instance per WebSocket connection (per call).
 *
 * @param {WebSocket} ws  - Twilio media stream WebSocket
 * @returns {object}      - { handleTwilioMessage, handleCallEnd }
 */
function createCallAgent(ws) {
  let streamSid = null;
  let callSid = null;
  let toNumber = null;
  let isSpeaking = false;          // True while bot is playing audio
  let isProcessing = false;        // True while GPT-4o is running
  let hotWhatsAppSent = false;     // Ensure mid-call WA fires only once
  let callbackScheduled = false;   // Ensure callback fires only once
  let interimBuffer = '';          // Accumulates interim transcripts
  let finalBuffer = '';            // Accumulates final transcripts for context

  // Full conversation log for follow-up
  const conversationHistory = [];
  const extractedData = { budget: null, timeline: null, features: null, callbackTime: null };

  // ── STT setup ───────────────────────────────────────────────────────────────
  const stt = createSTT((text, isFinal, isUtteranceEnd) => {
    if (isFinal || isUtteranceEnd) {
      const combined = (interimBuffer + ' ' + text).trim();
      if (combined.length < 2) return;

      // If bot is speaking, interrupt it
      if (isSpeaking) {
        clearTwilioAudio();
        isSpeaking = false;
      }

      if (!isProcessing) {
        finalBuffer = combined;
        interimBuffer = '';
        processUserTurn(combined);
      }
    } else {
      // Accumulate interim results
      interimBuffer = text;

      // Interrupt bot if caller starts talking
      if (isSpeaking && text.length > 3) {
        clearTwilioAudio();
        isSpeaking = false;
      }
    }
  });

  // ── GPT-4o conversation state ────────────────────────────────────────────────
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Send a clear event to Twilio to stop any buffered audio mid-stream. */
  function clearTwilioAudio() {
    if (streamSid && ws.readyState === 1) {
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    }
  }

  /** Stream base64 audio chunks to Twilio. */
  async function streamAudioToTwilio(audioBuffer) {
    if (!streamSid || ws.readyState !== 1) return;

    isSpeaking = true;
    const chunks = audioToTwilioChunks(audioBuffer);

    for (const payload of chunks) {
      if (!isSpeaking) break; // Interrupted
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
      // Small yield to allow interruption checks (non-blocking)
      await new Promise((r) => setImmediate(r));
    }

    isSpeaking = false;
  }

  /** Call GPT-4o, parse response, speak, and trigger actions. */
  async function processUserTurn(userText) {
    if (isProcessing) return;
    isProcessing = true;

    console.log(`[Agent] User said: "${userText}"`);
    conversationHistory.push({ role: 'user', content: userText });
    messages.push({ role: 'user', content: userText });

    try {
      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3.6-27b',
        messages,
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0].message.content;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        // Fallback if GPT doesn't return valid JSON
        parsed = { speech: raw, classification: 'WARM', action: 'none' };
      }

      const { speech, classification, action, actionContext, budget, timeline, features, callbackTime } = parsed;

      // Log classification
      console.log(`[Agent] Classification: ${classification} | Action: ${action}`);

      // Update extracted data
      if (budget) extractedData.budget = budget;
      if (timeline) extractedData.timeline = timeline;
      if (features) extractedData.features = features;
      if (callbackTime) extractedData.callbackTime = callbackTime;

      // Push assistant message back to GPT context
      messages.push({ role: 'assistant', content: raw });
      conversationHistory.push({ role: 'assistant', content: speech });

      // ── Action: Mid-call WhatsApp (HOT) ──────────────────────────────────────
      if (classification === 'HOT' && !hotWhatsAppSent && toNumber) {
        hotWhatsAppSent = true;
        console.log('[Agent] 🔥 HOT lead detected — firing mid-call WhatsApp');
        // Fire async, don't block conversation
        sendMidCallWhatsApp(toNumber, actionContext || userText).catch(console.error);
      }

      // ── Action: Schedule callback ─────────────────────────────────────────────
      if (
        (action === 'schedule_callback' || hasCallbackRequest(userText)) &&
        !callbackScheduled &&
        toNumber
      ) {
        callbackScheduled = true;
        const result = scheduleCallback(toNumber, callbackTime || userText);
        console.log(`[Agent] 📅 Callback scheduled: ${result.humanReadable}`);
        extractedData.callbackTime = result.humanReadable;
      }

      // ── Speak the response ────────────────────────────────────────────────────
      if (speech && speech.trim().length > 0) {
        try {
          const audioBuffer = await textToSpeech(speech);
          await streamAudioToTwilio(audioBuffer);
        } catch (ttsErr) {
          console.error('[Agent] TTS error:', ttsErr.message);
        }
      }
    } catch (err) {
      console.error('[Agent] GPT-4o error:', err.message);
    } finally {
      isProcessing = false;
    }
  }

  /** Called immediately when call connects — bot speaks the opening line. */
  async function greet() {
    console.log('[Agent] Call connected, sending greeting');
    await processUserTurn('[CALL_STARTED]');
  }

  // ── Public interface ──────────────────────────────────────────────────────────

  /**
   * Handle incoming Twilio media stream events.
   * @param {object} msg  - Parsed Twilio WebSocket message
   */
  function handleTwilioMessage(msg) {
    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        // Extract the called number from custom parameters if available
        toNumber = process.env.WHATSAPP_TARGET;
        console.log(`[Agent] Stream started — SID: ${streamSid}`);
        greet();
        break;

      case 'media':
        // Decode base64 mulaw audio and send to Deepgram
        const audioChunk = Buffer.from(msg.media.payload, 'base64');
        stt.sendAudio(audioChunk);
        break;

      case 'stop':
        console.log('[Agent] Stream stopped');
        stt.close();
        break;

      default:
        break;
    }
  }

  /**
   * Called when WebSocket closes (call ended).
   * Sends follow-up WhatsApp with full context.
   */
  async function handleCallEnd() {
    console.log('[Agent] Call ended — preparing follow-up WhatsApp');
    stt.close();

    // Build context summary from conversation history
    const transcript = conversationHistory
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? 'Prospect' : 'Agent'}: ${m.content}`)
      .join('\n');

    // Use GPT-4o to write a human follow-up summary
    let contextSummary = transcript;
    try {
      const summaryCompletion = await groq.chat.completions.create({
        model: 'qwen/qwen3.6-27b',
        messages: [
          {
            role: 'system',
            content:
              'You write short, professional post-call WhatsApp summaries. ' +
              'Write as if a real salesperson is summarizing the call to their manager. ' +
              'Under 120 words. Reference specific things the prospect actually said.',
          },
          {
            role: 'user',
            content: `Transcript:\n${transcript}\n\nWrite the call summary now.`,
          },
        ],
        max_tokens: 200,
        temperature: 0.5,
      });
      contextSummary = summaryCompletion.choices[0].message.content;
    } catch (err) {
      console.error('[Agent] Summary generation failed:', err.message);
    }

    // Final classification from last assistant message
    const lastMessages = messages.filter((m) => m.role === 'assistant').slice(-1);
    let lastClassification = 'WARM';
    if (lastMessages.length > 0) {
      try {
        const parsed = JSON.parse(lastMessages[0].content);
        lastClassification = parsed.classification || 'WARM';
      } catch (_) {}
    }

    if (toNumber) {
      await sendFollowUpWhatsApp(toNumber, {
        contextSummary,
        classification: lastClassification,
        ...extractedData,
      });
    }
  }

  return { handleTwilioMessage, handleCallEnd };
}

module.exports = { createCallAgent };
