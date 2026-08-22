/**
 * scheduler.js
 * Parses natural language callback requests and schedules outbound calls.
 * Uses chrono-node for NLP date parsing and node-cron for scheduling.
 */

require('dotenv').config();
const chrono = require('chrono-node');
const cron = require('node-cron');
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory store of scheduled callbacks
const scheduledCallbacks = [];

/**
 * Detects if the transcript contains a callback request.
 * Returns true if phrases like "call me tomorrow", "ring me later", etc. are found.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasCallbackRequest(text) {
  const patterns = [
    /call\s*(me|back|again)/i,
    /ring\s*(me|back)/i,
    /try\s*(me\s*)?(again|later|tomorrow)/i,
    /speak\s*later/i,
    /not\s*(a\s*)?good\s*time/i,
    /catch\s*(me|you)\s*(later|tomorrow)/i,
    /available\s*(tomorrow|later|next)/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Parses a natural language time reference from speech transcript.
 * Defaults to tomorrow 10 AM if it can't parse a specific time.
 *
 * @param {string} text  - Full transcript chunk containing callback request
 * @returns {{ isoString: string, humanReadable: string }}
 */
function parseCallbackTime(text) {
  const now = new Date();

  // Try chrono-node first
  const results = chrono.parse(text, now, { forwardDate: true });
  let parsed = results.length > 0 ? results[0].start.date() : null;

  // If no specific time found, default to tomorrow 10 AM
  if (!parsed || parsed < now) {
    parsed = new Date(now);
    parsed.setDate(parsed.getDate() + 1);
    parsed.setHours(10, 0, 0, 0);
  }

  // If only a date was found (no time), default to 10 AM
  if (results.length > 0 && !results[0].start.isCertain('hour')) {
    parsed.setHours(10, 0, 0, 0);
  }

  const humanReadable = parsed.toLocaleString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  return { date: parsed, isoString: parsed.toISOString(), humanReadable };
}

/**
 * Schedules a callback call to the given number at the parsed time.
 *
 * @param {string} toNumber  - E.164 number
 * @param {string} text      - Original transcript for time extraction
 * @returns {{ scheduled: boolean, humanReadable: string }}
 */
function scheduleCallback(toNumber, text) {
  const { date, humanReadable } = parseCallbackTime(text);
  const now = new Date();
  const msUntilCall = date.getTime() - now.getTime();

  if (msUntilCall < 0) {
    console.warn('[Scheduler] Parsed time is in the past, defaulting to +1 hour');
    date.setHours(date.getHours() + 1);
  }

  console.log(`[Scheduler] Callback scheduled for: ${humanReadable}`);

  // Use setTimeout for near-term callbacks (< 24h), cron for longer
  if (msUntilCall < 24 * 60 * 60 * 1000) {
    setTimeout(async () => {
      console.log(`[Scheduler] Firing callback to ${toNumber}`);
      try {
        await client.calls.create({
          url: `${process.env.SERVER_URL}/twiml`,
          to: toNumber,
          from: process.env.TWILIO_PHONE_NUMBER,
        });
      } catch (err) {
        console.error('[Scheduler] Callback call failed:', err.message);
      }
    }, msUntilCall);
  } else {
    // For longer schedules, build a cron expression
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const cronExpr = `${minute} ${hour} ${day} ${month} *`;

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[Scheduler] Cron firing callback to ${toNumber}`);
      try {
        await client.calls.create({
          url: `${process.env.SERVER_URL}/twiml`,
          to: toNumber,
          from: process.env.TWILIO_PHONE_NUMBER,
        });
      } catch (err) {
        console.error('[Scheduler] Cron callback failed:', err.message);
      }
      task.destroy();
    });
  }

  scheduledCallbacks.push({ toNumber, scheduledFor: date.toISOString(), humanReadable });
  return { scheduled: true, humanReadable };
}

module.exports = { scheduleCallback, parseCallbackTime, hasCallbackRequest };
