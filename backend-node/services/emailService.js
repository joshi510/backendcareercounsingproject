const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function initializeEmailService() {
  if (transporter) {
    return transporter;
  }

  const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.warn('⚠️ Email service not configured. SMTP credentials missing.');
    return null;
  }

  try {
    transporter = nodemailer.createTransport(emailConfig);
    console.log('✅ Email service initialized');
    return transporter;
  } catch (error) {
    console.error('❌ Failed to initialize email service:', error.message);
    return null;
  }
}

async function sendCounsellorCredentials(email, name, tempPassword, loginUrl) {
  const emailTransporter = initializeEmailService();
  
  if (!emailTransporter) {
    console.warn('⚠️ Email service not available. Credentials not sent via email.');
    console.log(`📧 Would send email to: ${email}`);
    console.log(`   Name: ${name}`);
    console.log(`   Temp Password: ${tempPassword}`);
    return false;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your Counsellor Account Credentials',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
          .credentials { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #3b82f6; }
          .button { display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
          .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Career Profiling Platform</h1>
          </div>
          <div class="content">
            <p>Hello <strong>${name}</strong>,</p>
            <p>Your counsellor account has been created successfully.</p>
            
            <div class="credentials">
              <h3>Your Login Credentials:</h3>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Temporary Password:</strong> <code style="background-color: #f3f4f6; padding: 4px 8px; border-radius: 4px;">${tempPassword}</code></p>
            </div>

            <div class="warning">
              <p><strong>⚠️ Important:</strong> You will be required to change your password on first login.</p>
            </div>

            <p>Please login using the following link:</p>
            <a href="${loginUrl}" class="button">Login Now</a>

            <p>If the button doesn't work, copy and paste this URL into your browser:</p>
            <p style="word-break: break-all; color: #3b82f6;">${loginUrl}</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hello ${name},

Your counsellor account has been created successfully.

Your Login Credentials:
Email: ${email}
Temporary Password: ${tempPassword}

⚠️ Important: You will be required to change your password on first login.

Please login using this URL: ${loginUrl}

This is an automated message. Please do not reply.
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error.message);
    return false;
  }
}

module.exports = {
  sendCounsellorCredentials,
  initializeEmailService
};

