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

The prototype makes the outbound call itself and keeps a bidirectional Twilio Media Stream open for the conversation. Deepgram transcribes in real time; the LLM keeps language and sales context while rule-based signals protect key Hot, Warm, and Cold decisions. A Hot signal sends WhatsApp asynchronously before the agent speaks its next reply, while callback phrases are converted to an IST time and scheduled. After the call the system writes a concise, specific follow-up and attaches the resume and architecture diagram.

Before a live submission I would move callback jobs from process memory to a durable queue, add authenticated webhook signature validation, persist call records, and add end-to-end tests with Twilio test credentials. A live run still requires the supplied API keys, a public HTTPS URL, a verified Twilio destination, and WhatsApp sandbox opt-in when using the sandbox.
