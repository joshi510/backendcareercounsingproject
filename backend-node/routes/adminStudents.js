const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, UserRole, Student, TestAttempt, TestStatus, InterpretedResult, CounsellorNote, Score } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');

// GET /admin/students - Get all students with their information (with pagination)
router.get('', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    console.log('🔵 GET /admin/students - Request received');
    console.log('🔵 User making request:', req.user?.id, req.user?.email);
    
    // Parse pagination parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    
    // Parse filter parameters
    const searchQuery = req.query.search || '';
    const statusFilter = req.query.status || 'all';
    const readinessFilter = req.query.readiness || 'all';
    
    // Validate pagination parameters
    if (page < 1) {
      return res.status(400).json({
        detail: 'Page number must be greater than 0'
      });
    }
    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        detail: 'Limit must be between 1 and 100'
      });
    }
    
    // Build where clause for User
    const userWhere = { role: UserRole.STUDENT };
    
    if (searchQuery) {
      userWhere[Op.or] = [
        { email: { [Op.like]: `%${searchQuery}%` } },
        { full_name: { [Op.like]: `%${searchQuery}%` } }
      ];
    }
    
    // For status/readiness filters, we need to fetch all matching students first,
    // then filter by computed values, then paginate
    // Fetch all students if filters are active, otherwise use normal pagination
    const shouldFetchAll = statusFilter !== 'all' || readinessFilter !== 'all';
    
    // Fetch students
    const students = await User.findAll({
      where: userWhere,
      include: [
        {
          model: Student,
          as: 'studentProfile',
          required: false,
          where: searchQuery ? {
            mobile_number: { [Op.like]: `%${searchQuery}%` }
          } : undefined
        }
      ],
      order: [['created_at', 'DESC']],
      limit: shouldFetchAll ? null : limit,
      offset: shouldFetchAll ? null : offset
    });

    // Helper function to compute readiness based on test status and score
    // Returns values that match frontend expectations: 'READY', 'PARTIALLY READY', 'NOT READY', or null for Pending
    const computeReadiness = (testStatus, score) => {
      if (!testStatus || testStatus === 'ABANDONED') {
        return null; // Pending - frontend will handle this
      }
      if (testStatus === 'IN_PROGRESS') {
        return null; // Pending - frontend will handle this
      }
      if (testStatus === 'COMPLETED') {
        if (score === null || score === undefined) {
          return null; // Pending - frontend will handle this
        }
        if (score >= 75) {
          return 'READY';
        }
        if (score >= 50) {
          return 'PARTIALLY READY';
        }
        return 'NOT READY';
      }
      return null; // NOT_STARTED (no test attempt) - Pending
    };

    // Helper function to compute risk based on test status and readiness
    // Returns uppercase values: 'LOW', 'MEDIUM', 'HIGH'
    const computeRisk = (testStatus, readiness) => {
      if (!testStatus || testStatus === 'ABANDONED') {
        return 'LOW'; // NOT_STARTED
      }
      if (testStatus === 'IN_PROGRESS') {
        return 'MEDIUM';
      }
      if (testStatus === 'COMPLETED') {
        if (readiness === 'NOT READY') {
          return 'HIGH';
        }
        if (readiness === 'PARTIALLY READY') {
          return 'MEDIUM';
        }
        if (readiness === 'READY') {
          return 'LOW';
        }
        return 'MEDIUM'; // Default for completed but unknown readiness
      }
      return 'LOW'; // NOT_STARTED
    };

    // Helper function to compute actions based on test status
    const computeActions = (testStatus) => {
      if (!testStatus || testStatus === 'ABANDONED') {
        // NOT_STARTED
        return {
          resume_test: true,
          view_result: false,
          assign_counsellor: false
        };
      }
      if (testStatus === 'IN_PROGRESS') {
        return {
          resume_test: true,
          view_result: false,
          assign_counsellor: false
        };
      }
      if (testStatus === 'COMPLETED') {
        return {
          resume_test: false,
          view_result: true,
          assign_counsellor: true
        };
      }
      // Default for NOT_STARTED
      return {
        resume_test: true,
        view_result: false,
        assign_counsellor: false
      };
    };

    // Helper function to compute AI insight based on test status and readiness
    // Returns a one-line, friendly, parent/counsellor-readable insight
    const computeAIInsight = (testStatus, readiness) => {
      // CASE 1: NOT_STARTED
      if (!testStatus || testStatus === 'ABANDONED') {
        return 'Student has not started the assessment yet. Encourage them to begin to understand their strengths.';
      }
      
      // CASE 2: IN_PROGRESS
      if (testStatus === 'IN_PROGRESS') {
        return 'Student is currently attempting the assessment and should complete it for accurate career guidance.';
      }
      
      // CASE 3, 4, 5: COMPLETED
      if (testStatus === 'COMPLETED') {
        if (readiness === 'READY') {
          // CASE 3: High Readiness
          return 'Student shows strong career readiness and can move forward with confident career planning.';
        }
        if (readiness === 'PARTIALLY READY') {
          // CASE 4: Medium Readiness
          return 'Student has developing strengths and may benefit from focused skill improvement before final decisions.';
        }
        if (readiness === 'NOT READY') {
          // CASE 5: Low Readiness
          return 'Student is in an exploration stage and should focus on learning and self-discovery before choosing a career.';
        }
        // Fallback for completed but unknown readiness
        return 'Student has completed the assessment and is ready for career guidance discussion.';
      }
      
      // Default fallback
      return 'Student assessment status is being processed.';
    };

    // Get score and readiness data for completed tests
    const studentsList = await Promise.all(students.map(async (student) => {
      try {
        const studentProfile = student.studentProfile || null;
        
        // Get latest test attempt for this student
        const latestAttempt = await TestAttempt.findOne({
          where: { student_id: student.id },
          order: [['created_at', 'DESC']]
        });

        const testStatus = latestAttempt ? latestAttempt.status : null;
        let score = null;

        // Get score for completed tests
        if (latestAttempt && latestAttempt.status === TestStatus.COMPLETED) {
          const overallScore = await Score.findOne({
            where: {
              test_attempt_id: latestAttempt.id,
              dimension: 'overall'
            }
          });

          if (overallScore) {
            // score_value is already stored as percentage (0-100), just round to 2 decimal places
            score = Math.round(overallScore.score_value * 100) / 100;
          }
        }

        // Compute readiness, risk, actions, and AI insight
        const readiness = computeReadiness(testStatus, score);
        const risk = computeRisk(testStatus, readiness);
        const actions = computeActions(testStatus);
        const aiInsight = computeAIInsight(testStatus, readiness);

        return {
          id: student.id,
          email: student.email || null,
          full_name: student.full_name || null,
          mobile_number: studentProfile?.mobile_number || null,
          education: studentProfile?.education || null,
          created_at: student.created_at ? new Date(student.created_at).toISOString() : null,
          has_completed_test: latestAttempt ? latestAttempt.status === TestStatus.COMPLETED : false,
          test_attempt_id: latestAttempt ? latestAttempt.id : null,
          test_status: testStatus,
          test_completed_at: latestAttempt && latestAttempt.completed_at ? new Date(latestAttempt.completed_at).toISOString() : null,
          score: score,
          readiness_status: readiness, // Frontend expects this field name
          risk_level: risk, // Frontend expects this field name
          readiness: readiness, // Keep for backward compatibility
          risk: risk, // Keep for backward compatibility
          actions: actions,
          ai_insight: aiInsight
        };
      } catch (studentError) {
        console.error(`❌ Error processing student ${student.id}:`, studentError.message);
        // Return basic student info with default values even if there's an error
        return {
          id: student.id,
          email: student.email || null,
          full_name: student.full_name || null,
          mobile_number: null,
          education: null,
          created_at: student.created_at ? new Date(student.created_at).toISOString() : null,
          has_completed_test: false,
          test_attempt_id: null,
          test_status: null,
          test_completed_at: null,
          score: null,
          readiness_status: null, // Pending - frontend will handle null
          risk_level: 'LOW',
          readiness: null, // Keep for backward compatibility
          risk: 'LOW', // Keep for backward compatibility
          actions: {
            resume_test: true,
            view_result: false,
            assign_counsellor: false
          },
          ai_insight: 'Student has not started the assessment yet. Encourage them to begin to understand their strengths.'
        };
      }
    }));

    // Apply client-side filters (status and readiness) since they depend on computed values
    let filteredStudentsList = studentsList;
    
    if (statusFilter !== 'all') {
      filteredStudentsList = filteredStudentsList.filter(student => {
        if (statusFilter === 'completed') {
          return student.has_completed_test;
        }
        if (statusFilter === 'in_progress') {
          return student.test_status === 'IN_PROGRESS';
        }
        if (statusFilter === 'not_started') {
          return !student.has_completed_test && student.test_status !== 'IN_PROGRESS';
        }
        return true;
      });
    }

    if (readinessFilter !== 'all') {
      filteredStudentsList = filteredStudentsList.filter(student => {
        if (readinessFilter === 'ready') {
          return student.readiness_status === 'READY';
        }
        if (readinessFilter === 'partially_ready') {
          return student.readiness_status === 'PARTIALLY READY';
        }
        if (readinessFilter === 'not_ready') {
          return student.readiness_status === 'NOT READY';
        }
        return true;
      });
    }

    // Apply pagination to filtered results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedStudents = filteredStudentsList.slice(startIndex, endIndex);
    
    // Calculate total records
    // If filters are active, we need to count all filtered results
    // Otherwise, use the DB count
    let totalRecordsCount;
    if (statusFilter !== 'all' || readinessFilter !== 'all') {
      // For filtered results, we need to fetch all to get accurate count
      // This is a limitation - for better performance, consider caching or pre-computing
      totalRecordsCount = filteredStudentsList.length;
    } else {
      // Get total count from DB for non-filtered queries
      totalRecordsCount = await User.count({
        where: userWhere
      });
    }
    
    const totalPages = Math.ceil(totalRecordsCount / limit);
    
    console.log(`✅ Successfully fetched ${paginatedStudents.length} students (page ${page} of ${totalPages})`);
    
    return res.json({
      students: paginatedStudents,
      pagination: {
        total_records: totalRecordsCount,
        total_pages: totalPages,
        current_page: page,
        limit: limit
      }
    });
  } catch (error) {
    console.error(`❌ Error in get_students: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return res.status(500).json({
      detail: 'Failed to get students list',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /admin/students/:studentId/result/:resultId - Get student test result (admin can view any student's result)
// IMPORTANT: This route must come AFTER the main GET /admin/students route to avoid conflicts
// Reuses logic from /student/result/:test_attempt_id but allows admin to view any student's result
router.get('/:studentId/result/:resultId', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    // Parse and validate studentId and resultId (testAttemptId)
    const studentId = parseInt(req.params.studentId, 10);
    const testAttemptId = parseInt(req.params.resultId, 10);

    if (isNaN(studentId) || isNaN(testAttemptId)) {
      return res.status(400).json({
        detail: 'Invalid student ID or result ID'
      });
    }

    // Get student user to verify they exist
    const student = await User.findOne({
      where: {
        id: studentId,
        role: UserRole.STUDENT
      }
    });

    if (!student) {
      return res.status(404).json({
        detail: 'Student not found'
      });
    }

    // Verify test attempt belongs to the given studentId (not req.user)
    // This is the key difference from student route - admin can view any student's result
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: testAttemptId,
        student_id: studentId
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found for this student'
      });
    }

    // Get interpreted result (reuse logic from student route)
    // Specify only the attributes that exist in the database to avoid column errors
    const interpretedResult = await InterpretedResult.findOne({
      where: { test_attempt_id: testAttemptId },
      attributes: ['id', 'test_attempt_id', 'interpretation_text', 'strengths', 'areas_for_improvement', 'created_at']
    });

    if (!interpretedResult) {
      return res.status(404).json({
        detail: 'Results are not yet available for this test attempt'
      });
    }

    // Get career recommendations (reuse logic from student route)
    const { Career } = require('../models');
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

    const DISCLAIMER_TEXT = 'This assessment is designed to provide general career guidance and insights. Results are based on your responses and are intended for informational purposes only. They should not be considered as definitive career decisions or professional diagnoses. We recommend consulting with a qualified career counsellor to discuss your results in detail and explore your options further. Individual results may vary, and career success depends on many factors beyond assessment scores.';

    // Return response in the exact format frontend expects
    return res.json({
      test_attempt_id: testAttemptId,
      interpretation_text: interpretedResult.interpretation_text || '',
      strengths: interpretedResult.strengths || '',
      areas_for_improvement: interpretedResult.areas_for_improvement || '',
      disclaimer: DISCLAIMER_TEXT,
      student: {
        full_name: student.full_name || '',
        email: student.email || ''
      },
      careers: careersResponse
    });
  } catch (error) {
    console.error(`❌ Error in admin get_student_result: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    
    // Handle errors safely - return 404 for not found, 500 for unexpected errors
    const isNotFound = error.name === 'SequelizeEmptyResultError' ||
                      (error.message && error.message.toLowerCase().includes('not found'));
    
    return res.status(isNotFound ? 404 : 500).json({
      detail: isNotFound ? 'Test result not found' : 'Failed to get student result',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/students/:id/counsellor-note - Add counsellor note (admin can act as counsellor)
router.post('/:id/counsellor-note', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const { test_attempt_id, notes } = req.body;
    const adminUser = req.user;

    if (!test_attempt_id || !notes || !notes.trim()) {
      return res.status(400).json({
        detail: 'test_attempt_id and notes are required'
      });
    }

    // Verify student exists
    const student = await User.findOne({
      where: {
        id: studentId,
        role: UserRole.STUDENT
      }
    });

    if (!student) {
      return res.status(404).json({
        detail: 'Student not found'
      });
    }

    // Verify test attempt belongs to student
    const testAttempt = await TestAttempt.findOne({
      where: {
        id: test_attempt_id,
        student_id: studentId
      }
    });

    if (!testAttempt) {
      return res.status(404).json({
        detail: 'Test attempt not found for this student'
      });
    }

    // Create counsellor note (admin acts as counsellor)
    const counsellorNote = await CounsellorNote.create({
      counsellor_id: adminUser.id,
      student_id: studentId,
      test_attempt_id: test_attempt_id,
      notes: notes.trim()
    });

    // Get counsellor info for response
    const counsellor = await User.findByPk(adminUser.id);

    return res.status(201).json({
      id: counsellorNote.id,
      notes: counsellorNote.notes,
      counsellor: {
        id: counsellor.id,
        full_name: counsellor.full_name,
        email: counsellor.email
      },
      created_at: counsellorNote.created_at
    });
  } catch (error) {
    console.error(`❌ Error in add_counsellor_note: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: 'Failed to add counsellor note'
    });
  }
});

// POST /admin/students/:id/allow-retake - Allow student to retake the test
router.post('/:id/allow-retake', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);

    // Verify student exists
    const student = await User.findOne({
      where: {
        id: studentId,
        role: UserRole.STUDENT
      }
    });

    if (!student) {
      return res.status(404).json({
        detail: 'Student not found'
      });
    }

    // Find all completed test attempts for this student
    const completedAttempts = await TestAttempt.findAll({
      where: {
        student_id: studentId,
        status: TestStatus.COMPLETED
      }
    });

    if (completedAttempts.length === 0) {
      return res.json({
        message: 'Student has no completed tests to reset',
        reset_count: 0
      });
    }

    // Delete completed attempts to allow retake
    // Note: This will cascade delete related answers, scores, interpreted results, etc.
    const deletedCount = await TestAttempt.destroy({
      where: {
        student_id: studentId,
        status: TestStatus.COMPLETED
      }
    });

    // Also delete any in-progress attempts to start fresh
    await TestAttempt.destroy({
      where: {
        student_id: studentId,
        status: TestStatus.IN_PROGRESS
      }
    });

    return res.json({
      message: 'Test retake enabled successfully',
      reset_count: deletedCount,
      student_id: studentId
    });
  } catch (error) {
    console.error(`❌ Error in allow_retake: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: 'Failed to allow test retake'
    });
  }
});

module.exports = router;

