const express = require('express');
const router = express.Router();
const { User, UserRole, InterpretedResult, Career, TestAttempt, TestStatus } = require('../models');
const { getCurrentUser, requireRole } = require('../middleware/auth');

const requireStudent = requireRole(['STUDENT']);

const DISCLAIMER_TEXT = 'This assessment is designed to provide general career guidance and insights. Results are based on your responses and are intended for informational purposes only. They should not be considered as definitive career decisions or professional diagnoses. We recommend consulting with a qualified career counsellor to discuss your results in detail and explore your options further. Individual results may vary, and career success depends on many factors beyond assessment scores.';

// GET /student/result/:test_attempt_id
router.get('/:test_attempt_id', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const testAttemptId = parseInt(req.params.test_attempt_id, 10);
    const currentUser = req.user;

    // Verify test attempt belongs to current user
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: testAttemptId,
        student_id: currentUser.id
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // Get interpreted result
    const interpretedResult = await InterpretedResult.findOne({
      where: { test_attempt_id: testAttemptId }
    });

    if (!interpretedResult) {
      return res.status(404).json({
        detail: 'Results are not yet available. Please check back later.'
      });
    }

    // Get career recommendations (without match scores)
    const careers = await Career.findAll({
      where: { interpreted_result_id: interpretedResult.id },
      order: [['order_index', 'ASC']]
    });

    // Convert to response format (excluding match_score)
    const careersResponse = careers.map(career => ({
      career_name: career.career_name,
      description: career.description,
      category: career.category
    }));

    return res.json({
      test_attempt_id: testAttemptId,
      interpretation_text: interpretedResult.interpretation_text,
      strengths: interpretedResult.strengths,
      areas_for_improvement: interpretedResult.areas_for_improvement,
      careers: careersResponse,
      created_at: interpretedResult.created_at,
      disclaimer: DISCLAIMER_TEXT
    });
  } catch (error) {
    console.error(`❌ Error in get_result: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get result'
    });
  }
});

// GET /student/result/
router.get('/', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const currentUser = req.user;

    // Get all test attempts for current user
    const testAttempts = await TestAttempt.findAll({
      where: {
        student_id: currentUser.id,
        status: TestStatus.COMPLETED
      }
    });

    if (!testAttempts || testAttempts.length === 0) {
      return res.json([]);
    }

    const results = [];

    for (const testAttempt of testAttempts) {
      const interpretedResult = await InterpretedResult.findOne({
        where: { test_attempt_id: testAttempt.id }
      });

      if (!interpretedResult) {
        continue;
      }

      // Get career recommendations
      const careers = await Career.findAll({
        where: { interpreted_result_id: interpretedResult.id },
        order: [['order_index', 'ASC']]
      });

      const careersResponse = careers.map(career => ({
        career_name: career.career_name,
        description: career.description,
        category: career.category
      }));

      results.push({
        test_attempt_id: testAttempt.id,
        interpretation_text: interpretedResult.interpretation_text,
        strengths: interpretedResult.strengths,
        areas_for_improvement: interpretedResult.areas_for_improvement,
        careers: careersResponse,
        created_at: interpretedResult.created_at,
        disclaimer: DISCLAIMER_TEXT
      });
    }

    return res.json(results);
  } catch (error) {
    console.error(`❌ Error in get_all_results: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get results'
    });
  }
});

module.exports = router;

