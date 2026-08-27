/** HTTP entry point and Twilio Media Stream gateway. */
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const { createCallAgent } = require('./agent');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { index: false }));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stream' });
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function publicBaseUrl() {
  return String(process.env.SERVER_URL || '').replace(/\/$/, '');
}
function normalizeIndianNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('A destination number is required');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (raw.startsWith('+')) return `+${digits}`;
  throw new Error('Use an E.164 number or a 10-digit Indian mobile number');
}
function requiredConfiguration() {
  return ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'SERVER_URL'].filter((key) => !process.env[key]);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', configured: requiredConfiguration().length === 0, missing: requiredConfiguration(), time: new Date().toISOString() }));
app.post('/call', async (req, res) => {
  const missing = requiredConfiguration();
  if (missing.length) return res.status(400).json({ success: false, error: `Missing configuration: ${missing.join(', ')}` });
  let to;
  try { to = normalizeIndianNumber(req.body.to || process.env.TARGET_NUMBER); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  try {
    const call = await client.calls.create({
      to, from: process.env.TWILIO_PHONE_NUMBER, url: `${publicBaseUrl()}/twiml`, method: 'POST',
      statusCallback: `${publicBaseUrl()}/call-status`, statusCallbackMethod: 'POST', statusCallbackEvent: ['completed'],
    });
    res.status(201).json({ success: true, callSid: call.sid, to });
  } catch (error) {
    console.error('[Server] Outbound call failed:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});
app.post('/twiml', (req, res) => {
  const base = publicBaseUrl();
  if (!base) return res.status(500).type('text/plain').send('SERVER_URL is not configured');
  const wsUrl = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  let target;
  try {
    target = normalizeIndianNumber(req.body.Called || req.body.To || req.query.to || process.env.WHATSAPP_TARGET || process.env.TARGET_NUMBER);
  } catch (_) {
    target = normalizeIndianNumber(process.env.WHATSAPP_TARGET || process.env.TARGET_NUMBER);
  }
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wsUrl}/stream"><Parameter name="targetNumber" value="${target}" /></Stream></Connect></Response>`);
});
app.post('/call-status', (req, res) => {
  console.log(`[Server] ${req.body.CallSid || 'unknown'}: ${req.body.CallStatus || 'unknown'} (${req.body.CallDuration || 0}s)`);
  res.sendStatus(204);
});

wss.on('connection', (ws) => {
  const agent = createCallAgent(ws);
  ws.on('message', (data) => {
    try { agent.handleTwilioMessage(JSON.parse(data.toString())); }
    catch (error) { console.error('[Server] Bad stream event:', error.message); }
  });
  ws.on('close', () => agent.handleCallEnd().catch((error) => console.error('[Server] End-of-call error:', error.message)));
  ws.on('error', (error) => console.error('[Server] Stream error:', error.message));
});
wss.on('error', (error) => console.error('[Server] WebSocket listener error:', error.message));

const port = Number(process.env.PORT || 3000);
server.on('error', (error) => console.error('[Server] HTTP listener error:', error.message));
if (require.main === module) server.listen(port, () => console.log(`[Server] Listening on :${port}`));
module.exports = { app, server, normalizeIndianNumber, requiredConfiguration };

app.post('/trial-twiml', (_req, res) => {
  res.type('text/xml').send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Gather
        input="speech"
        action="${publicBaseUrl()}/trial-response"
        method="POST"
        speechTimeout="auto"
        language="en-IN"
      >
        <Say>
          Hello Anurag. This is a test of your ElevateBox voice agent.
          Please say something after the beep.
        </Say>
      </Gather>

      <Say>
        I did not hear anything. Goodbye.
      </Say>

      <Hangup/>
    </Response>
  `);
});

app.post('/trial-response', (req, res) => {
  console.log('[Trial] Speech received:', req.body.SpeechResult);

  res.type('text/xml').send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>
        I heard you say: ${String(req.body.SpeechResult || 'nothing').replace(/[<>&'"]/g, '')}
      </Say>
      <Say>
        The Twilio trial integration is working. Goodbye.
      </Say>
      <Hangup/>
    </Response>
  `);
});