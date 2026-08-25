/** The per-call conversation state, sales qualification and live actions. */
require('dotenv').config();
const Groq = require('groq-sdk');
const { createSTT, textToSpeech, audioToTwilioChunks } = require('./voice');
const { sendMidCallWhatsApp, sendFollowUpWhatsApp } = require('./whatsapp');
const { scheduleCallback, hasCallbackRequest } = require('./scheduler');
const { deriveLeadSignal, normalizeClassification } = require('./lead');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are Priya, a warm Indian sales representative for WebCraft Solutions. You are on a live phone call offering custom e-commerce website development.

LANGUAGE: Detect the caller's language from their first real reply. Speak in that same language: English, Hindi, Telugu, or their natural mix. Do not translate their words unnecessarily. Use simple, conversational phone language.

GOAL: Qualify naturally by learning what they sell, approximate product count, budget, launch timeline and important features (payments, catalogue, delivery, admin panel, etc.). Pitch only what is relevant. Ask no more than one question at a time. Be concise: one or two short sentences.

LEAD INTENT CLASSIFICATION (never say the label aloud):
- HOT: High buying intent shown through indirect or direct cues like asking price/rates/charges, how soon you can start, "send me the details/proposal on WhatsApp", wanting to proceed, or asking for samples/quotes.
- WARM: Real interest but has a barrier: budget constraint ("budget is tight", "not much budget"), timing ("call me tomorrow", "busy right now"), or another decision maker ("brother handles this", "need to discuss with my partner").
- COLD: No need, just browsing, not interested, or asking to stop calling.

Return ONLY valid JSON on every turn:
{"speech":"words to say aloud","classification":"HOT|WARM|COLD","action":"none|schedule_callback","actionContext":"exact buying-intent phrase or null","budget":"value or null","products":"what they sell and/or product count or null","timeline":"value or null","features":"value or null","callbackTime":"spoken callback time or null"}

For CALL_STARTED, greet once in English and invite them to continue in English, Hindi or Telugu: "Hi, I’m Priya from WebCraft Solutions. Is this a good time for a quick chat about putting your products online? I can speak English, Hindi, or Telugu."`;

function safeJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try { return JSON.parse(candidate); }
  catch (_) { return { speech: String(raw || 'Could you please repeat that?'), classification: 'WARM', action: 'none' }; }
}

function createCallAgent(ws) {
  let streamSid; let toNumber; let isSpeaking = false; let isProcessing = false;
  let hotWhatsAppSent = false; let callbackScheduled = false; let ended = false; let interim = '';
  let lastClassification = 'WARM';
  const history = [];
  const extracted = { budget: null, products: null, timeline: null, features: null, callbackTime: null };
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  function clearTwilioAudio() {
    if (streamSid && ws.readyState === 1) ws.send(JSON.stringify({ event: 'clear', streamSid }));
  }
  async function play(audio) {
    if (!streamSid || ws.readyState !== 1) return;
    isSpeaking = true;
    for (const payload of audioToTwilioChunks(audio)) {
      if (!isSpeaking || ws.readyState !== 1) break;
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    isSpeaking = false;
  }
  async function processTurn(text, isStart = false) {
    if (isProcessing || ended) return;
    isProcessing = true;
    if (!isStart) { history.push({ role: 'user', content: text }); messages.push({ role: 'user', content: text }); }
    else messages.push({ role: 'user', content: 'CALL_STARTED' });
    try {
      // const completion = await groq.chat.completions.create({
      //   model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b', messages, temperature: 0.35,
      //   max_tokens: 350,
      // });
      const completion = await groq.chat.completions.create({
  model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
  messages,
  temperature: 0.35,
  max_tokens: 350,
  reasoning_effort: 'none',
  reasoning_format: 'hidden',
  response_format: { type: 'json_object' },
});
      const parsed = safeJson(completion.choices[0]?.message?.content);
      const forced = isStart ? null : deriveLeadSignal(text);
      const classification = forced || normalizeClassification(parsed.classification);
      lastClassification = classification;
      ['budget', 'products', 'timeline', 'features', 'callbackTime'].forEach((key) => {
        if (parsed[key] && String(parsed[key]).toLowerCase() !== 'null') extracted[key] = String(parsed[key]);
      });
      const speech = String(parsed.speech || 'Could you please repeat that?').trim();
      messages.push({ role: 'assistant', content: JSON.stringify({ ...parsed, classification, speech }) });
      history.push({ role: 'assistant', content: speech });

      // This is deliberately triggered before TTS, so it can arrive during speech.
      if (classification === 'HOT' && !hotWhatsAppSent && toNumber && !isStart) {
        hotWhatsAppSent = true;
        sendMidCallWhatsApp(toNumber, parsed.actionContext || text).catch((error) => console.error('[Agent] Mid-call WhatsApp failed:', error.message));
      }
      if (!isStart && !callbackScheduled && toNumber && (parsed.action === 'schedule_callback' || hasCallbackRequest(text))) {
        callbackScheduled = true;
        const booking = scheduleCallback(toNumber, parsed.callbackTime || text);
        extracted.callbackTime = booking.humanReadable;
      }
      if (speech) await play(await textToSpeech(speech));
    } catch (error) { console.error('[Agent] Turn failed:', error.message); }
    finally { isProcessing = false; }
  }

  const stt = createSTT((text, isFinal, utteranceEnd) => {
    if (!isFinal && !utteranceEnd) {
      interim = text;
      if (isSpeaking && text.length > 2) { clearTwilioAudio(); isSpeaking = false; }
      return;
    }
    const combined = text || interim;
    interim = '';
    if (combined.trim().length < 2 || isProcessing) return;
    if (isSpeaking) { clearTwilioAudio(); isSpeaking = false; }
    processTurn(combined.trim());
  });

  async function handleCallEnd() {
    if (ended) return;
    ended = true; stt.close();
    if (!toNumber || history.length === 0) return;
    const transcript = history.map((item) => `${item.role === 'user' ? 'Prospect' : 'Priya'}: ${item.content}`).join('\n');
    let contextSummary = transcript.slice(0, 900);
    try {
      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: 'Write a warm, concise 2-3 sentence paragraph as Anurag summarizing the conversation with the prospect. Reference the exact specifics they mentioned (e.g. what they want to sell, their budget, timeline, or requested features). Write naturally like a real person following up after a phone call, not like a robotic log or generic template. Do not invent facts.'
          },
          { role: 'user', content: transcript }
        ],
      });
      contextSummary = completion.choices[0]?.message?.content?.trim() || contextSummary;
    } catch (error) { console.error('[Agent] Summary failed:', error.message); }
    await sendFollowUpWhatsApp(toNumber, { contextSummary, classification: lastClassification, ...extracted }).catch((error) => console.error('[Agent] Follow-up failed:', error.message));
  }

  return {
    handleTwilioMessage(message) {
      if (message.event === 'start') {
        streamSid = message.start.streamSid;
        toNumber = message.start.customParameters?.targetNumber || process.env.WHATSAPP_TARGET;
        processTurn('', true);
      } else if (message.event === 'media') stt.sendAudio(Buffer.from(message.media.payload, 'base64'));
      else if (message.event === 'stop') handleCallEnd();
    },
    handleCallEnd,
  };
}

module.exports = { createCallAgent, safeJson };
