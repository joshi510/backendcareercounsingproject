const express = require('express');
const router = express.Router();
const { User, UserRole, Counsellor } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');
const { getPasswordHash } = require('../middleware/password');
const { sendCounsellorCredentials } = require('../services/emailService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

function generateTemporaryPassword() {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '@#$%';
  
  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  const allChars = uppercase + lowercase + numbers + special;
  for (let i = password.length; i < 8; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

router.post('', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const { name, email, phone_number } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        detail: 'Name and email are required'
      });
    }

    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({
        detail: 'Invalid email format'
      });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        detail: 'Email already registered'
      });
    }

    const tempPassword = generateTemporaryPassword();
    const hashedPassword = await getPasswordHash(tempPassword);

    const transaction = await User.sequelize.transaction();

    try {
      const newUser = await User.create({
        email,
        password_hash: hashedPassword,
        full_name: name,
        role: UserRole.COUNSELLOR,
        is_first_login: true
      }, { transaction });

      await Counsellor.create({
        user_id: newUser.id
      }, { transaction });

      await transaction.commit();

      const loginUrl = process.env.FRONTEND_URL 
        ? `${process.env.FRONTEND_URL}/login`
        : 'http://localhost:5173/login';

      const emailSent = await sendCounsellorCredentials(
        email,
        name,
        tempPassword,
        loginUrl
      );

      let whatsappSent = false;
      if (phone_number) {
        const cleanPhone = phone_number.replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          whatsappSent = await sendWhatsAppMessage(
            cleanPhone,
            name,
            email,
            tempPassword
          );
        }
      }

      console.log(`✅ Counsellor created: ${email}`);
      console.log(`   Email sent: ${emailSent}`);
      console.log(`   WhatsApp sent: ${whatsappSent}`);

      return res.status(201).json({
        message: 'Counsellor created successfully',
        counsellor: {
          id: newUser.id,
          email: newUser.email,
          full_name: newUser.full_name,
          role: newUser.role
        },
        notifications: {
          email_sent: emailSent,
          whatsapp_sent: whatsappSent
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error(`❌ Error in create_counsellor: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: 'Failed to create counsellor'
    });
  }
});

module.exports = router;

