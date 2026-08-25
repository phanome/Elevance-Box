/** WhatsApp delivery for the live alert and assignment follow-up. */
require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function whatsappAddress(number) {
  if (!number) throw new Error('WhatsApp destination is missing');
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

function publicAssetUrl(value, fallbackPath) {
  if (value) return value;
  const base = String(process.env.SERVER_URL || '').replace(/\/$/, '');
  return base ? `${base}${fallbackPath}` : null;
}

async function sendMidCallWhatsApp(toNumber, context) {
  const body = `🔥 *High-intent e-commerce enquiry*\n\nThey said: “${context}”\n\nI’m still speaking with them and will send the full requirements after the call.\n\n${process.env.YOUR_NAME || 'Anurag'} | ${process.env.YOUR_MOBILE || '7054728625'}`;
  
  // 1. Send WhatsApp message
  try {
    const message = await client.messages.create({
      from: process.env.WHATSAPP_FROM || 'whatsapp:+14155238886',
      to: whatsappAddress(toNumber),
      body,
    });
    console.log(`[WhatsApp] Mid-call alert queued: ${message.sid}`);
  } catch (error) {
    console.error(`[WhatsApp] Mid-call failed (${error.code}): ${error.message}`);
  }

  // 2. Also send SMS directly (guaranteed delivery for numbers not in WhatsApp sandbox)
  if (process.env.TWILIO_PHONE_NUMBER) {
    try {
      const sms = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: toNumber.startsWith('+') ? toNumber : `+91${toNumber.replace(/\D/g, '')}`,
        body: body.replace(/\*/g, ''),
      });
      console.log(`[SMS] Mid-call alert sent via SMS: ${sms.sid}`);
    } catch (smsError) {
      console.error(`[SMS] Mid-call SMS failed: ${smsError.message}`);
    }
  }
}

async function sendFollowUpWhatsApp(toNumber, summary) {
  const resumeUrl = process.env.RESUME_URL || 'https://drive.google.com/file/d/1-ZClkGrOQ1bl0Is3jTw5u2wzJdxrj9RZ/view?usp=sharing';
  const buildPdfUrl = process.env.BUILD_PDF_URL || 'https://drive.google.com/file/d/1s415slLwLfbIiuKSyTvvdiCcQWHFlTZq/view?usp=sharing';
  const myMobile = process.env.YOUR_MOBILE || '7054728625';
  const myName = process.env.YOUR_NAME || 'Anurag';

  const requirementsList = [
    summary.products ? `• Products: ${summary.products}` : null,
    summary.budget ? `• Budget: ${summary.budget}` : null,
    summary.timeline ? `• Timeline: ${summary.timeline}` : null,
    summary.features ? `• Features: ${summary.features}` : null,
    summary.callbackTime ? `• Scheduled Callback: ${summary.callbackTime}` : null,
  ].filter(Boolean).join('\n');

  const body = `Hi, thank you for taking the time to speak with Priya earlier today!\n\n` +
    `${summary.contextSummary}\n\n` +
    (requirementsList ? `📌 *Key Discussion Points:*\n${requirementsList}\n\n` : '') +
    `📞 *My Direct Number:* ${myMobile}\n` +
    `📄 *My Resume:* ${resumeUrl}\n` +
    `🛠️ *System Architecture & Build:* ${buildPdfUrl}\n\n` +
    `Feel free to call or WhatsApp me directly anytime. Looking forward to connecting further!\n\n` +
    `Best regards,\n${myName}`;

  // 1. Send WhatsApp message
  try {
    const message = await client.messages.create({
      from: process.env.WHATSAPP_FROM || 'whatsapp:+14155238886',
      to: whatsappAddress(toNumber),
      body,
    });
    console.log(`[WhatsApp] Follow-up queued: ${message.sid}`);
  } catch (error) {
    console.error(`[WhatsApp] Follow-up failed (${error.code}): ${error.message}`);
  }

  // 2. Also send SMS directly (guaranteed delivery for numbers not in WhatsApp sandbox)
  if (process.env.TWILIO_PHONE_NUMBER) {
    try {
      const sms = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: toNumber.startsWith('+') ? toNumber : `+91${toNumber.replace(/\D/g, '')}`,
        body: body.replace(/\*/g, ''),
      });
      console.log(`[SMS] Follow-up sent via SMS: ${sms.sid}`);
    } catch (smsError) {
      console.error(`[SMS] Follow-up SMS failed: ${smsError.message}`);
    }
  }
}

module.exports = { sendMidCallWhatsApp, sendFollowUpWhatsApp, publicAssetUrl };
