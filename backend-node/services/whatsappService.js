const axios = require('axios');
const config = require('../config');

async function sendWhatsAppMessage(phoneNumber, name, email, tempPassword) {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM;
  
  const whatsappCloudApiToken = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const whatsappCloudPhoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;

  const message = `Hello ${name},
Your counsellor account has been created.

Login Email: ${email}
Temporary Password: ${tempPassword}

Please login and change your password immediately.`;

  if (twilioAccountSid && twilioAuthToken && twilioWhatsAppFrom) {
    return await sendViaTwilio(phoneNumber, message, twilioAccountSid, twilioAuthToken, twilioWhatsAppFrom);
  } else if (whatsappCloudApiToken && whatsappCloudPhoneNumberId) {
    return await sendViaWhatsAppCloud(phoneNumber, message, whatsappCloudApiToken, whatsappCloudPhoneNumberId);
  } else {
    console.warn('⚠️ WhatsApp service not configured. Credentials not sent via WhatsApp.');
    console.log(`📱 Would send WhatsApp to: ${phoneNumber}`);
    console.log(`   Message: ${message}`);
    return false;
  }
}

async function sendViaTwilio(phoneNumber, message, accountSid, authToken, fromNumber) {
  try {
    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({
        From: `whatsapp:${fromNumber}`,
        To: `whatsapp:${phoneNumber}`,
        Body: message
      }),
      {
        auth: {
          username: accountSid,
          password: authToken
        }
      }
    );

    if (response.data.sid) {
      console.log(`✅ WhatsApp message sent via Twilio to ${phoneNumber}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Failed to send WhatsApp via Twilio:`, error.message);
    return false;
  }
}

async function sendViaWhatsAppCloud(phoneNumber, message, apiToken, phoneNumberId) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.messages && response.data.messages[0].id) {
      console.log(`✅ WhatsApp message sent via Cloud API to ${phoneNumber}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Failed to send WhatsApp via Cloud API:`, error.message);
    return false;
  }
}

module.exports = {
  sendWhatsAppMessage
};

