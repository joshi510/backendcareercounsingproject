const express = require('express');
const router = express.Router();
const { User, UserRole } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');
const { getPasswordHash } = require('../middleware/password');

const CENTERS = ['CG', 'SG', 'Nikol', 'Maninagar', 'Surat', 'Rajkot'];

// GET /admin/users - List users with optional role filter, pagination, search, and center filter
router.get('/', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    console.log('🔵 GET /admin/users called with query:', req.query);
    const { Op } = require('sequelize');
    const { role, page, limit, search, center } = req.query;
    
    // Parse pagination
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const offset = (pageNum - 1) * limitNum;
    
    // Validate pagination
    if (pageNum < 1) {
      return res.status(400).json({ detail: 'Page must be greater than 0' });
    }
    if (limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ detail: 'Limit must be between 1 and 100' });
    }
    
    const where = {};
    
    if (role && role !== 'all') {
      // Normalize COUNSELOR (single L) to COUNSELLOR (double L) for database query
      const normalizedRole = role === 'COUNSELOR' ? UserRole.COUNSELLOR : role;
      where.role = normalizedRole;
      console.log(`🔵 Filtering by role: ${role} -> ${normalizedRole}`);
    }

    // Add center filter
    if (center && center !== 'all' && center !== 'undefined' && String(center).trim() !== '') {
      where.center = String(center).trim();
      console.log(`🔵 Filtering by center: "${where.center}"`);
    } else {
      console.log(`🔵 No center filter applied (center: ${center})`);
    }

    // Add search filter (will be combined with center filter using AND)
    if (search && String(search).trim() !== '') {
      where[Op.or] = [
        { email: { [Op.like]: `%${search}%` } },
        { full_name: { [Op.like]: `%${search}%` } }
      ];
    }
    
    console.log('🔵 Final where clause:', JSON.stringify(where, null, 2));

    // Get total count
    const totalRecords = await User.count({ where });

    // Fetch users with pagination
    const users = await User.findAll({
      where,
      attributes: ['id', 'email', 'full_name', 'role', 'center', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
      limit: limitNum,
      offset: offset
    });

    const totalPages = Math.ceil(totalRecords / limitNum);

    console.log(`✅ Found ${users.length} users (page ${pageNum} of ${totalPages})`);

    return res.json({
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        center: user.center || null,
        created_at: user.created_at,
        updated_at: user.updated_at
      })),
      pagination: {
        total_records: totalRecords,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('❌ Error fetching users:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ detail: 'Failed to fetch users' });
  }
});

// POST /admin/users - Create counselor (or other admin users)
router.post('/', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const { email, password, full_name, role, center } = req.body;

    // Validation
    if (!email || !password || !full_name) {
      return res.status(400).json({ detail: 'Email, password, and full name are required' });
    }

    if (role === UserRole.STUDENT) {
      return res.status(400).json({ detail: 'Use /auth/register endpoint for student registration' });
    }

    // Normalize role: accept both COUNSELOR (single L) and COUNSELLOR (double L)
    // Database uses COUNSELLOR, so normalize to that
    let normalizedRole = role;
    if (role === 'COUNSELOR') {
      normalizedRole = UserRole.COUNSELLOR;
    }

    // Validate center for counselors
    if (normalizedRole === UserRole.COUNSELLOR) {
      if (!center) {
        return res.status(400).json({ detail: 'Center is required for counselors' });
      }
      if (!CENTERS.includes(center)) {
        return res.status(400).json({ detail: `Invalid center. Must be one of: ${CENTERS.join(', ')}` });
      }
    }

    // Check if email exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ detail: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await getPasswordHash(password);

    // Create user
    const userData = {
      email,
      password_hash: hashedPassword,
      full_name,
      role: normalizedRole || UserRole.COUNSELLOR,
      is_first_login: true
    };

    // Add center only for counselors
    if (normalizedRole === UserRole.COUNSELLOR && center) {
      userData.center = center;
    }

    const newUser = await User.create(userData);

    return res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role,
      center: newUser.center || null
    });
  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    return res.status(500).json({ detail: 'Failed to create user' });
  }
});

// PUT /admin/users/:id - Update user
router.put('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { email, full_name, role, center, password } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Prevent changing admin role
    if (user.role === UserRole.ADMIN && role && role !== UserRole.ADMIN) {
      return res.status(400).json({ detail: 'Cannot change admin role' });
    }

    // Prevent changing to admin role
    if (role === UserRole.ADMIN && user.role !== UserRole.ADMIN) {
      return res.status(403).json({ detail: 'Only existing admins can create other admins' });
    }

    const updateData = {};
    if (email) updateData.email = email;
    if (full_name) updateData.full_name = full_name;
    if (role) updateData.role = role;

    // Normalize role: accept both COUNSELOR (single L) and COUNSELLOR (double L)
    if (updateData.role === 'COUNSELOR') {
      updateData.role = UserRole.COUNSELLOR;
    }

    // Handle center for counselors
    if (updateData.role === UserRole.COUNSELLOR) {
      if (center) {
        if (!CENTERS.includes(center)) {
          return res.status(400).json({ detail: `Invalid center. Must be one of: ${CENTERS.join(', ')}` });
        }
        updateData.center = center;
      }
    } else {
      // Remove center if role is not counselor
      updateData.center = null;
    }

    // Update password if provided
    if (password) {
      updateData.password_hash = await getPasswordHash(password);
      updateData.is_first_login = true; // Force password change on next login
    }

    await user.update(updateData);

    return res.json({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      center: user.center || null
    });
  } catch (error) {
    console.error('❌ Error updating user:', error.message);
    return res.status(500).json({ detail: 'Failed to update user' });
  }
});

// DELETE /admin/users/:id - Delete user
router.delete('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Prevent deleting admin users
    if (user.role === UserRole.ADMIN) {
      return res.status(400).json({ detail: 'Cannot delete admin users' });
    }

    await user.destroy();

    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting user:', error.message);
    return res.status(500).json({ detail: 'Failed to delete user' });
  }
});

module.exports = router;

