/** Interpret a spoken callback request and make the outbound call in IST. */
require('dotenv').config();
const chrono = require('chrono-node');
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const scheduledCallbacks = [];

function hasCallbackRequest(text) {
  return [
    /\b(call|ring)\s*(me|back|again)?\b/i, /\b(speak|talk|catch up)\s+(later|tomorrow|next)/i,
    /\b(not a good time|available (tomorrow|later|next))\b/i,
    /कल.*कॉल|बाद में.*कॉल/i, /రేపు.*కాల్|తర్వాత.*కాల్/i,
  ].some((pattern) => pattern.test(String(text || '')));
}

function parseCallbackTime(text, now = new Date()) {
  const results = chrono.parse(String(text || ''), now, { forwardDate: true });
  let date = results[0]?.start.date();
  if (!date || date <= now) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
  } else if (!results[0].start.isCertain('hour')) {
    // A date without a named hour ('tomorrow morning') gets a predictable 10 AM slot.
    date.setHours(10, 0, 0, 0);
  }
  return {
    date,
    isoString: date.toISOString(),
    humanReadable: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(date),
  };
}

function scheduleCallback(toNumber, text, options = {}) {
  const { date, isoString, humanReadable } = parseCallbackTime(text, options.now || new Date());
  const delay = Math.max(0, date.getTime() - Date.now());
  const createCall = options.createCall || ((to) => client.calls.create({
    url: `${String(process.env.SERVER_URL).replace(/\/$/, '')}/twiml`, to,
    from: process.env.TWILIO_PHONE_NUMBER, statusCallback: `${String(process.env.SERVER_URL).replace(/\/$/, '')}/call-status`, statusCallbackEvent: ['completed'],
  }));
  const timer = setTimeout(async () => {
    try { await createCall(toNumber); console.log(`[Scheduler] Callback dialled: ${toNumber}`); }
    catch (error) { console.error('[Scheduler] Callback failed:', error.message); }
  }, delay);
  // Do not keep a deployment alive solely for a future callback.
  timer.unref?.();
  scheduledCallbacks.push({ toNumber, isoString, humanReadable });
  console.log(`[Scheduler] Callback booked for ${humanReadable}`);
  return { scheduled: true, isoString, humanReadable };
}

module.exports = { scheduleCallback, parseCallbackTime, hasCallbackRequest, scheduledCallbacks };
