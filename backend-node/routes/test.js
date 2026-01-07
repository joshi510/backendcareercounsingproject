const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../database');
const {
  User, UserRole, Question, TestAttempt, TestStatus,
  Answer, Score, InterpretedResult, Section, SectionProgress, SectionStatus,
  Student, TestAttemptQuestion
} = require('../models');
const { getCurrentUser, requireRole } = require('../middleware/auth');
const { storeScores } = require('../services/scoring');
const {
  generateAndSaveInterpretation,
  calculateReadinessStatus,
  calculateRiskLevel,
  determineCareerDirection,
  generateActionRoadmap,
  generateCounsellorStyleSummary,
  generateCounsellorSummary,
  generateReadinessActionGuidance,
  calculateCareerConfidence,
  generateDoNowDoLater,
  generateHumanRiskExplanation
} = require('../services/geminiInterpreter');

// Test configuration constants
const TOTAL_QUESTIONS = 35; // Total questions across all sections (7 questions × 5 sections)
const QUESTIONS_PER_SECTION = 7; // Questions per section
const TOTAL_SECTIONS = 5; // Total number of sections

const requireStudent = requireRole(['STUDENT']);
const requireStudentOrCounsellor = requireRole(['STUDENT', 'COUNSELLOR']);

// Helper function to parse options
function parseOptionsToArray(optionsString) {
  if (!optionsString) {
    return [];
  }

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(optionsString);
    if (Array.isArray(parsed)) {
      const result = [];
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null) {
          const key = (item.key || item.value || '').toString().toUpperCase();
          const text = (item.text || item.label || '').toString().trim();
          if (key && text) {
            result.push({ key, text });
          }
        } else if (typeof item === 'string') {
          const match = item.match(/^([A-E])[\)\.]\s*(.+)$/i);
          if (match) {
            result.push({ key: match[1].toUpperCase(), text: match[2].trim() });
          }
        }
      }
      return result;
    }
  } catch (e) {
    // Not JSON, continue with string parsing
  }

  // Parse string format like "A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree"
  const result = [];
  const parts = optionsString.split(/,\s*(?=[A-E][\)\.])/);

  const optionPattern = /^([A-E])[\)\.]\s*(.+)$/i;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = optionPattern.exec(trimmed);
    if (match) {
      const key = match[1].toUpperCase();
      const text = match[2].trim();
      if (key && text) {
        result.push({ key, text });
      }
    }
  }

  // If no options were parsed, try alternative parsing
  if (result.length === 0) {
    const pattern = /([A-E])[\)\.]\s*([^,]+?)(?=\s*[A-E][\)\.]|$)/gi;
    let match;
    while ((match = pattern.exec(optionsString)) !== null) {
      result.push({ key: match[1].toUpperCase(), text: match[2].trim() });
    }
  }

  return result;
}

// GET /test/questions
router.get('/questions', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const currentUser = req.user;
    const attemptId = req.query.attempt_id ? parseInt(req.query.attempt_id, 10) : null;

    // Find the test attempt
    let testAttempt;
    if (attemptId) {
      testAttempt = await TestAttempt.findOne({
        where: {
          id: attemptId,
          student_id: currentUser.id
        }
      });
    } else {
      testAttempt = await TestAttempt.findOne({
        where: {
          student_id: currentUser.id,
          status: TestStatus.IN_PROGRESS
        },
        order: [['started_at', 'DESC']]
      });
    }

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found. Please start a test first.'
      });
    }

    // Get selected question IDs from junction table
    // SQL Query: SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ?
    const attemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: testAttempt.id
      },
      attributes: ['question_id'],
      order: [['question_id', 'ASC']]
    });

    const selectedQuestionIds = attemptQuestions.map(tq => tq.question_id);

    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      return res.status(400).json({
        error_code: 'NO_QUESTIONS_ASSIGNED',
        message: 'No questions selected for this test attempt. Please start a section first.',
        detail: `Test attempt ${testAttempt.id} has no questions assigned. Please access a section to generate questions.`
      });
    }

    // Fetch only the selected questions
    const questions = await Question.findAll({
      where: {
        id: { [Op.in]: selectedQuestionIds },
        is_active: true,
        status: 'approved'
      },
      order: [['id', 'ASC']] // Order by ID to maintain consistent order
    });

    // Map questions to match selected order
    const questionMap = {};
    questions.forEach(q => {
      questionMap[q.id] = q;
    });

    const orderedQuestions = selectedQuestionIds
      .map(id => questionMap[id])
      .filter(q => q !== undefined);

    return res.json(
      orderedQuestions.map(q => ({
        question_id: q.id,
        question_text: q.question_text,
        options: parseOptionsToArray(q.options)
      }))
    );
  } catch (error) {
    console.error(`❌ Error in get_questions: ${error.name}: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: `Failed to fetch questions: ${error.message}`
    });
  }
});

// POST /test/start
router.post('/start', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const currentUser = req.user;

    // Ensure student profile exists
    const studentProfile = await Student.findOne({ where: { user_id: currentUser.id } });
    if (!studentProfile) {
      return res.status(400).json({
        detail: 'Student profile not found. Please complete your registration.'
      });
    }

    // Check if user has already completed a test (ONE ATTEMPT ONLY)
    const completedAttempt = await TestAttempt.findOne({
      where: {
        student_id: currentUser.id,
        status: TestStatus.COMPLETED
      }
    });

    if (completedAttempt) {
      return res.status(400).json({
        detail: 'You have already completed the test. Each student can attempt the test only once.'
      });
    }

    // Check if user has an in-progress test
    const existingAttempt = await TestAttempt.findOne({
      where: {
        student_id: currentUser.id,
        status: TestStatus.IN_PROGRESS
      }
    });

    // If exists → return it (questions are selected per section, not at test start)
    if (existingAttempt) {
      // Count total questions assigned across all sections from junction table
      const totalAssignedQuestions = await TestAttemptQuestion.count({
        where: {
          test_attempt_id: existingAttempt.id
        }
      });

      return res.json({
        test_attempt_id: existingAttempt.id,
        status: existingAttempt.status,
        started_at: existingAttempt.started_at,
        total_questions: totalAssignedQuestions || 0 // Questions are assigned per section
      });
    }

    // Validate that at least one section has minimum 7 questions
    // SQL Query: Check if any section has >= 7 questions
    const sections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });

    let hasEnoughQuestions = false;
    for (const section of sections) {
      const questionCount = await Question.count({
        where: {
          section_id: section.id,
          status: 'approved',
          is_active: true
        }
      });

      if (questionCount >= 7) {
        hasEnoughQuestions = true;
        break;
      }
    }

    if (!hasEnoughQuestions) {
      return res.status(400).json({
        error_code: 'INSUFFICIENT_QUESTIONS',
        message: 'Cannot start test. At least one section must have minimum 7 questions.',
        detail: 'No section has at least 7 active and approved questions. Please add more questions to at least one section.'
      });
    }

    // Create new test attempt (questions will be selected per section when accessing sections)
    const testAttempt = await TestAttempt.create({
      student_id: currentUser.id,
      status: TestStatus.IN_PROGRESS,
      current_section_id: null,
      current_question_index: 0,
      remaining_time_seconds: 420
    });

    console.log(`✅ Test attempt ${testAttempt.id} created (questions will be selected per section)`);

    return res.json({
      test_attempt_id: testAttempt.id,
      status: testAttempt.status,
      started_at: testAttempt.started_at,
      total_questions: 0 // Questions are assigned per section, not at test start
    });
  } catch (error) {
    console.error(`❌ Error in start_test: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to start test'
    });
  }
});

// POST /test/submit
router.post('/submit', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const { attempt_id, answers } = req.body;
    const currentUser = req.user;

    // Verify test attempt belongs to current user
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: attempt_id,
        student_id: currentUser.id
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    if (testAttempt.status !== TestStatus.IN_PROGRESS) {
      return res.status(400).json({
        detail: 'Test attempt is not in progress'
      });
    }

    // Get selected question IDs from junction table
    // SQL Query: SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ?
    const attemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: attempt_id
      },
      attributes: ['question_id']
    });

    const selectedQuestionIds = attemptQuestions.map(tq => tq.question_id);

    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      return res.status(400).json({
        error_code: 'NO_QUESTIONS_ASSIGNED',
        message: 'No questions selected for this test attempt. Please start sections to generate questions.',
        detail: `Test attempt ${attempt_id} has no questions assigned. Please access sections to generate questions.`
      });
    }

    const totalQuestions = selectedQuestionIds.length;

    if (answers.length !== totalQuestions) {
      return res.status(400).json({
        error_code: 'INCOMPLETE_ANSWERS',
        message: `Must answer all questions. Expected ${totalQuestions}, got ${answers.length}`,
        detail: `Test attempt ${attempt_id} requires ${totalQuestions} answers, but ${answers.length} were provided.`
      });
    }

    // Validate all questions exist and are in the selected list
    const questionIds = answers.map(a => a.question_id);
    const selectedQuestionSet = new Set(selectedQuestionIds);

    // Check for duplicate answers
    const answerQuestionIds = new Set();
    for (const qid of questionIds) {
      if (answerQuestionIds.has(qid)) {
        return res.status(400).json({
          detail: `Duplicate answer for question ${qid}`
        });
      }
      answerQuestionIds.add(qid);

      if (!selectedQuestionSet.has(qid)) {
        return res.status(400).json({
          detail: `Question ${qid} is not part of this test attempt`
        });
      }
    }

    // Check for duplicate submissions
    const existingAnswers = await Answer.count({
      where: { test_attempt_id: attempt_id }
    });

    if (existingAnswers > 0) {
      return res.status(400).json({
        detail: 'Answers already submitted for this attempt'
      });
    }

    // Save answers
    for (const answerData of answers) {
      await Answer.create({
        test_attempt_id: attempt_id,
        question_id: answerData.question_id,
        answer_text: answerData.selected_option
      });
    }

    // Calculate score
    let correctCount = 0;
    for (const answerData of answers) {
      const question = questionMap[answerData.question_id];
      if (question.correct_answer && answerData.selected_option.toUpperCase() === question.correct_answer.toUpperCase()) {
        correctCount++;
      }
    }

    const percentage = totalQuestions > 0 ? (correctCount / totalQuestions * 100) : 0.0;

    // Create Score record
    await Score.create({
      test_attempt_id: attempt_id,
      dimension: 'overall',
      score_value: percentage,
      percentile: null
    });

    // Update test attempt
    testAttempt.status = TestStatus.COMPLETED;
    testAttempt.completed_at = new Date();
    await testAttempt.save();

    return res.json({
      total_questions: totalQuestions,
      correct_answers: correctCount,
      percentage: Math.round(percentage * 100) / 100,
      status: 'COMPLETED'
    });
  } catch (error) {
    console.error(`❌ Error in submit_answers: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to submit answers'
    });
  }
});

// POST /test/:test_attempt_id/complete
router.post('/:test_attempt_id/complete', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const testAttemptId = parseInt(req.params.test_attempt_id, 10);
    const autoSubmit = req.query.auto_submit === 'true';
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

    console.log(`🔵 Complete test: attempt_id=${testAttemptId}, status=${testAttempt.status}, auto_submit=${autoSubmit}`);

    // Make endpoint idempotent: if already completed, return success
    if (testAttempt.status === TestStatus.COMPLETED) {
      console.log(`✅ Test ${testAttemptId} already completed, returning success (idempotent)`);
      return res.json({
        message: 'Test already completed',
        test_attempt_id: testAttemptId,
        test_id: testAttemptId,
        status: 'COMPLETED'
      });
    }

    if (testAttempt.status !== TestStatus.IN_PROGRESS) {
      return res.status(400).json({
        detail: `Test attempt is not in progress (current status: ${testAttempt.status})`
      });
    }

    // Check if all sections are completed (section-wise flow)
    const activeSections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });

    const activeSectionCount = activeSections.length;

    if (activeSectionCount > 0) {
      // Get all section progress records for this attempt
      const allProgress = await SectionProgress.findAll({
        where: { test_attempt_id: testAttemptId }
      });

      // Count completed sections by matching section IDs
      const completedSectionIds = new Set();
      for (const progress of allProgress) {
        if (progress.status === SectionStatus.COMPLETED) {
          completedSectionIds.add(progress.section_id);
        }
      }

      // Check which sections are completed
      const completedSectionsList = [];
      const missingSectionsList = [];
      for (const section of activeSections) {
        if (completedSectionIds.has(section.id)) {
          completedSectionsList.push(`Section ${section.order_index}`);
        } else {
          missingSectionsList.push(`Section ${section.order_index} (${section.name})`);
        }
      }

      const completedCount = completedSectionsList.length;

      console.log(`🔵 Section completion check: ${completedCount}/${activeSectionCount}`);
      console.log(`  Completed: ${completedSectionsList.join(', ')}`);
      console.log(`  Missing: ${missingSectionsList.join(', ')}`);

      if (completedCount < activeSectionCount) {
        return res.status(400).json({
          detail: `Please complete all sections. ${completedCount}/${activeSectionCount} sections completed. Missing: ${missingSectionsList.join(', ')}`
        });
      }
    }

    // Get selected question IDs from junction table
    // SQL Query: SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ?
    const attemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: testAttemptId
      },
      attributes: ['question_id']
    });

    const selectedQuestionIds = attemptQuestions.map(tq => tq.question_id);

    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      return res.status(400).json({
        error_code: 'NO_QUESTIONS_ASSIGNED',
        message: 'No questions selected for this test attempt. Please start sections to generate questions.',
        detail: `Test attempt ${testAttemptId} has no questions assigned. Please access sections to generate questions.`
      });
    }

    const expectedTotalQuestions = selectedQuestionIds.length;

    // Get answered questions count
    const answeredQuestions = await Answer.count({
      where: { test_attempt_id: testAttemptId }
    });

    console.log(`🔵 Question check: ${answeredQuestions}/${expectedTotalQuestions} answered (auto_submit=${autoSubmit})`);

    // Validate that all expected questions are answered
    if (answeredQuestions < expectedTotalQuestions) {
      return res.status(400).json({
        detail: `Please answer all questions. ${answeredQuestions}/${expectedTotalQuestions} answered`
      });
    }

    if (answeredQuestions > expectedTotalQuestions) {
      console.log(`⚠️ Warning: More answers (${answeredQuestions}) than expected (${expectedTotalQuestions}), proceeding with validation`);
    }

    // Calculate and store scores (scores are calculated from all answers, regardless of sections)
    try {
      await storeScores(testAttemptId);
    } catch (error) {
      console.error(`❌ Error calculating scores: ${error.message}`);
      return res.status(500).json({
        detail: 'Failed to calculate scores'
      });
    }

    // Mark test attempt as completed
    testAttempt.status = TestStatus.COMPLETED;
    testAttempt.completed_at = new Date();
    await testAttempt.save();

    console.log(`✅ Test ${testAttemptId} marked as COMPLETED`);

    // Auto-create interpretation if it doesn't exist
    try {
      // Explicitly select only columns that exist in database to avoid "Unknown column" errors
      let interpretedResult = await InterpretedResult.findOne({
        where: { test_attempt_id: testAttemptId },
        attributes: [
          'id',
          'test_attempt_id',
          'interpretation_text',
          'strengths',
          'areas_for_improvement',
          'is_ai_generated',
          'created_at',
          'updated_at'
        ]
      });

      if (!interpretedResult) {
        console.log(`🔵 Auto-creating interpretation for test ${testAttemptId}`);
        // Get score for interpretation
        const score = await Score.findOne({
          where: {
            test_attempt_id: testAttemptId,
            dimension: 'overall'
          }
        });

        if (score) {
          const totalQuestions = expectedTotalQuestions;
          const percentage = score.score_value;
          const correctAnswers = percentage <= 100 ? Math.floor((percentage / 100) * totalQuestions) : totalQuestions;

          // Generate interpretation in background (non-blocking)
          try {
            await generateAndSaveInterpretation(testAttemptId, totalQuestions, correctAnswers, percentage);
            console.log(`✅ Interpretation generated for test ${testAttemptId}`);
          } catch (error) {
            console.log(`⚠️ Failed to generate interpretation: ${error.message}`);
            // Don't fail the completion if interpretation generation fails
          }
        }
      }
    } catch (error) {
      console.log(`⚠️ Error during interpretation auto-creation: ${error.message}`);
      // Don't fail the completion if interpretation creation fails
    }

    return res.json({
      message: 'Test completed successfully',
      test_attempt_id: testAttemptId,
      test_id: testAttemptId,
      status: 'COMPLETED'
    });
  } catch (error) {
    console.error(`❌ Error in complete_test: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to complete test'
    });
  }
});

// GET /test/:test_attempt_id/state - Current test state (single source of truth)
router.get('/:test_attempt_id/state', getCurrentUser, requireStudent, async (req, res) => {
  try {
    console.log(`🔵 GET /test/:test_attempt_id/state - Attempt ID: ${req.params.test_attempt_id}`);
    const testAttemptId = parseInt(req.params.test_attempt_id, 10);
    const currentUser = req.user;
    console.log(`🔵 Current user ID: ${currentUser.id}, Looking for test attempt: ${testAttemptId}`);

    // Verify test attempt belongs to current user
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: testAttemptId,
        student_id: currentUser.id
      }
    });

    console.log(`🔵 Test attempt lookup result:`, testAttempt ? `Found (ID: ${testAttempt.id}, Status: ${testAttempt.status})` : 'Not found');

    if (!testAttempt) {
      console.log(`❌ Test attempt ${testAttemptId} not found for user ${currentUser.id}`);
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // If test is completed, return completed status
    if (testAttempt.status === TestStatus.COMPLETED) {
      return res.json({
        test_attempt_id: testAttempt.id,
        status: 'COMPLETED',
        completed_at: testAttempt.completed_at
      });
    }

    // Get current section info
    let currentSection = null;
    if (testAttempt.current_section_id) {
      currentSection = await Section.findByPk(testAttempt.current_section_id);
    }

    // If no current section, find next incomplete section
    if (!currentSection) {
      const completedProgresses = await SectionProgress.findAll({
        where: {
          test_attempt_id: testAttemptId,
          status: SectionStatus.COMPLETED
        }
      });

      const completedSectionIds = completedProgresses.map(p => p.section_id);
      const allSections = await Section.findAll({
        where: { is_active: true },
        order: [['order_index', 'ASC']]
      });

      for (const section of allSections) {
        if (!completedSectionIds.includes(section.id)) {
          currentSection = section;
          // Update test attempt with current section
          testAttempt.current_section_id = section.id;
          testAttempt.current_question_index = 0;
          testAttempt.remaining_time_seconds = 420;
          await testAttempt.save();
          break;
        }
      }
    }

    // Get section progress for timer calculation
    let remainingTimeSeconds = testAttempt.remaining_time_seconds || 420;
    let isPaused = false;

    if (currentSection) {
      const sectionProgress = await SectionProgress.findOne({
        where: {
          test_attempt_id: testAttemptId,
          section_id: currentSection.id
        }
      });

      if (sectionProgress) {
        isPaused = !!sectionProgress.paused_at;

        // Calculate remaining time from backend
        if (!isPaused && sectionProgress.section_start_time) {
          const now = new Date();
          const startTime = new Date(sectionProgress.section_start_time);
          const elapsedSeconds = Math.floor((now - startTime) / 1000) + sectionProgress.total_time_spent;
          const sectionTimeLimit = 420;
          remainingTimeSeconds = Math.max(0, sectionTimeLimit - elapsedSeconds);

          // Update test attempt with calculated remaining time
          testAttempt.remaining_time_seconds = remainingTimeSeconds;
          await testAttempt.save();
        } else if (isPaused) {
          // Use stored remaining time if paused
          remainingTimeSeconds = testAttempt.remaining_time_seconds || 420;
        }
      }
    }

    return res.json({
      test_attempt_id: testAttempt.id,
      status: testAttempt.status,
      current_section_id: currentSection?.id || null,
      current_section: currentSection ? {
        id: currentSection.id,
        order_index: currentSection.order_index,
        name: currentSection.name
      } : null,
      current_question_index: testAttempt.current_question_index || 0,
      remaining_time_seconds: remainingTimeSeconds,
      is_paused: isPaused
    });
  } catch (error) {
    console.error(`❌ Error in get_test_state: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: 'Failed to get test state'
    });
  }
});

// GET /test/:test_attempt_id/progress - Full progress snapshot for resume (MUST come before /status)
router.get('/:test_attempt_id/progress', getCurrentUser, requireStudent, async (req, res) => {
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

    // If test is completed, return completed status
    if (testAttempt.status === TestStatus.COMPLETED) {
      return res.json({
        test_attempt_id: testAttempt.id,
        status: 'COMPLETED',
        completed_at: testAttempt.completed_at
      });
    }

    // Find current section (IN_PROGRESS section, or next incomplete section)
    const inProgressProgress = await SectionProgress.findOne({
      where: {
        test_attempt_id: testAttemptId,
        status: SectionStatus.IN_PROGRESS
      }
    });

    let currentSection = null;
    let currentSectionProgress = null;
    let remainingTimeSeconds = 0;

    if (inProgressProgress) {
      currentSection = await Section.findByPk(inProgressProgress.section_id);
      currentSectionProgress = inProgressProgress;

      // Use remaining_time_seconds from test_attempt if available (persisted on pause)
      // Otherwise calculate from section progress
      const sectionTimeLimit = 420; // 7 minutes = 420 seconds

      // ALWAYS use remaining_time_seconds from test_attempt if available (persisted on pause/resume)
      // Otherwise calculate from section progress
      if (testAttempt.remaining_time_seconds !== null && testAttempt.remaining_time_seconds !== undefined) {
        // Use persisted remaining time (set on pause/resume)
        remainingTimeSeconds = Math.max(0, testAttempt.remaining_time_seconds);
      } else {
        // Calculate from section progress
        const now = new Date();
        let elapsedSeconds = 0;

        if (inProgressProgress.paused_at) {
          // Section is paused - use total_time_spent
          elapsedSeconds = inProgressProgress.total_time_spent;
        } else if (inProgressProgress.section_start_time) {
          // Section is active - calculate from start time
          const startTime = new Date(inProgressProgress.section_start_time);
          elapsedSeconds = Math.floor((now - startTime) / 1000) + inProgressProgress.total_time_spent;
        }

        remainingTimeSeconds = Math.max(0, sectionTimeLimit - elapsedSeconds);

        // Update test_attempt with calculated remaining time for persistence
        testAttempt.remaining_time_seconds = remainingTimeSeconds;
        await testAttempt.save();
      }
    } else {
      // Find next incomplete section
      const completedProgresses = await SectionProgress.findAll({
        where: {
          test_attempt_id: testAttemptId,
          status: SectionStatus.COMPLETED
        }
      });

      const completedSectionIds = completedProgresses.map(p => p.section_id);
      const allSections = await Section.findAll({
        where: { is_active: true },
        order: [['order_index', 'ASC']]
      });

      for (const section of allSections) {
        if (!completedSectionIds.includes(section.id)) {
          currentSection = section;
          break;
        }
      }
    }

    // Get all answers for current section
    let currentQuestionIndex = 0;
    const answersMap = {};

    if (currentSection) {
      // Get all questions for this section
      const sectionQuestions = await Question.findAll({
        where: {
          section_id: currentSection.id,
          is_active: true
        },
        order: [['order_index', 'ASC']]
      });

      // Get all answers for this section
      const sectionAnswers = await Answer.findAll({
        where: {
          test_attempt_id: testAttemptId,
          question_id: sectionQuestions.map(q => q.id)
        }
      });

      // Build answers map and find current question index
      const answeredQuestionIds = new Set();
      sectionAnswers.forEach(answer => {
        answersMap[answer.question_id] = answer.answer_text; // answer_text contains selected_option
        answeredQuestionIds.add(answer.question_id);
      });

      // Find first unanswered question index
      for (let i = 0; i < sectionQuestions.length; i++) {
        if (!answeredQuestionIds.has(sectionQuestions[i].id)) {
          currentQuestionIndex = i;
          break;
        }
      }

      // If all questions answered, set to last question
      if (answeredQuestionIds.size === sectionQuestions.length) {
        currentQuestionIndex = sectionQuestions.length - 1;
      }
    }

    return res.json({
      test_attempt_id: testAttempt.id,
      status: testAttempt.status,
      started_at: testAttempt.started_at,
      current_section: currentSection ? {
        id: currentSection.id,
        order_index: currentSection.order_index,
        name: currentSection.name
      } : null,
      current_question_index: currentQuestionIndex,
      answers: answersMap, // { question_id: selected_option }
      remaining_time_seconds: remainingTimeSeconds,
      section_start_time: currentSectionProgress?.section_start_time || null,
      paused_at: currentSectionProgress?.paused_at || null,
      is_paused: !!currentSectionProgress?.paused_at
    });
  } catch (error) {
    console.error(`❌ Error in get_test_progress: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: 'Failed to get test progress'
    });
  }
});

// GET /test/:test_attempt_id/status
router.get('/:test_attempt_id/status', getCurrentUser, requireStudent, async (req, res) => {
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

    const totalQuestions = await Question.count({ where: { is_active: true } });
    const answeredQuestions = await Answer.count({
      where: { test_attempt_id: testAttemptId }
    });

    // Get completed sections by querying SectionProgress
    const completedProgresses = await SectionProgress.findAll({
      where: {
        test_attempt_id: testAttemptId,
        status: SectionStatus.COMPLETED
      }
    });

    // Get section order_index for each completed section
    const completedSections = [];
    for (const progress of completedProgresses) {
      const section = await Section.findByPk(progress.section_id);
      if (section) {
        completedSections.push(section.order_index);
      }
    }

    // Sort completed sections
    completedSections.sort((a, b) => a - b);

    // Find current section (next incomplete section)
    const allSections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });

    let currentSection = null;
    for (const section of allSections) {
      if (!completedSections.includes(section.order_index)) {
        currentSection = section.order_index;
        break;
      }
    }

    // Get total sections from database (should be 5)
    let totalSections = await Section.count({ where: { is_active: true } });
    if (totalSections === 0) {
      totalSections = TOTAL_SECTIONS; // Fallback to constant if no sections found
    }

    return res.json({
      test_attempt_id: testAttempt.id,
      status: testAttempt.status,
      started_at: testAttempt.started_at,
      completed_at: testAttempt.completed_at,
      total_questions: totalQuestions,
      answered_questions: answeredQuestions,
      completed_sections: completedSections,
      current_section: currentSection,
      total_sections: totalSections
    });
  } catch (error) {
    console.error(`❌ Error in get_test_status: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get test status'
    });
  }
});

// GET /test/interpretation/:test_attempt_id
router.get('/interpretation/:test_attempt_id', getCurrentUser, requireStudentOrCounsellor, async (req, res) => {
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

    if (testAttempt.status !== TestStatus.COMPLETED) {
      return res.status(400).json({
        detail: 'Test must be completed before interpretation'
      });
    }

    // Check if interpretation already exists
    // Explicitly select only columns that exist in database to avoid "Unknown column" errors
    let interpretedResult = await InterpretedResult.findOne({
      where: { test_attempt_id: testAttemptId },
      attributes: [
        'id',
        'test_attempt_id',
        'interpretation_text',
        'strengths',
        'areas_for_improvement',
        'is_ai_generated',
        'created_at',
        'updated_at'
        // Note: readiness_status, risk_level, etc. are NOT included if they don't exist in DB
        // They will be calculated dynamically if missing
      ]
    });

    // Get score data
    let score = await Score.findOne({
      where: {
        test_attempt_id: testAttemptId,
        dimension: 'overall'
      }
    });

    if (!score) {
      // Auto-create score if missing (shouldn't happen, but handle gracefully)
      console.log(`⚠️ Score not found for test ${testAttemptId}, attempting to calculate...`);
      try {
        await storeScores(testAttemptId);
        score = await Score.findOne({
          where: {
            test_attempt_id: testAttemptId,
            dimension: 'overall'
          }
        });
      } catch (error) {
        console.error(`❌ Failed to calculate score: ${error.message}`);
      }

      if (!score) {
        // Get selected question IDs for default response from junction table
        const defaultAttemptQuestions = await TestAttemptQuestion.findAll({
          where: {
            test_attempt_id: testAttemptId
          },
          attributes: ['question_id']
        });
        const defaultSelectedIds = defaultAttemptQuestions.map(tq => tq.question_id);
        // Return a default interpretation instead of 404
        console.log(`⚠️ Still no score found, returning default interpretation`);
        return res.json({
          summary: 'Assessment results are being processed. Please check back in a moment.',
          strengths: [],
          weaknesses: [],
          career_clusters: [],
          risk_level: 'MEDIUM',
          readiness_status: 'PROCESSING',
          action_plan: ['Results are being calculated. Please refresh in a moment.'],
          overall_percentage: 0.0,
          total_questions: defaultSelectedIds.length || 7,
          correct_answers: 0,
          is_ai_generated: false
        });
      }
    }

    // Get selected question IDs from junction table
    // SQL Query: SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ?
    const attemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: testAttemptId
      },
      attributes: ['question_id']
    });

    const selectedQuestionIds = attemptQuestions.map(tq => tq.question_id);

    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      return res.status(400).json({
        error_code: 'NO_QUESTIONS_ASSIGNED',
        message: 'No questions selected for this test attempt. Please start sections to generate questions.',
        detail: `Test attempt ${testAttemptId} has no questions assigned. Please access sections to generate questions.`
      });
    }

    const expectedTotalQuestions = selectedQuestionIds.length;

    // Get answered questions count
    const answeredCount = await Answer.count({
      where: { test_attempt_id: testAttemptId }
    });

    // Validate that all expected questions are answered
    if (answeredCount < expectedTotalQuestions) {
      return res.status(400).json({
        detail: `Cannot generate interpretation: ${answeredCount}/${expectedTotalQuestions} questions answered`
      });
    }

    // Use expected total for score calculation
    // IMPORTANT: overall_percentage is calculated ONCE in scoring.js and stored in scores table
    // Do NOT recalculate here - always use score.score_value from database
    const totalQuestions = expectedTotalQuestions;

    // Defensive check: ensure score and score_value exist and are valid
    if (!score || score.score_value == null) {
      console.error(`❌ Invalid score data for attempt ${testAttemptId}: score=${score}, score_value=${score?.score_value}`);
      return res.status(400).json({
        error_code: 'INVALID_SCORE_DATA',
        message: 'Score data is missing or invalid. Cannot generate interpretation.',
        detail: `Test attempt ${testAttemptId} has invalid score data. Please ensure the test was properly completed and scored.`
      });
    }

    let percentage = typeof score.score_value === 'number'
      ? score.score_value
      : parseFloat(score.score_value);

    // Validate percentage is a valid number
    if (isNaN(percentage)) {
      console.error(`❌ Invalid percentage value for attempt ${testAttemptId}: ${score.score_value}`);
      return res.status(400).json({
        error_code: 'INVALID_PERCENTAGE',
        message: 'Score percentage is invalid. Cannot generate interpretation.',
        detail: `Test attempt ${testAttemptId} has invalid percentage value: ${score.score_value}`
      });
    }

    // Clamp percentage to valid range (0-100) if somehow invalid, but don't recalculate
    if (percentage < 0 || percentage > 100) {
      console.log(`⚠️ Warning: Invalid percentage ${percentage} for test ${testAttemptId}, clamping to valid range`);
      percentage = Math.max(0.0, Math.min(100.0, percentage));
    }

    // Calculate correct_answers for display purposes only (not stored, just for API response)
    const correctAnswers = percentage <= 100 ? Math.floor((percentage / 100) * totalQuestions) : totalQuestions;

    // Generate interpretation if not exists
    if (!interpretedResult) {
      try {
        console.log(`🔵 Attempting to generate interpretation for test ${testAttemptId}...`);
        const result = await generateAndSaveInterpretation(testAttemptId, totalQuestions, correctAnswers, percentage);
        interpretedResult = result.interpretedResult;
        console.log(`✅ Interpretation generated successfully for test ${testAttemptId}`);
      } catch (error) {
        console.error(`❌ Failed to generate interpretation for test ${testAttemptId}:`);
        console.error(`❌ Error name: ${error.name}`);
        console.error(`❌ Error message: ${error.message}`);
        console.error(`❌ Error stack: ${error.stack}`);

        // Check if it's a database column error
        if (error.name === 'SequelizeDatabaseError' && error.message.includes('Unknown column')) {
          console.error(`❌ Database column mismatch detected. This indicates the model defines columns that don't exist in the database.`);
          return res.status(400).json({
            error_code: 'DATABASE_SCHEMA_MISMATCH',
            message: 'Interpretation generation failed due to database schema mismatch.',
            detail: `The database table is missing required columns. Please check the database schema. Error: ${error.message}`
          });
        }

        // Return a processing message instead of 404
        const [readinessStatus, readinessExplanation] = calculateReadinessStatus(percentage);
        const [riskLevel, riskExplanation] = calculateRiskLevel(readinessStatus);

        const sections = {};
        const sectionObjs = await Section.findAll();
        for (const section of sectionObjs) {
          sections[section.order_index] = section.name;
        }

        const sectionScoresDict = {};
        const scoresQuery = await Score.findAll({
          where: { test_attempt_id: testAttemptId }
        });
        for (const s of scoresQuery) {
          if (s.dimension.startsWith('section_')) {
            sectionScoresDict[s.dimension] = s.score_value;
          }
        }

        const [careerDirection, careerDirectionReason] = determineCareerDirection(sectionScoresDict, sections, percentage);
        const roadmap = generateActionRoadmap(readinessStatus, percentage);

        // Generate new fields for error response
        const counsellorSummary = generateCounsellorSummary(percentage, readinessStatus, careerDirection, sectionScoresDict);
        const readinessActionGuidance = generateReadinessActionGuidance(readinessStatus);
        const [careerConfidenceLevel, careerConfidenceExplanation] = calculateCareerConfidence(percentage, readinessStatus);
        const { doNow, doLater } = generateDoNowDoLater(readinessStatus, roadmap);
        const riskExplanationHuman = generateHumanRiskExplanation(riskLevel, readinessStatus);

        // Get section scores for error response too
        const sectionScoresArray = [];
        for (const [dim, score] of Object.entries(sectionScoresDict)) {
          const sectionNum = parseInt(dim.split('_')[1], 10);
          if (!isNaN(sectionNum)) {
            const sectionName = sections[sectionNum] || `Section ${sectionNum}`;
            sectionScoresArray.push({
              section_number: sectionNum,
              section_name: sectionName,
              score: Math.round(score * 100) / 100
            });
          }
        }
        sectionScoresArray.sort((a, b) => a.section_number - b.section_number);

        return res.json({
          summary: 'AI interpretation is being generated. Please refresh in a moment.',
          strengths: [],
          weaknesses: [],
          career_clusters: [careerDirection],
          risk_level: riskLevel,
          readiness_status: readinessStatus,
          action_plan: ['Interpretation is being generated. Please refresh in a moment.'],
          overall_percentage: Math.round(percentage * 100) / 100,
          total_questions: totalQuestions,
          correct_answers: correctAnswers,
          is_ai_generated: false,
          readiness_explanation: readinessExplanation,
          risk_explanation: riskExplanation,
          career_direction: careerDirection,
          career_direction_reason: careerDirectionReason,
          roadmap: roadmap,
          section_scores: sectionScoresArray,
          counsellor_summary: counsellorSummary,
          readiness_action_guidance: readinessActionGuidance,
          career_confidence_level: careerConfidenceLevel,
          career_confidence_explanation: careerConfidenceExplanation,
          do_now_actions: doNow,
          do_later_actions: doLater,
          risk_explanation_human: riskExplanationHuman
        });
      }
    }

    // Parse existing interpretation - regenerate missing fields if needed
    const [readinessStatus, readinessExplanation] = calculateReadinessStatus(percentage);
    const [riskLevel, riskExplanation] = calculateRiskLevel(readinessStatus);

    const sections = {};
    const sectionObjs = await Section.findAll();
    for (const section of sectionObjs) {
      sections[section.order_index] = section.name;
    }

    const sectionScoresDict = {};
    const sectionScoresArray = [];
    const scoresQuery = await Score.findAll({
      where: { test_attempt_id: testAttemptId }
    });
    for (const scoreItem of scoresQuery) {
      // Defensive check: ensure dimension exists and is a string
      if (!scoreItem || !scoreItem.dimension || typeof scoreItem.dimension !== 'string') {
        console.warn(`⚠️ Invalid score item dimension for attempt ${testAttemptId}:`, scoreItem);
        continue;
      }

      if (scoreItem.dimension.startsWith('section_')) {
        // Defensive check: ensure score_value is a valid number
        const scoreValue = scoreItem.score_value != null
          ? (typeof scoreItem.score_value === 'number' ? scoreItem.score_value : parseFloat(scoreItem.score_value))
          : 0;

        if (isNaN(scoreValue)) {
          console.warn(`⚠️ Invalid score_value for dimension ${scoreItem.dimension} in attempt ${testAttemptId}`);
          continue;
        }

        sectionScoresDict[scoreItem.dimension] = scoreValue;

        // Extract section number and create array for frontend
        const dimensionParts = scoreItem.dimension.split('_');
        if (dimensionParts.length >= 2) {
          const sectionNum = parseInt(dimensionParts[1], 10);
          if (!isNaN(sectionNum) && sectionNum > 0) {
            const sectionName = sections[sectionNum] || `Section ${sectionNum}`;
            sectionScoresArray.push({
              section_number: sectionNum,
              section_name: sectionName,
              score: Math.round(scoreValue * 100) / 100
            });
          }
        }
      }
    }
    // Sort by section number
    sectionScoresArray.sort((a, b) => a.section_number - b.section_number);

    const [careerDirection, careerDirectionReason] = determineCareerDirection(sectionScoresDict, sections, percentage);
    const roadmap = generateActionRoadmap(readinessStatus, percentage);

    // Safely parse JSON fields with defensive checks
    // Handle case where interpretedResult might be null or missing fields
    let strengths = [];
    let weaknesses = [];

    if (interpretedResult) {
      try {
        if (interpretedResult.strengths) {
          const parsed = typeof interpretedResult.strengths === 'string'
            ? JSON.parse(interpretedResult.strengths)
            : interpretedResult.strengths;
          strengths = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse strengths for attempt ${testAttemptId}: ${e.message}`);
        strengths = [];
      }

      try {
        if (interpretedResult.areas_for_improvement) {
          const parsed = typeof interpretedResult.areas_for_improvement === 'string'
            ? JSON.parse(interpretedResult.areas_for_improvement)
            : interpretedResult.areas_for_improvement;
          weaknesses = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse areas_for_improvement for attempt ${testAttemptId}: ${e.message}`);
        weaknesses = [];
      }
    }

    // Use stored values from database if available, otherwise calculate fresh
    // Safely access properties that may not exist in DB (defensive coding)
    // Note: These columns (readiness_status, risk_level, etc.) are NOT in the attributes list
    // because they don't exist in the database table, so they will always be undefined
    // We always use the calculated values instead
    const storedReadinessStatus = readinessStatus; // Always use calculated, DB column doesn't exist
    const storedReadinessExplanation = readinessExplanation; // Always use calculated
    const storedRiskLevel = riskLevel; // Always use calculated
    const storedRiskExplanation = riskExplanation; // Always use calculated
    const storedCareerDirection = careerDirection; // Always use calculated
    const storedCareerDirectionReason = careerDirectionReason; // Always use calculated

    // Safely parse roadmap with defensive checks
    // Handle case where interpretedResult might be null or missing fields
    let storedRoadmap = roadmap;
    if (interpretedResult) {
      try {
        if (interpretedResult.roadmap) {
          const parsed = typeof interpretedResult.roadmap === 'string'
            ? JSON.parse(interpretedResult.roadmap)
            : interpretedResult.roadmap;
          // Validate roadmap structure
          if (parsed && typeof parsed === 'object' && parsed.phase1 && parsed.phase2 && parsed.phase3) {
            storedRoadmap = parsed;
          } else {
            console.warn(`⚠️ Invalid roadmap structure for attempt ${testAttemptId}, using generated roadmap`);
            storedRoadmap = roadmap;
          }
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse roadmap for attempt ${testAttemptId}: ${e.message}`);
        storedRoadmap = roadmap;
      }
    }

    // Parse new fields or generate fallbacks with defensive checks
    const storedCounsellorSummary = (interpretedResult && interpretedResult.counsellor_summary)
      ? interpretedResult.counsellor_summary
      : '';

    let storedReadinessActionGuidance = [];
    if (interpretedResult) {
      try {
        if (interpretedResult.readiness_action_guidance) {
          const parsed = typeof interpretedResult.readiness_action_guidance === 'string'
            ? JSON.parse(interpretedResult.readiness_action_guidance)
            : interpretedResult.readiness_action_guidance;
          storedReadinessActionGuidance = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse readiness_action_guidance for attempt ${testAttemptId}: ${e.message}`);
        storedReadinessActionGuidance = [];
      }
    }

    const storedCareerConfidenceLevel = (interpretedResult && interpretedResult.career_confidence_level)
      ? interpretedResult.career_confidence_level
      : 'MODERATE';
    const storedCareerConfidenceExplanation = (interpretedResult && interpretedResult.career_confidence_explanation)
      ? interpretedResult.career_confidence_explanation
      : '';

    let storedDoNowActions = [];
    if (interpretedResult) {
      try {
        if (interpretedResult.do_now_actions) {
          const parsed = typeof interpretedResult.do_now_actions === 'string'
            ? JSON.parse(interpretedResult.do_now_actions)
            : interpretedResult.do_now_actions;
          storedDoNowActions = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse do_now_actions for attempt ${testAttemptId}: ${e.message}`);
        storedDoNowActions = [];
      }
    }

    let storedDoLaterActions = [];
    if (interpretedResult) {
      try {
        if (interpretedResult.do_later_actions) {
          const parsed = typeof interpretedResult.do_later_actions === 'string'
            ? JSON.parse(interpretedResult.do_later_actions)
            : interpretedResult.do_later_actions;
          storedDoLaterActions = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse do_later_actions for attempt ${testAttemptId}: ${e.message}`);
        storedDoLaterActions = [];
      }
    }

    const storedRiskExplanationHuman = (interpretedResult && interpretedResult.risk_explanation_human)
      ? interpretedResult.risk_explanation_human
      : storedRiskExplanation;

    const interpretationData = {
      summary: interpretedResult.interpretation_text || generateCounsellorStyleSummary(
        percentage, storedReadinessStatus, storedCareerDirection, totalQuestions, correctAnswers
      ),
      strengths: strengths,
      weaknesses: weaknesses,
      career_clusters: [storedCareerDirection],
      risk_level: storedRiskLevel,
      readiness_status: storedReadinessStatus,
      action_plan: (() => {
        // Defensive check: ensure roadmap has required structure
        if (!storedRoadmap || typeof storedRoadmap !== 'object') {
          return ['Action plan is being generated. Please refresh in a moment.'];
        }

        const actionPlanItems = [];
        try {
          if (storedRoadmap.phase1 && storedRoadmap.phase1.title && Array.isArray(storedRoadmap.phase1.actions)) {
            const phase1Actions = storedRoadmap.phase1.actions.slice(0, 2).filter(a => a).join(', ');
            actionPlanItems.push(`${storedRoadmap.phase1.title}${phase1Actions ? ': ' + phase1Actions : ''}`);
          }
          if (storedRoadmap.phase2 && storedRoadmap.phase2.title && Array.isArray(storedRoadmap.phase2.actions)) {
            const phase2Actions = storedRoadmap.phase2.actions.slice(0, 2).filter(a => a).join(', ');
            actionPlanItems.push(`${storedRoadmap.phase2.title}${phase2Actions ? ': ' + phase2Actions : ''}`);
          }
          if (storedRoadmap.phase3 && storedRoadmap.phase3.title && Array.isArray(storedRoadmap.phase3.actions)) {
            const phase3Actions = storedRoadmap.phase3.actions.slice(0, 2).filter(a => a).join(', ');
            actionPlanItems.push(`${storedRoadmap.phase3.title}${phase3Actions ? ': ' + phase3Actions : ''}`);
          }
        } catch (e) {
          console.warn(`⚠️ Error building action plan for attempt ${testAttemptId}: ${e.message}`);
        }

        return actionPlanItems.length > 0
          ? actionPlanItems
          : ['Action plan is being generated. Please refresh in a moment.'];
      })(),
      readiness_explanation: storedReadinessExplanation,
      risk_explanation: storedRiskExplanation,
      career_direction: storedCareerDirection,
      career_direction_reason: storedCareerDirectionReason,
      roadmap: storedRoadmap,
      counsellor_summary: storedCounsellorSummary,
      readiness_action_guidance: storedReadinessActionGuidance,
      career_confidence_level: storedCareerConfidenceLevel,
      career_confidence_explanation: storedCareerConfidenceExplanation,
      do_now_actions: storedDoNowActions,
      do_later_actions: storedDoLaterActions,
      risk_explanation_human: storedRiskExplanationHuman
    };

    const isAiGenerated = interpretedResult ? interpretedResult.is_ai_generated : false;

    return res.json({
      summary: interpretationData.summary || '',
      strengths: interpretationData.strengths || [],
      weaknesses: interpretationData.weaknesses || [],
      career_clusters: interpretationData.career_clusters || [],
      risk_level: interpretationData.risk_level || 'MEDIUM',
      readiness_status: interpretationData.readiness_status || 'PARTIALLY READY',
      action_plan: interpretationData.action_plan || [],
      overall_percentage: Math.round(percentage * 100) / 100,
      total_questions: totalQuestions,
      correct_answers: correctAnswers,
      is_ai_generated: isAiGenerated,
      readiness_explanation: interpretationData.readiness_explanation || '',
      risk_explanation: interpretationData.risk_explanation || '',
      career_direction: interpretationData.career_direction || 'Multi-domain Exploration',
      career_direction_reason: interpretationData.career_direction_reason || '',
      roadmap: interpretationData.roadmap || {},
      section_scores: sectionScoresArray,
      counsellor_summary: interpretationData.counsellor_summary || '',
      readiness_action_guidance: interpretationData.readiness_action_guidance || [],
      career_confidence_level: interpretationData.career_confidence_level || 'MODERATE',
      career_confidence_explanation: interpretationData.career_confidence_explanation || '',
      do_now_actions: interpretationData.do_now_actions || [],
      do_later_actions: interpretationData.do_later_actions || [],
      risk_explanation_human: interpretationData.risk_explanation_human || interpretationData.risk_explanation || ''
    });
  } catch (error) {
    console.error(`❌ Error in get_interpretation: ${error.name}: ${error.message}`);
    console.error(`❌ Error stack: ${error.stack}`);

    // Return 400 for validation/data errors, 500 only for unexpected errors
    if (error.name === 'SequelizeValidationError' ||
      error.name === 'SequelizeDatabaseError' ||
      error.message.includes('JSON') ||
      error.message.includes('parse') ||
      error.message.includes('null') ||
      error.message.includes('undefined')) {
      return res.status(400).json({
        error_code: 'INTERPRETATION_DATA_ERROR',
        message: 'Invalid interpretation data. Cannot generate interpretation.',
        detail: error.message || 'Data validation failed'
      });
    }

    return res.status(500).json({
      error_code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while generating interpretation.',
      detail: error.message || 'Internal server error'
    });
  }
});

// ========== SECTION-WISE TEST FLOW ENDPOINTS ==========

// POST /test/save-answer - Save individual answer (for real-time persistence)
router.post('/save-answer', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const { attempt_id, question_id, selected_option } = req.body;
    const currentUser = req.user;

    if (!attempt_id || !question_id || !selected_option) {
      return res.status(400).json({
        detail: 'attempt_id, question_id, and selected_option are required'
      });
    }

    // Verify test attempt belongs to user
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: attempt_id,
        student_id: currentUser.id,
        status: TestStatus.IN_PROGRESS
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found or not in progress'
      });
    }

    // Verify question exists
    const question = await Question.findByPk(question_id);
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }

    // Upsert answer (update if exists, create if not)
    const [answer, created] = await Answer.findOrCreate({
      where: {
        test_attempt_id: attempt_id,
        question_id: question_id
      },
      defaults: {
        test_attempt_id: attempt_id,
        question_id: question_id,
        answer_text: String(selected_option)
      }
    });

    if (!created) {
      answer.answer_text = String(selected_option);
      await answer.save();
    }

    return res.json({
      success: true,
      answer_id: answer.id,
      question_id: question_id,
      selected_option: selected_option
    });
  } catch (error) {
    console.error(`❌ Error in save_answer: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to save answer'
    });
  }
});

// GET /test/sections
router.get('/sections', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const attemptId = req.query.attempt_id ? parseInt(req.query.attempt_id, 10) : null;
    const currentUser = req.user;

    // Check if student has already completed a test (ONE ATTEMPT ONLY)
    const completedAttempt = await TestAttempt.findOne({
      where: {
        student_id: currentUser.id,
        status: TestStatus.COMPLETED
      },
      order: [['completed_at', 'DESC']]
    });

    const canAttemptTest = !completedAttempt;
    const completedTestAttemptId = completedAttempt ? completedAttempt.id : null;

    console.log(`🔵 get_sections for user ${currentUser.id}: can_attempt_test=${canAttemptTest}, completed_test_attempt_id=${completedTestAttemptId}`);

    // Find current test attempt for this student (in progress)
    let testAttempt;
    if (attemptId) {
      testAttempt = await TestAttempt.findOne({
        where: {
          id: attemptId,
          student_id: currentUser.id,
          status: TestStatus.IN_PROGRESS
        }
      });
    } else {
      testAttempt = await TestAttempt.findOne({
        where: {
          student_id: currentUser.id,
          status: TestStatus.IN_PROGRESS
        }
      });
    }

    // Define all 5 sections - ALWAYS return all 5 sections
    const sectionsConfig = [
      { order_index: 1, name: 'Section 1: Intelligence Test (Cognitive Reasoning)', description: 'Logical Reasoning, Numerical Reasoning, Verbal Reasoning, Abstract Reasoning' },
      { order_index: 2, name: 'Section 2: Aptitude Test', description: 'Numerical Aptitude, Logical Aptitude, Verbal Aptitude, Spatial/Mechanical Aptitude' },
      { order_index: 3, name: 'Section 3: Study Habits', description: 'Concentration, Consistency, Time Management, Exam Preparedness, Self-discipline' },
      { order_index: 4, name: 'Section 4: Learning Style', description: 'Visual, Auditory, Reading/Writing, Kinesthetic' },
      { order_index: 5, name: 'Section 5: Career Interest (RIASEC)', description: 'Realistic, Investigative, Artistic, Social, Enterprising, Conventional' }
    ];

    // Get sections from database
    const dbSections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });

    // Create a map of order_index -> Section for quick lookup
    const dbSectionsMap = {};
    for (const s of dbSections) {
      dbSectionsMap[s.order_index] = s;
    }

    // Build all_sections list - always 5 sections
    const allSections = [];
    for (const config of sectionsConfig) {
      const orderIdx = config.order_index;
      if (dbSectionsMap[orderIdx]) {
        allSections.push(dbSectionsMap[orderIdx]);
      } else {
        // Create a temporary section object from config if not in DB
        allSections.push({
          id: orderIdx, // Use order_index as temporary ID
          name: config.name,
          description: config.description,
          order_index: orderIdx,
          is_active: true
        });
      }
    }

    // Determine current section based on progress
    let currentSectionIndex = 0;

    if (testAttempt) {
      // Find the current section based on progress
      // Look for in-progress sections first
      const inProgressProgress = await SectionProgress.findAll({
        where: {
          test_attempt_id: testAttempt.id,
          status: SectionStatus.IN_PROGRESS
        }
      });

      if (inProgressProgress.length > 0) {
        for (const progress of inProgressProgress) {
          const section = await Section.findByPk(progress.section_id);
          if (section) {
            currentSectionIndex = section.order_index;
            break;
          }
        }
      } else {
        // Find the highest completed section
        const completedProgress = await SectionProgress.findAll({
          where: {
            test_attempt_id: testAttempt.id,
            status: SectionStatus.COMPLETED
          }
        });

        if (completedProgress.length > 0) {
          const completedOrderIndices = [];
          for (const progress of completedProgress) {
            const section = await Section.findByPk(progress.section_id);
            if (section) {
              completedOrderIndices.push(section.order_index);
            }
          }

          if (completedOrderIndices.length > 0) {
            const highestCompleted = Math.max(...completedOrderIndices);
            if (highestCompleted < 5) {
              currentSectionIndex = highestCompleted + 1;
            } else {
              currentSectionIndex = 5;
            }
          } else {
            currentSectionIndex = 1;
          }
        } else {
          currentSectionIndex = 1;
        }
      }
    }

    // If no attempt or current_section is 0, default to Section 1
    if (!testAttempt || currentSectionIndex === 0) {
      currentSectionIndex = 1;
    }

    const sectionsResult = [];

    for (const section of allSections) {
      try {
        let sectionStatus;
        // CRITICAL: Section 1 is NEVER locked
        if (section.order_index === 1) {
          if (!testAttempt) {
            sectionStatus = 'available';
          } else {
            let section1Id = (section.id && typeof section.id === 'number' && section.id > 0) ? section.id : null;
            let section1Progress = null;

            if (section1Id) {
              section1Progress = await SectionProgress.findOne({
                where: {
                  test_attempt_id: testAttempt.id,
                  section_id: section1Id
                }
              });
            } else {
              const dbSection1 = await Section.findOne({ where: { order_index: 1 } });
              if (dbSection1) {
                section1Progress = await SectionProgress.findOne({
                  where: {
                    test_attempt_id: testAttempt.id,
                    section_id: dbSection1.id
                  }
                });
              }
            }

            if (section1Progress && section1Progress.status === SectionStatus.COMPLETED) {
              sectionStatus = 'completed';
            } else if (section1Progress && section1Progress.status === SectionStatus.IN_PROGRESS) {
              sectionStatus = 'IN_PROGRESS';
            } else {
              sectionStatus = 'available';
            }
          }
        } else {
          // Sections 2-5: Apply locking rules
          if (!testAttempt || currentSectionIndex === 0 || currentSectionIndex === 1) {
            sectionStatus = 'locked';
          } else {
            let sectionId = (section.id && typeof section.id === 'number' && section.id > 0) ? section.id : null;
            let progress = null;

            if (sectionId) {
              progress = await SectionProgress.findOne({
                where: {
                  test_attempt_id: testAttempt.id,
                  section_id: sectionId
                }
              });
            } else {
              const dbSection = await Section.findOne({ where: { order_index: section.order_index } });
              if (dbSection) {
                progress = await SectionProgress.findOne({
                  where: {
                    test_attempt_id: testAttempt.id,
                    section_id: dbSection.id
                  }
                });
              }
            }

            if (section.order_index < currentSectionIndex) {
              sectionStatus = 'completed';
            } else if (section.order_index === currentSectionIndex) {
              if (progress && progress.status === SectionStatus.COMPLETED) {
                sectionStatus = 'completed';
              } else if (progress && progress.status === SectionStatus.IN_PROGRESS) {
                sectionStatus = 'IN_PROGRESS';
              } else {
                sectionStatus = 'available';
              }
            } else {
              // Check if previous sections are completed
              let prevSectionsCompleted = true;
              for (const prevSection of allSections) {
                if (prevSection.order_index < section.order_index) {
                  let prevSectionId = (prevSection.id && typeof prevSection.id === 'number' && prevSection.id > 0) ? prevSection.id : null;
                  let prevProgress = null;

                  if (prevSectionId) {
                    prevProgress = await SectionProgress.findOne({
                      where: {
                        test_attempt_id: testAttempt.id,
                        section_id: prevSectionId,
                        status: SectionStatus.COMPLETED
                      }
                    });
                  } else {
                    const dbPrevSection = await Section.findOne({ where: { order_index: prevSection.order_index } });
                    if (dbPrevSection) {
                      prevProgress = await SectionProgress.findOne({
                        where: {
                          test_attempt_id: testAttempt.id,
                          section_id: dbPrevSection.id,
                          status: SectionStatus.COMPLETED
                        }
                      });
                    }
                  }

                  if (!prevProgress) {
                    prevSectionsCompleted = false;
                    break;
                  }
                }
              }

              sectionStatus = prevSectionsCompleted ? 'available' : 'locked';
            }
          }
        }

        let questionCount = QUESTIONS_PER_SECTION;

        // Only query question count if section exists in database
        if (section.id && typeof section.id === 'number' && section.id > 0) {
          try {
            const dbSectionCheck = await Section.findByPk(section.id);
            if (dbSectionCheck) {
              const actualCount = await Question.count({
                where: {
                  section_id: section.id,
                  is_active: true
                }
              });
              if (actualCount > 0) {
                questionCount = actualCount;
              }
            }
          } catch (e) {
            // If query fails, use default
          }
        }

        const sectionId = (section.id && typeof section.id === 'number' && section.id > 0) ? section.id : section.order_index;

        sectionsResult.push({
          id: sectionId,
          name: section.name,
          status: sectionStatus,
          question_count: questionCount,
          time_limit: 420, // Fixed: 7 minutes per section
          order_index: section.order_index
        });
      } catch (error) {
        console.error(`❌ ERROR processing section ${section.order_index}: ${error.message}`);
      }
    }

    return res.json({
      current_section: currentSectionIndex,
      sections: sectionsResult,
      can_attempt_test: canAttemptTest,
      completed_test_attempt_id: completedTestAttemptId,
      test_attempt_id: testAttempt ? testAttempt.id : null // Include in-progress attempt ID
    });
  } catch (error) {
    console.error(`❌ Error in get_sections: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get sections'
    });
  }
});

// GET /test/sections/:section_id/questions
router.get('/sections/:section_id/questions', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    const attemptId = parseInt(req.query.attempt_id, 10);
    const currentUser = req.user;

    // Log request details
    console.log(`🔵 GET /test/sections/${sectionId}/questions - attempt_id=${attemptId}, user_id=${currentUser.id}`);

    // Validate attempt_id parameter
    if (!attemptId || isNaN(attemptId) || attemptId <= 0) {
      console.log(`❌ Invalid attempt_id: ${req.query.attempt_id} (parsed as: ${attemptId})`);
      return res.status(400).json({
        error_code: 'ATTEMPT_INVALID',
        message: 'Invalid attempt_id parameter. Please provide a valid test attempt ID.',
        detail: `attempt_id must be a positive integer, got: ${req.query.attempt_id}`
      });
    }

    // Validate section_id parameter
    if (!sectionId || isNaN(sectionId) || sectionId <= 0) {
      console.log(`❌ Invalid section_id: ${req.params.section_id} (parsed as: ${sectionId})`);
      return res.status(400).json({
        error_code: 'SECTION_INVALID',
        message: 'Invalid section_id parameter. Please provide a valid section ID.',
        detail: `section_id must be a positive integer, got: ${req.params.section_id}`
      });
    }

    // SQL Query 1: Verify test attempt belongs to user
    // SELECT * FROM test_attempts WHERE id = ? AND student_id = ?
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: attemptId,
        student_id: currentUser.id
      }
    });

    if (!testAttempt) {
      console.log(`❌ Test attempt ${attemptId} not found for user ${currentUser.id}`);
      return res.status(404).json({
        error_code: 'ATTEMPT_NOT_FOUND',
        message: 'Test attempt not found or does not belong to you.',
        detail: `No test attempt found with id=${attemptId} for user_id=${currentUser.id}`
      });
    }

    console.log(`✅ Test attempt ${attemptId} found - status: ${testAttempt.status}, student_id: ${testAttempt.student_id}`);

    // Check if attempt is in progress (allow IN_PROGRESS, block COMPLETED/ABANDONED)
    if (testAttempt.status !== TestStatus.IN_PROGRESS) {
      console.log(`❌ Test attempt ${attemptId} is not in progress - status: ${testAttempt.status}`);
      return res.status(400).json({
        error_code: 'ATTEMPT_NOT_IN_PROGRESS',
        message: `Cannot fetch questions. Test attempt is ${testAttempt.status.toLowerCase()}.`,
        detail: `Test attempt ${attemptId} has status: ${testAttempt.status}. Only IN_PROGRESS attempts can fetch questions.`
      });
    }

    // SQL Query 2: Verify section exists - try by ID first, then by order_index
    // SELECT * FROM sections WHERE id = ? OR (order_index = ? AND order_index BETWEEN 1 AND 5)
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      console.log(`❌ Section ${sectionId} not found`);
      return res.status(404).json({
        error_code: 'SECTION_NOT_FOUND',
        message: `Section not found.`,
        detail: `No section found with id=${sectionId} or order_index=${sectionId}`
      });
    }

    console.log(`✅ Section found - id: ${section.id}, order_index: ${section.order_index}, name: ${section.name}`);

    // Check if section is unlocked (previous sections must be completed)
    if (section.order_index > 1) {
      // SQL Query 3: Get previous sections
      // SELECT * FROM sections WHERE order_index < ? AND is_active = true ORDER BY order_index ASC
      const previousSections = await Section.findAll({
        where: {
          order_index: { [Op.lt]: section.order_index },
          is_active: true
        },
        order: [['order_index', 'ASC']]
      });

      // SQL Query 4: Check if previous sections are completed
      // SELECT * FROM section_progress WHERE test_attempt_id = ? AND section_id = ? AND status = 'COMPLETED'
      for (const prevSection of previousSections) {
        const prevProgress = await SectionProgress.findOne({
          where: {
            test_attempt_id: attemptId,
            section_id: prevSection.id,
            status: SectionStatus.COMPLETED
          }
        });

        if (!prevProgress) {
          console.log(`❌ Previous section ${prevSection.order_index} (${prevSection.name}) not completed`);
          return res.status(403).json({
            error_code: 'SECTION_LOCKED',
            message: `Please complete ${prevSection.name} first.`,
            detail: `Section ${section.order_index} (${section.name}) is locked. Previous section ${prevSection.order_index} (${prevSection.name}) must be completed first.`
          });
        }
      }
    }

    // SQL Query 5: Check if questions already exist for this attempt + section
    // SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ? 
    // AND question_id IN (SELECT id FROM questions WHERE section_id = ? AND is_active = true AND status = 'approved')
    const existingAttemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: attemptId
      },
      include: [{
        model: Question,
        as: 'question',
        where: {
          section_id: section.id,
          is_active: true,
          status: 'approved'
        },
        attributes: ['id']
      }],
      attributes: ['question_id']
    });

    let selectedQuestionIds = existingAttemptQuestions.map(tq => tq.question_id);

    // If questions not assigned yet for this section, generate them now (idempotent - safe to call multiple times)
    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      console.log(`⚠️ Test attempt ${attemptId} has no questions assigned for section ${section.id}, generating now...`);

      // SQL Query 6: Count eligible questions for this section FIRST (for validation)
      // SELECT COUNT(*) FROM questions WHERE section_id = ? AND status = 'approved' AND is_active = true
      const eligibleQuestionCount = await Question.count({
        where: {
          section_id: section.id,
          status: 'approved',
          is_active: true
        }
      });

      console.log(`🔵 Found ${eligibleQuestionCount} eligible questions in section ${section.id} (${section.name})`);

      // Validate minimum 7 questions required for this section
      // NEVER throw error if questions > 7, ONLY if < 7
      if (eligibleQuestionCount < 7) {
        console.log(`❌ Insufficient questions in section ${section.id}: ${eligibleQuestionCount} < 7`);
        return res.status(400).json({
          error_code: 'INSUFFICIENT_QUESTIONS',
          message: `Cannot start section. Minimum 7 questions required in ${section.name}.`,
          detail: `Section ${section.id} (${section.name}) has only ${eligibleQuestionCount} active and approved questions. At least 7 are required.`
        });
      }

      // Get previous attempt question IDs for this section to avoid repetition (if retake allowed)
      let previousQuestionIds = [];
      // SQL Query 7: Get previous completed attempt
      // SELECT * FROM test_attempts WHERE student_id = ? AND status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1
      const previousAttempt = await TestAttempt.findOne({
        where: {
          student_id: currentUser.id,
          status: TestStatus.COMPLETED
        },
        order: [['completed_at', 'DESC']]
      });

      if (previousAttempt) {
        // SQL Query 8: Get questions from previous attempt for this section
        // SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ? 
        // AND question_id IN (SELECT id FROM questions WHERE section_id = ?)
        const previousAttemptQuestions = await TestAttemptQuestion.findAll({
          where: {
            test_attempt_id: previousAttempt.id
          },
          include: [{
            model: Question,
            as: 'question',
            where: {
              section_id: section.id
            },
            attributes: ['id']
          }],
          attributes: ['question_id']
        });

        previousQuestionIds = previousAttemptQuestions.map(tq => tq.question_id);
        console.log(`🔵 Previous attempt had ${previousQuestionIds.length} questions in section ${section.id}`);
      }

      // Build WHERE clause for candidate questions
      let candidateWhereClause = {
        section_id: section.id,
        status: 'approved',
        is_active: true
      };

      // If we have previous questions and enough total questions, exclude them
      if (previousQuestionIds.length > 0 && eligibleQuestionCount > 7) {
        candidateWhereClause.id = {
          [Op.notIn]: previousQuestionIds
        };
      }

      // SQL Query 9: Randomly select exactly 7 questions using SQL ORDER BY RAND()
      // SELECT id FROM questions WHERE section_id = ? AND status = 'approved' AND is_active = true 
      // [AND id NOT IN (...)] ORDER BY RAND() LIMIT 7
      const candidateQuestions = await Question.findAll({
        where: candidateWhereClause,
        attributes: ['id'],
        order: [[sequelize.literal('RANDOM()'), 'ASC']], // SQL RANDOM selection
        limit: 7,
        raw: true
      });

      // If we filtered out previous questions but don't have enough, fall back to all questions
      if (candidateQuestions.length < 7 && previousQuestionIds.length > 0) {
        console.log(`⚠️ Not enough unique questions (${candidateQuestions.length}), falling back to all available questions`);
        const allQuestions = await Question.findAll({
          where: {
            section_id: section.id,
            status: 'approved',
            is_active: true
          },
          attributes: ['id'],
          order: [[sequelize.literal('RANDOM()'), 'ASC']], // SQL RANDOM selection
          limit: 7,
          raw: true
        });
        selectedQuestionIds = allQuestions.map(q => q.id);
      } else {
        selectedQuestionIds = candidateQuestions.map(q => q.id);
      }

      console.log(`✅ Randomly selected ${selectedQuestionIds.length} questions using SQL RANDOM() for section ${section.id}: [${selectedQuestionIds.join(', ')}]`);

      // SQL Query 9: Insert selected questions into junction table
      // INSERT INTO test_attempt_questions (test_attempt_id, question_id, created_at) VALUES (?, ?, NOW())
      const questionRecords = selectedQuestionIds.map(qid => ({
        test_attempt_id: attemptId,
        question_id: qid
      }));

      await TestAttemptQuestion.bulkCreate(questionRecords, {
        ignoreDuplicates: true // Idempotent: if already exists, ignore
      });

      console.log(`✅ Generated and saved ${selectedQuestionIds.length} randomly selected questions for attempt ${attemptId}, section ${section.id}: [${selectedQuestionIds.join(', ')}]`);
    } else {
      console.log(`✅ Test attempt ${attemptId} already has ${selectedQuestionIds.length} questions assigned for section ${section.id}: [${selectedQuestionIds.join(', ')}]`);
    }

    // SQL Query 10: Get questions for this section from the junction table
    // SELECT q.* FROM questions q 
    // INNER JOIN test_attempt_questions taq ON q.id = taq.question_id 
    // WHERE taq.test_attempt_id = ? AND q.section_id = ? AND q.is_active = true AND q.status = 'approved'
    // ORDER BY q.id ASC
    const questions = await Question.findAll({
      where: {
        id: { [Op.in]: selectedQuestionIds },
        section_id: section.id,
        is_active: true,
        status: 'approved'
      },
      order: [['id', 'ASC']]
    });

    console.log(`✅ Found ${questions.length} questions for section ${section.id} (${section.name}) from junction table`);

    // Return questions (idempotent - same questions returned on refresh)
    return res.json(
      questions.map(q => ({
        question_id: q.id,
        question_text: q.question_text,
        options: parseOptionsToArray(q.options)
      }))
    );
  } catch (error) {
    console.error(`❌ Error in get_section_questions: ${error.name}: ${error.message}`);
    console.error(`❌ Error stack: ${error.stack}`);
    return res.status(500).json({
      error_code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while fetching section questions.',
      detail: error.message
    });
  }
});

// POST /test/sections/:section_id/start
router.post('/sections/:section_id/start', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    // Support both query parameter and body
    const attemptId = parseInt(req.body.attempt_id || req.query.attempt_id, 10);
    const currentUser = req.user;

    console.log(`🔵 start_section: sectionId=${sectionId}, attemptId=${attemptId}, userId=${currentUser.id}`);

    if (!attemptId || isNaN(attemptId)) {
      return res.status(400).json({
        detail: 'attempt_id is required'
      });
    }

    // Verify test attempt
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: attemptId,
        student_id: currentUser.id
      }
    });

    if (!testAttempt) {
      console.log(`❌ Test attempt ${attemptId} not found for user ${currentUser.id}`);
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // Verify section exists
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      console.log(`❌ Section ${sectionId} not found`);
      return res.status(404).json({
        detail: `Section not found (ID: ${sectionId})`
      });
    }

    console.log(`✅ Found section: id=${section.id}, order_index=${section.order_index}, name=${section.name}`);

    // Section start validation based on current_section_id
    if (testAttempt.current_section_id) {
      const currentSectionFromAttempt = await Section.findByPk(testAttempt.current_section_id);
      if (currentSectionFromAttempt) {
        // Allow: section_id == current_section OR section_id < current_section (already done)
        // Block: section_id > current_section (not unlocked yet)
        if (section.order_index > currentSectionFromAttempt.order_index) {
          return res.status(403).json({
            detail: `Please complete Section ${currentSectionFromAttempt.order_index}: ${currentSectionFromAttempt.name} first`
          });
        }
        // If section_id < current_section, allow (already completed)
        // If section_id == current_section, allow (current section)
      }
    } else {
      // No current section set - check if section 1 or all previous sections completed
      if (section.order_index > 1) {
        const previousSections = await Section.findAll({
          where: {
            order_index: { [Op.lt]: section.order_index },
            is_active: true
          },
          order: [['order_index', 'ASC']]
        });

        for (const prevSection of previousSections) {
          const prevProgress = await SectionProgress.findOne({
            where: {
              test_attempt_id: attemptId,
              section_id: prevSection.id
            }
          });

          const isCompleted = prevProgress && (
            prevProgress.status === 'COMPLETED' ||
            prevProgress.status === SectionStatus.COMPLETED
          );

          if (!isCompleted) {
            return res.status(403).json({
              detail: `Please complete ${prevSection.name} first`
            });
          }
        }
      }
    }

    // Get or create section progress
    let progress = await SectionProgress.findOne({
      where: {
        test_attempt_id: attemptId,
        section_id: section.id
      }
    });

    if (!progress) {
      console.log(`🔵 Creating new section progress for section ${section.id}`);
      try {
        progress = await SectionProgress.create({
          test_attempt_id: attemptId,
          section_id: section.id,
          status: 'IN_PROGRESS', // Use string directly for ENUM
          section_start_time: new Date()
        });

        // Update test attempt with current section state
        testAttempt.current_section_id = section.id;
        testAttempt.current_question_index = 0;
        testAttempt.remaining_time_seconds = 420;
        await testAttempt.save();
        console.log(`✅ Created section progress: id=${progress.id}`);
      } catch (createError) {
        console.error(`❌ Failed to create section progress: ${createError.message}`);
        console.error(`❌ Error details:`, createError);
        throw createError;
      }
    } else {
      console.log(`🔵 Found existing progress: id=${progress.id}, status=${progress.status}`);
      if (progress.status === 'NOT_STARTED' || progress.status === SectionStatus.NOT_STARTED) {
        progress.status = 'IN_PROGRESS';
        progress.section_start_time = new Date();
        await progress.save();
      } else if (progress.status === 'COMPLETED' || progress.status === SectionStatus.COMPLETED) {
        return res.status(400).json({
          detail: 'Section already completed'
        });
      } else if (progress.paused_at) {
        // Resume from pause
        const pausedDuration = (new Date() - progress.paused_at) / 1000;
        progress.total_time_spent += Math.floor(pausedDuration);
        progress.paused_at = null;
        progress.status = 'IN_PROGRESS';
        if (!progress.section_start_time) {
          progress.section_start_time = new Date();
        }
        await progress.save();
      }
    }

    return res.json({
      section_id: section.id,
      section_name: section.name,
      status: progress.status,
      total_time_spent: progress.total_time_spent,
      is_paused: progress.paused_at !== null,
      current_time: progress.total_time_spent
    });
  } catch (error) {
    console.error(`❌ Error in start_section: ${error.message}`);
    console.error(`❌ Error stack: ${error.stack}`);
    return res.status(500).json({
      detail: `Failed to start section: ${error.message}`
    });
  }
});

// POST /test/sections/:section_id/pause
router.post('/sections/:section_id/pause', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    // Support both query parameter and body
    const attemptId = parseInt(req.body.attempt_id || req.query.attempt_id, 10);
    const currentUser = req.user;

    if (!attemptId || isNaN(attemptId)) {
      return res.status(400).json({
        detail: 'attempt_id is required'
      });
    }

    // Find section
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      return res.status(404).json({
        detail: `Section not found (ID: ${sectionId})`
      });
    }

    // Find progress
    const progress = await SectionProgress.findOne({
      where: {
        test_attempt_id: attemptId,
        section_id: section.id
      }
    });

    if (!progress) {
      return res.status(404).json({
        detail: 'Section progress not found'
      });
    }

    if (progress.status !== SectionStatus.IN_PROGRESS || progress.paused_at) {
      return res.status(400).json({
        detail: 'Section is not running'
      });
    }

    // Get test attempt to store remaining_time_seconds
    const testAttempt = await TestAttempt.findByPk(attemptId);
    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // Calculate remaining time and store it
    const SECTION_TIME_LIMIT = 420;
    let remainingTime = SECTION_TIME_LIMIT;

    if (progress.section_start_time && !progress.paused_at) {
      const elapsed = (new Date() - progress.section_start_time) / 1000;
      progress.total_time_spent += Math.floor(elapsed);
      remainingTime = Math.max(0, SECTION_TIME_LIMIT - progress.total_time_spent);
    } else if (progress.total_time_spent > 0) {
      remainingTime = Math.max(0, SECTION_TIME_LIMIT - progress.total_time_spent);
    }

    // Store remaining time in test_attempt for persistence
    testAttempt.remaining_time_seconds = remainingTime;
    await testAttempt.save();

    progress.paused_at = new Date();
    progress.section_start_time = null; // Clear start time when paused
    await progress.save();

    return res.json({
      message: 'Section paused',
      remaining_time_seconds: remainingTime,
      total_time_spent: progress.total_time_spent
    });
  } catch (error) {
    console.error(`❌ Error in pause_section: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to pause section'
    });
  }
});

// POST /test/sections/:section_id/resume
router.post('/sections/:section_id/resume', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    // Support both query parameter and body
    const attemptId = parseInt(req.body.attempt_id || req.query.attempt_id, 10);
    const currentUser = req.user;

    if (!attemptId || isNaN(attemptId)) {
      return res.status(400).json({
        detail: 'attempt_id is required'
      });
    }

    // Find section
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      return res.status(404).json({
        detail: `Section not found (ID: ${sectionId})`
      });
    }

    // Find progress
    const progress = await SectionProgress.findOne({
      where: {
        test_attempt_id: attemptId,
        section_id: section.id
      }
    });

    if (!progress || !progress.paused_at) {
      return res.status(400).json({
        detail: 'Section is not paused'
      });
    }

    // Get test attempt to retrieve remaining_time_seconds
    const testAttempt = await TestAttempt.findByPk(attemptId);
    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // Resume timer - continue from remaining_time_seconds stored in test_attempt
    const SECTION_TIME_LIMIT = 420;
    const remainingTime = testAttempt.remaining_time_seconds || (SECTION_TIME_LIMIT - progress.total_time_spent);

    // Calculate new total_time_spent based on remaining time
    progress.total_time_spent = Math.max(0, SECTION_TIME_LIMIT - remainingTime);

    progress.section_start_time = new Date();
    progress.paused_at = null;
    progress.status = SectionStatus.IN_PROGRESS;
    await progress.save();

    return res.json({
      message: 'Section resumed',
      remaining_time_seconds: remainingTime,
      total_time_spent: progress.total_time_spent
    });
  } catch (error) {
    console.error(`❌ Error in resume_section: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to resume section'
    });
  }
});

// GET /test/sections/:section_id/timer
router.get('/sections/:section_id/timer', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    const attemptId = parseInt(req.query.attempt_id, 10);
    const currentUser = req.user;

    // Find section
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      return res.status(404).json({
        detail: `Section not found (ID: ${sectionId})`
      });
    }

    // Find progress
    const progress = await SectionProgress.findOne({
      where: {
        test_attempt_id: attemptId,
        section_id: section.id
      }
    });

    if (!progress) {
      return res.json({
        section_id: section.id,
        section_name: section.name,
        status: SectionStatus.NOT_STARTED,
        total_time_spent: 0,
        is_paused: false,
        current_time: 0
      });
    }

    // Calculate current time if running
    const SECTION_TIME_LIMIT = 420; // 7 minutes in seconds
    let currentTime = progress.total_time_spent;

    if (progress.section_start_time && !progress.paused_at) {
      const elapsed = (new Date() - progress.section_start_time) / 1000;
      currentTime = progress.total_time_spent + Math.floor(elapsed);

      // Enforce time limit - auto-complete if exceeded
      if (currentTime >= SECTION_TIME_LIMIT) {
        progress.total_time_spent = SECTION_TIME_LIMIT;
        progress.section_start_time = null;
        progress.status = SectionStatus.COMPLETED;
        progress.paused_at = null;
        await progress.save();
        currentTime = SECTION_TIME_LIMIT;
      }
    }

    // Cap current_time at limit
    currentTime = Math.min(currentTime, SECTION_TIME_LIMIT);

    return res.json({
      section_id: section.id,
      section_name: section.name,
      status: progress.status,
      total_time_spent: progress.total_time_spent,
      is_paused: progress.paused_at !== null,
      current_time: currentTime
    });
  } catch (error) {
    console.error(`❌ Error in get_section_timer: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get section timer'
    });
  }
});

// POST /test/sections/:section_id/submit
router.post('/sections/:section_id/submit', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const sectionId = parseInt(req.params.section_id, 10);
    const { attempt_id, section_id: bodySectionId, answers } = req.body;
    const currentUser = req.user;

    if (bodySectionId !== sectionId) {
      return res.status(400).json({
        detail: 'Section ID mismatch'
      });
    }

    // Verify test attempt (will be used later to update current_section_id)
    let testAttempt = await TestAttempt.findOne({
      where: {
        id: attempt_id,
        student_id: currentUser.id
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found'
      });
    }

    // Verify section
    let section = await Section.findByPk(sectionId);
    if (!section && sectionId >= 1 && sectionId <= 5) {
      section = await Section.findOne({ where: { order_index: sectionId } });
    }

    if (!section) {
      return res.status(404).json({
        detail: `Section not found (ID: ${sectionId})`
      });
    }

    // Get selected question IDs from junction table for this section only
    // SQL Query: SELECT question_id FROM test_attempt_questions WHERE test_attempt_id = ? 
    // AND question_id IN (SELECT id FROM questions WHERE section_id = ?)
    const attemptQuestions = await TestAttemptQuestion.findAll({
      where: {
        test_attempt_id: attempt_id
      },
      include: [{
        model: Question,
        as: 'question',
        where: {
          section_id: section.id,
          is_active: true,
          status: 'approved'
        },
        attributes: ['id']
      }],
      attributes: ['question_id']
    });

    const selectedQuestionIds = attemptQuestions.map(tq => tq.question_id);

    if (!selectedQuestionIds || selectedQuestionIds.length === 0) {
      return res.status(400).json({
        error_code: 'NO_QUESTIONS_ASSIGNED',
        message: `No questions assigned for section ${section.name}. Please access this section first to generate questions.`,
        detail: `Test attempt ${attempt_id} has no questions assigned for section ${section.id} (${section.name}). Please access the section to generate questions.`
      });
    }

    // Get section questions from junction table
    const sectionQuestions = await Question.findAll({
      where: {
        id: { [Op.in]: selectedQuestionIds },
        section_id: section.id,
        is_active: true,
        status: 'approved'
      },
      order: [['id', 'ASC']]
    });

    if (answers.length !== sectionQuestions.length) {
      return res.status(400).json({
        detail: `Must answer all questions in section. Expected ${sectionQuestions.length}, got ${answers.length}`
      });
    }

    // Check if section already submitted
    let progress = await SectionProgress.findOne({
      where: {
        test_attempt_id: attempt_id,
        section_id: section.id
      }
    });

    // If section is already completed, still update current_section_id and return success (idempotent)
    if (progress && (progress.status === SectionStatus.COMPLETED || progress.status === 'COMPLETED')) {
      console.log(`ℹ️ Section ${section.order_index} (${section.name}) already completed, updating current_section_id`);

      // Find next section
      const allSections = await Section.findAll({
        where: { is_active: true },
        order: [['order_index', 'ASC']]
      });
      const nextSection = allSections.find(s => s.order_index === section.order_index + 1);

      if (nextSection) {
        testAttempt.current_section_id = nextSection.id;
        testAttempt.current_question_index = 0;
        testAttempt.remaining_time_seconds = 420;
        await testAttempt.save();
      }

      // Get current section order_index for response
      const currentSectionOrderIndex = nextSection ? nextSection.order_index : null;

      return res.json({
        status: 'COMPLETED',
        completed_section: section.id,
        current_section: currentSectionOrderIndex
      });
    }

    // Check for existing answers - if ALL answers exist, section is already submitted (idempotent)
    const questionIds = answers.map(a => a.question_id);
    const existingAnswers = await Answer.findAll({
      where: {
        test_attempt_id: attempt_id,
        question_id: questionIds
      }
    });

    const existingQuestionIds = new Set(existingAnswers.map(a => a.question_id));
    const allAnswersExist = questionIds.every(qId => existingQuestionIds.has(qId));

    // If all answers already exist, treat as already submitted (idempotent)
    // Still mark section as completed and update current_section_id
    if (allAnswersExist) {
      console.log(`ℹ️ All answers already exist for section ${section.order_index}, marking as completed (idempotent)`);

      // Ensure section progress is marked as completed
      if (!progress) {
        progress = await SectionProgress.create({
          test_attempt_id: attempt_id,
          section_id: section.id,
          status: SectionStatus.COMPLETED,
          total_time_spent: 0
        });
      } else if (progress.status !== SectionStatus.COMPLETED && progress.status !== 'COMPLETED') {
        progress.status = SectionStatus.COMPLETED;
        progress.paused_at = null;
        await progress.save();
      }

      // Update test attempt with next section
      const allSections = await Section.findAll({
        where: { is_active: true },
        order: [['order_index', 'ASC']]
      });
      const nextSection = allSections.find(s => s.order_index === section.order_index + 1);

      if (nextSection) {
        testAttempt.current_section_id = nextSection.id;
        testAttempt.current_question_index = 0;
        testAttempt.remaining_time_seconds = 420;
        await testAttempt.save();
      } else {
        testAttempt.status = TestStatus.COMPLETED;
        testAttempt.completed_at = new Date();
        testAttempt.current_section_id = null;
        await testAttempt.save();
      }

      return res.json({
        status: 'COMPLETED',
        completed_section: sectionId,
        current_section: nextSection?.order_index || null
      });
    }

    // Save only new answers (idempotent - don't error if already submitted)
    const questionMap = {};
    for (const q of sectionQuestions) {
      questionMap[q.id] = q;
    }

    for (const answerData of answers) {
      if (!questionMap[answerData.question_id]) {
        return res.status(400).json({
          detail: `Question ${answerData.question_id} does not belong to this section`
        });
      }

      // Only create if answer doesn't exist
      if (!existingQuestionIds.has(answerData.question_id)) {
        await Answer.create({
          test_attempt_id: attempt_id,
          question_id: answerData.question_id,
          answer_text: answerData.selected_option
        });
      }
    }

    // CRITICAL: Enforce 7-minute (420 seconds) limit per section
    const SECTION_TIME_LIMIT = 420;

    // Update section progress
    if (!progress) {
      progress = await SectionProgress.create({
        test_attempt_id: attempt_id,
        section_id: section.id,
        status: SectionStatus.COMPLETED,
        total_time_spent: 0
      });
      console.log(`✅ Created new section progress for section ${section.order_index} (${section.name}) with COMPLETED status`);
    } else {
      // Finalize timer
      if (progress.section_start_time && !progress.paused_at) {
        const elapsed = (new Date() - progress.section_start_time) / 1000;
        progress.total_time_spent += Math.floor(elapsed);
        progress.section_start_time = null;
      }

      // Cap time spent at limit
      progress.total_time_spent = Math.min(progress.total_time_spent, SECTION_TIME_LIMIT);
      progress.status = SectionStatus.COMPLETED; // Use enum constant
      progress.paused_at = null;
      await progress.save();

      // Reload to ensure we have the latest data
      await progress.reload();
      console.log(`✅ Section ${section.order_index} (${section.name}) marked as COMPLETED. Status: ${progress.status}, ID: ${progress.id}, Test Attempt: ${attempt_id}`);

      // Verify the status was saved correctly
      const verifyProgress = await SectionProgress.findOne({
        where: {
          test_attempt_id: attempt_id,
          section_id: section.id
        }
      });
      console.log(`🔍 Verification: Section ${section.order_index} status in DB: ${verifyProgress?.status}`);
    }

    // Update test attempt with next section
    const allSections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });
    const nextSection = allSections.find(s => s.order_index === section.order_index + 1);

    if (nextSection) {
      testAttempt.current_section_id = nextSection.id;
      testAttempt.current_question_index = 0;
      testAttempt.remaining_time_seconds = 420;
      await testAttempt.save();
      console.log(`✅ Updated test attempt current_section_id to ${nextSection.id} (${nextSection.name})`);
    } else {
      // All sections completed
      testAttempt.status = TestStatus.COMPLETED;
      testAttempt.completed_at = new Date();
      testAttempt.current_section_id = null;
      await testAttempt.save();
      console.log(`✅ All sections completed, test attempt marked as COMPLETED`);
    }

    // Get current section order_index for response
    const currentSectionOrderIndex = nextSection ? nextSection.order_index : null;

    return res.json({
      status: 'COMPLETED',
      completed_section: sectionId,
      current_section: currentSectionOrderIndex
    });
  } catch (error) {
    console.error(`❌ Error in submit_section: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to submit section'
    });
  }
});

// POST /test/:test_attempt_id/update-state - Update test state (question index, remaining time)
router.post('/:test_attempt_id/update-state', getCurrentUser, requireStudent, async (req, res) => {
  try {
    const testAttemptId = parseInt(req.params.test_attempt_id, 10);
    const { current_question_index, remaining_time_seconds } = req.body;
    const currentUser = req.user;

    // Verify test attempt belongs to current user
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: testAttemptId,
        student_id: currentUser.id,
        status: TestStatus.IN_PROGRESS
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found or not in progress'
      });
    }

    // Update state fields
    if (current_question_index !== undefined) {
      testAttempt.current_question_index = Math.max(0, parseInt(current_question_index, 10));
    }
    if (remaining_time_seconds !== undefined) {
      testAttempt.remaining_time_seconds = Math.max(0, parseInt(remaining_time_seconds, 10));
    }

    await testAttempt.save();

    return res.json({
      success: true,
      current_question_index: testAttempt.current_question_index,
      remaining_time_seconds: testAttempt.remaining_time_seconds
    });
  } catch (error) {
    console.error(`❌ Error in update_test_state: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to update test state'
    });
  }
});

module.exports = router;

