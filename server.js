/**
 * server.js
 * Entry point — Express HTTP + WebSocket server.
 *
 * Routes:
 *   POST /call          → Trigger outbound call to TARGET_NUMBER
 *   POST /twiml         → Return TwiML to start media stream (Twilio fetches this)
 *   POST /call-status   → Twilio status callback (logs call completion)
 *   GET  /health        → Health check
 *   WS   /stream        → Twilio media stream WebSocket
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const { createCallAgent } = require('./agent');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * POST /call
 * Body (optional): { to: "7054728625" }
 * Triggers an outbound call. Defaults to TARGET_NUMBER in .env.
 */
app.post('/call', async (req, res) => {
  const rawNumber = req.body.to || process.env.TARGET_NUMBER;
  // Normalise to E.164 (+91 prefix for Indian numbers if not already set)
  const toNumber = rawNumber.startsWith('+') ? rawNumber : `+91${rawNumber}`;

  console.log(`[Server] Initiating call to ${toNumber}`);

  try {
    const call = await client.calls.create({
      url: `${process.env.SERVER_URL}/twiml`,
      to: toNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log(`[Server] Call created — SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid, to: toNumber });
  } catch (err) {
    console.error('[Server] Call creation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /twiml
 * Twilio fetches this when the call is answered.
 * Returns TwiML that starts a bi-directional media stream to our WebSocket.
 */
app.post('/twiml', (req, res) => {
  // Use wss:// if SERVER_URL is https, ws:// if http
  const wsUrl = process.env.SERVER_URL.replace(/^https/, 'wss').replace(/^http/, 'ws');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}/stream">
      <Parameter name="targetNumber" value="${process.env.WHATSAPP_TARGET}" />
    </Stream>
  </Connect>
</Response>`;

  console.log('[Server] Serving TwiML for incoming answer');
  res.type('text/xml').send(twiml);
});

/**
 * POST /call-status
 * Twilio status callback — logs call lifecycle events.
 */
app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  console.log(`[Server] Call status — SID: ${CallSid} | Status: ${CallStatus} | Duration: ${CallDuration}s`);
  res.sendStatus(200);
});

// ─── WebSocket — Twilio Media Stream ─────────────────────────────────────────

wss.on('connection', (ws, req) => {
  console.log('[Server] New WebSocket connection from Twilio');

  const agent = createCallAgent(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      agent.handleTwilioMessage(msg);
    } catch (err) {
      console.error('[Server] WebSocket message parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[Server] WebSocket closed — call ended');
    agent.handleCallEnd().catch(console.error);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     ElevateBox AI Voice Agent — Server Running       ║');
  console.log(`║     Port: ${PORT}                                        ║`);
  console.log(`║     Webhook: ${process.env.SERVER_URL || 'Set SERVER_URL in .env'}  ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║     Test number:  ${process.env.TARGET_NUMBER || 'Set TARGET_NUMBER in .env'}               ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  To trigger a call:                                  ║');
  console.log('║    curl -X POST http://localhost:3000/call           ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});
