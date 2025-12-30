const bcrypt = require('bcryptjs');

// Hash password using bcryptjs (avoids 72-byte limit issue)
async function getPasswordHash(password) {
  return await bcrypt.hash(password, 10);
}

// Verify password (supports plain text for dev mode)
async function verifyPassword(plainPassword, hashedPassword) {
  // TEMP DEV MODE: Check if password_hash is plain text (not bcrypt format)
  // Bcrypt hashes start with $2b$ or $2a$ and are 60 chars long
  if (!hashedPassword.startsWith('$2') || hashedPassword.length < 60) {
    // Plain text comparison for dev mode
    return plainPassword === hashedPassword;
  }
  // Normal bcrypt verification for production
  return await bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = {
  getPasswordHash,
  verifyPassword
};

