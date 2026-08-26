# ElevateBox multilingual voice agent

An outbound e-commerce sales agent built for the ElevateBox SDE Intern assignment. It calls on demand, handles English, Hindi, Telugu and code-switched replies, qualifies the prospect naturally, and acts while the call is still live.

## What it does

- Places an outbound Twilio call with `POST /call`.
- Streams the live call through Deepgram multilingual STT and ElevenLabs multilingual low-latency TTS.
- Uses an LLM plus deterministic intent guardrails to classify every lead as Hot, Warm, or Cold.
- Sends a WhatsApp alert immediately for Hot intent, before speaking the next answer.
- Interprets spoken callback requests into an IST appointment and redials automatically.
- Sends a contextual post-call WhatsApp including the lead details, your mobile number, resume, and the included [architecture image](assets/architecture.svg).

## Run it

```bash
npm install
cp .env.example .env
npm test
npm start
```

Expose the server through a public HTTPS tunnel and set `SERVER_URL` to that URL. Then start a call:

```bash
curl -X POST http://localhost:3000/call
```

Check the configuration without making a call:

```bash
curl http://localhost:3000/health
```

Twilio trial accounts can call only verified destinations. The receiving phone must also join the configured Twilio WhatsApp Sandbox before sandbox messages can arrive.

## Required configuration

Fill every service credential in `.env`. Set `YOUR_NAME` and `YOUR_MOBILE`; they are included in the recipient-facing follow-up. Put your PDF resume at `assets/resume.pdf`, or set `RESUME_URL` to an HTTPS URL. The server publicly exposes that directory as `/assets`, so the build image is available at:

```text
https://YOUR_SERVER_URL/assets/architecture.svg
```

Set `BUILD_IMAGE_URL` only if you prefer a different public architecture image. Twilio must be able to fetch both attachment URLs.

## Submission note (under 200 words)

**What Works**
- Outbound call + real-time voice pipeline — Twilio dials the target, Deepgram transcribes live audio (English/Hindi/Telugu).
- Lead qualification — rule-based intent guardrails layered over the LLM reliably classify HOT/WARM/COLD without hallucinating the label aloud.
- Mid-call SMS alert — fires before Priya speaks her next line, so the recruiter gets a live signal while the prospect is still on the call.
- Post-call follow-up SMS — AI-generated, specific to what was discussed, with resume and repo links attached.
- Callback scheduling — spoken times parsed to IST and redialed automatically via cron.

**What Does Not**
- The Twilio WhatsApp Sandbox can only send messages to numbers that have first texted a join code to Twilio — so you can't message a stranger's WhatsApp cold without their prior opt-in. SMS covers this but lacks rich media.

**What I Would Build Next**
- Move callbacks to a durable queue (Redis + BullMQ).
- Persist call records and transcripts to a database.
- Add end-to-end tests using Twilio test credentials.
