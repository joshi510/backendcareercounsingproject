const express = require('express');
const router = express.Router();
const { getCurrentUser, requireRole } = require('../middleware/auth');

const requireStudent = requireRole(['STUDENT']);
const requireCounsellor = requireRole(['COUNSELLOR']);
const requireAdmin = requireRole(['ADMIN']);

// GET /test/student
router.get('/student', getCurrentUser, requireStudent, async (req, res) => {
  return res.json({
    message: 'Student access granted',
    user_id: req.user.id,
    user_email: req.user.email,
    user_role: req.user.role
  });
});

// GET /test/counsellor
router.get('/counsellor', getCurrentUser, requireCounsellor, async (req, res) => {
  return res.json({
    message: 'Counsellor access granted',
    user_id: req.user.id,
    user_email: req.user.email,
    user_role: req.user.role
  });
});

// GET /test/admin
router.get('/admin', getCurrentUser, requireAdmin, async (req, res) => {
  return res.json({
    message: 'Admin access granted',
    user_id: req.user.id,
    user_email: req.user.email,
    user_role: req.user.role
  });
});

module.exports = router;

