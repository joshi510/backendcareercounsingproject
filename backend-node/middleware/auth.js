const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');

// Create JWT token
function createAccessToken(data) {
  const expiresIn = config.jwt.expiresIn; // Already in seconds
  return jwt.sign(
    { sub: String(data.sub), role: data.role },
    config.jwt.secretKey,
    { expiresIn, algorithm: config.jwt.algorithm }
  );
}

// Verify JWT token
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.secretKey, {
      algorithms: [config.jwt.algorithm]
    });
    return payload;
  } catch (error) {
    console.error(`❌ JWT decode error: ${error.name}: ${error.message}`);
    return null;
  }
}

// Middleware to get current user
async function getCurrentUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const userId = payload.sub;
    if (!userId) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const user = await User.findByPk(parseInt(userId, 10));
    if (!user) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    return res.status(401).json({
      detail: 'Could not validate credentials'
    });
  }
}

// Middleware to require specific roles
function requireRole(allowedRoles) {
  return async (req, res, next) => {
    try {
      await getCurrentUser(req, res, () => {
        const userRole = req.user.role;
        if (!allowedRoles.includes(userRole)) {
          return res.status(403).json({
            detail: 'Not enough permissions'
          });
        }
        next();
      });
    } catch (error) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }
  };
}

// Middleware to require admin
function requireAdmin(req, res, next) {
  return requireRole(['ADMIN'])(req, res, next);
}

module.exports = {
  createAccessToken,
  verifyToken,
  getCurrentUser,
  requireRole,
  requireAdmin
};

