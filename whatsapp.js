/**
 * whatsapp.js
 * Sends WhatsApp messages via Twilio — mid-call and post-call.
 */

require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Twilio Sandbox WhatsApp number (use during testing)
// Once approved with Meta, swap to your real WhatsApp Business number
const FROM_WHATSAPP = 'whatsapp:+14155238886';

/**
 * Fires mid-call when Hot intent is detected.
 * Must arrive before the call ends.
 *
 * @param {string} toNumber  - E.164 number e.g. +917054728625
 * @param {string} context   - What the lead said that triggered Hot classification
 */
async function sendMidCallWhatsApp(toNumber, context) {
  const to = `whatsapp:${toNumber}`;
  const body =
    `🔥 *Hot Lead — Mid-Call Alert*\n\n` +
    `The prospect just showed strong buying intent.\n\n` +
    `*What they said:*\n"${context}"\n\n` +
    `*Your contact:* ${process.env.YOUR_NAME} | ${process.env.YOUR_MOBILE}\n\n` +
    `Act on this now — they're still on the call.`;

  try {
    const msg = await client.messages.create({ from: FROM_WHATSAPP, to, body });
    console.log(`[WhatsApp] Mid-call sent → ${msg.sid}`);
    return msg.sid;
  } catch (err) {
    console.error('[WhatsApp] Mid-call send failed:', err.message);
  }
}

/**
 * Fires after the call ends with full conversation context.
 * Section 06 compliance: context, framing, mobile number, resume link.
 *
 * @param {string} toNumber     - E.164 number
 * @param {object} summary      - { transcript, classification, budget, timeline, features, callbackTime }
 */
async function sendFollowUpWhatsApp(toNumber, summary) {
  const to = `whatsapp:${toNumber}`;

  const classEmoji = { HOT: '🔥', WARM: '🌤️', COLD: '🧊' };
  const emoji = classEmoji[summary.classification] || '📞';

  const body =
    `${emoji} *Call Summary — WebCraft E-Commerce Pitch*\n\n` +
    `*Lead classification:* ${summary.classification}\n\n` +
    `*What we discussed:*\n${summary.contextSummary}\n\n` +
    `${summary.budget ? `*Budget mentioned:* ${summary.budget}\n` : ''}` +
    `${summary.timeline ? `*Timeline:* ${summary.timeline}\n` : ''}` +
    `${summary.features ? `*Features they need:* ${summary.features}\n` : ''}` +
    `${summary.callbackTime ? `*Requested callback:* ${summary.callbackTime}\n` : ''}` +
    `\n` +
    `*About me:*\n` +
    `${process.env.YOUR_NAME} | ${process.env.YOUR_MOBILE}\n` +
    `Resume: ${process.env.RESUME_URL}\n\n` +
    `*Architecture:* Built with Twilio Media Streams → Deepgram STT → GPT-4o → ElevenLabs TTS\n` +
    `Real-time classification + mid-call WhatsApp + callback scheduler.`;

  try {
    const msg = await client.messages.create({ from: FROM_WHATSAPP, to, body });
    console.log(`[WhatsApp] Follow-up sent → ${msg.sid}`);
    return msg.sid;
  } catch (err) {
    console.error('[WhatsApp] Follow-up send failed:', err.message);
  }
}

module.exports = { sendMidCallWhatsApp, sendFollowUpWhatsApp };
