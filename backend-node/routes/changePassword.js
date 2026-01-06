const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { getCurrentUser } = require('../middleware/auth');
const { getPasswordHash, verifyPassword } = require('../middleware/password');

router.post('', getCurrentUser, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    if (!current_password || !new_password) {
      return res.status(400).json({
        detail: 'Current password and new password are required'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        detail: 'New password must be at least 8 characters long'
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        detail: 'User not found'
      });
    }

    const passwordValid = await verifyPassword(current_password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        detail: 'Current password is incorrect'
      });
    }

    const hashedNewPassword = await getPasswordHash(new_password);
    
    await user.update({
      password_hash: hashedNewPassword,
      is_first_login: false
    });

    console.log(`✅ Password changed for user: ${user.email}`);

    return res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error(`❌ Error in change_password: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to change password'
    });
  }
});

module.exports = router;

