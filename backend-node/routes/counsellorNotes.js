const express = require('express');
const router = express.Router();
const { User, UserRole, CounsellorNote, TestAttempt } = require('../models');
const { getCurrentUser, requireRole } = require('../middleware/auth');

const requireCounsellor = requireRole(['COUNSELLOR']);

// POST /counsellor/notes
router.post('', getCurrentUser, requireCounsellor, async (req, res) => {
  try {
    const { test_attempt_id, notes } = req.body;
    const currentUser = req.user;

    // Verify test attempt exists
    const testAttempt = await TestAttempt.findByPk(test_attempt_id);
    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    const studentId = testAttempt.student_id;

    // Check if note already exists
    let existingNote = await CounsellorNote.findOne({
      where: {
        test_attempt_id: test_attempt_id,
        counsellor_id: currentUser.id
      }
    });

    if (existingNote) {
      // Update existing note
      existingNote.notes = notes;
      existingNote.updated_at = new Date();
      await existingNote.save();

      return res.status(200).json({
        id: existingNote.id,
        counsellor_id: existingNote.counsellor_id,
        counsellor_name: currentUser.full_name,
        student_id: existingNote.student_id,
        test_attempt_id: existingNote.test_attempt_id,
        notes: existingNote.notes,
        created_at: existingNote.created_at,
        updated_at: existingNote.updated_at
      });
    } else {
      // Create new note
      const newNote = await CounsellorNote.create({
        counsellor_id: currentUser.id,
        student_id: studentId,
        test_attempt_id: test_attempt_id,
        notes: notes
      });

      return res.status(201).json({
        id: newNote.id,
        counsellor_id: newNote.counsellor_id,
        counsellor_name: currentUser.full_name,
        student_id: newNote.student_id,
        test_attempt_id: newNote.test_attempt_id,
        notes: newNote.notes,
        created_at: newNote.created_at,
        updated_at: newNote.updated_at
      });
    }
  } catch (error) {
    console.error(`❌ Error in create_or_update_note: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to create or update note'
    });
  }
});

// GET /counsellor/notes/:test_attempt_id
router.get('/:test_attempt_id', getCurrentUser, async (req, res) => {
  try {
    const testAttemptId = parseInt(req.params.test_attempt_id, 10);
    const currentUser = req.user;

    // Verify test attempt exists
    const testAttempt = await TestAttempt.findByPk(testAttemptId);
    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // If student, verify it's their attempt
    if (currentUser.role === UserRole.STUDENT && testAttempt.student_id !== currentUser.id) {
      return res.status(403).json({
        detail: 'Access denied'
      });
    }

    // Get note (any counsellor's note for this attempt)
    const note = await CounsellorNote.findOne({
      where: { test_attempt_id: testAttemptId }
    });

    if (!note) {
      return res.json(null);
    }

    // Get counsellor name
    const counsellor = await User.findByPk(note.counsellor_id);

    return res.json({
      id: note.id,
      counsellor_id: note.counsellor_id,
      counsellor_name: counsellor ? counsellor.full_name : 'Unknown',
      student_id: note.student_id,
      test_attempt_id: note.test_attempt_id,
      notes: note.notes,
      created_at: note.created_at,
      updated_at: note.updated_at
    });
  } catch (error) {
    console.error(`❌ Error in get_note: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get note'
    });
  }
});

module.exports = router;

