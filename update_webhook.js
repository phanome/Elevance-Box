const twilio = require('twilio');
require('dotenv').config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function run() {
  try {
    const allNumbers = await client.incomingPhoneNumbers.list();
    const target = process.env.TWILIO_PHONE_NUMBER.replace(/\D/g, ''); // strip non-digits

    const match = allNumbers.find(num => num.phoneNumber.replace(/\D/g, '').includes(target));

    if (!match) {
      console.log('No matching phone number found. Available numbers:', allNumbers.map(n => n.phoneNumber));
      return;
    }

    const sid = match.sid;
    const webhookUrl = `${process.env.SERVER_URL}/twiml`;

    await client.incomingPhoneNumbers(sid).update({
      voiceUrl: webhookUrl,
      voiceMethod: 'POST'
    });

    console.log(`Successfully updated webhook for ${match.phoneNumber} to ${webhookUrl}`);
  } catch (err) {
    console.error('Error updating webhook:', err.message);
  }
}

run();
