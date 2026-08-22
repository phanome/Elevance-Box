# ElevateBox AI Voice Agent — 100% Free Setup

Outbound AI sales agent. Calls a number, speaks English, classifies the lead as Hot/Warm/Cold,
fires a WhatsApp mid-call if hot, schedules callbacks, and sends a follow-up WhatsApp.

**Total cost: ₹0 / $0**

---

## Free Stack

| Service | Free tier | Sign-up link |
|---------|-----------|-------------|
| **Twilio** | $15.50 trial credit, no card to start | twilio.com |
| **Groq** | Free LLM API (Llama 3.3 70B), no card | groq.com |
| **Deepgram** | 45,000 min/month free | deepgram.com |
| **ElevenLabs** | 10,000 chars/month free | elevenlabs.io |
| **Twilio WhatsApp Sandbox** | Free | (inside Twilio console) |
| **ngrok** | Free 1 tunnel | ngrok.com |

---

## Setup — Step by Step

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Create .env
```bash
cp .env.example .env
```

### Step 3 — Get your free API keys

#### Twilio (free trial — $15.50 included)
1. Go to **twilio.com** → Sign up (no credit card)
2. Verify your phone number during sign-up
3. In the console: note your **Account SID** and **Auth Token**
4. Go to **Phone Numbers → Manage → Buy a number** (costs $1 from trial credit — pick a US number)
5. **IMPORTANT (free trial restriction):** You can only call *verified* numbers on the trial.
   - Go to **Phone Numbers → Verified Caller IDs → Add a new number**
   - Add `+917054728625` (your test number) — Twilio will call/SMS it to verify
   - Add `+918688664337` (the live number) the same way before the live call

#### Groq (completely free, no card)
1. Go to **groq.com** → Sign up
2. Click **API Keys** → **Create API Key**
3. Copy it into `.env` as `GROQ_API_KEY`

#### Deepgram (free tier)
1. Go to **deepgram.com** → Sign up
2. Dashboard → **API Keys** → **Create a Key**
3. Copy into `.env` as `DEEPGRAM_API_KEY`

#### ElevenLabs (free tier)
1. Go to **elevenlabs.io** → Sign up
2. Click your profile icon → **API Key** → Copy
3. Copy into `.env` as `ELEVENLABS_API_KEY`
4. Use Voice ID `21m00Tcm4TlvDq8ikWAM` (Rachel — works well for sales calls)

#### Twilio WhatsApp Sandbox (free)
1. Twilio Console → **Messaging → Try it out → Send a WhatsApp message**
2. From your phone (7054728625), send `join <sandbox-word>` to `+1 415 523 8886`
3. You'll now receive WhatsApp messages from the sandbox

### Step 4 — Start ngrok
```bash
ngrok http 3000
```
Copy the `https://xxxx.ngrok.io` URL → paste into `.env` as `SERVER_URL`

### Step 5 — Start the server
```bash
npm run dev
```

---

## Make the Test Call (7054728625)

Make sure `.env` has:
```
TARGET_NUMBER=7054728625
WHATSAPP_TARGET=+917054728625
```

Then:
```bash
curl -X POST http://localhost:3000/call
```

**Answer the call and:**
- Speak in English — bot responds naturally
- Say "how much does this cost?" → WhatsApp arrives on your phone while still on call (🔥 Hot)
- Say "call me tomorrow morning" → callback gets scheduled
- After hanging up → follow-up WhatsApp arrives with full summary

---

## Switch to Live Call (8688664337)

1. First verify `+918688664337` in Twilio Console → Verified Caller IDs
2. Update `.env`:
```
TARGET_NUMBER=8688664337
WHATSAPP_TARGET=+918688664337
```
3. Trigger:
```bash
curl -X POST http://localhost:3000/call
```

---

## Architecture

```
curl POST /call
      │
   Twilio (outbound) ──── dials number ────►  Caller
      │                                          │
   /twiml ◄── audio ────────────────────────────┘
      │
   WebSocket /stream (bidirectional audio)
      │
   agent.js
      ├── voice.js → Deepgram STT (real-time transcript)
      ├── agent.js → Groq Llama 3.3 70B (classify + respond)
      ├── voice.js → ElevenLabs TTS (mulaw audio → Twilio)
      ├── HOT? → whatsapp.js → Twilio WhatsApp (fires mid-call)
      ├── Callback? → scheduler.js → cron/setTimeout
      └── Call ends → whatsapp.js → follow-up WhatsApp
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot call unverified number" | Add number to Verified Caller IDs in Twilio console |
| No audio in call | Check ElevenLabs API key and voice ID |
| No transcription | Check Deepgram API key |
| WhatsApp not arriving | Join WhatsApp sandbox from target phone first |
| ngrok URL expired | Restart ngrok and update SERVER_URL in .env |
| Groq rate limit | You have 6000 req/day free — more than enough |
