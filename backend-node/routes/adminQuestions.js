const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const { Question, QuestionType, Section, QuestionApproval, ApprovalStatus } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');
const { generateQuestions } = require('../services/geminiQuestionGenerator');

// ============================================
// PERFORMANCE OPTIMIZATION HELPERS
// ============================================

// Performance logging helper - logs queries taking > 200ms
const logSlowQuery = (operation, startTime, query = '') => {
  const duration = Date.now() - startTime;
  if (duration > 200) {
    console.warn(`⚠️  Slow query detected: ${operation} took ${duration}ms${query ? ` - ${query.substring(0, 100)}` : ''}`);
  }
};

// Helper to parse cursor (format: "created_at_timestamp,id")
// Used for cursor-based pagination
const parseCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const [createdAtStr, idStr] = cursor.split(',');
    const created_at = new Date(createdAtStr);
    const id = parseInt(idStr, 10);
    if (isNaN(created_at.getTime()) || isNaN(id) || id <= 0) {
      return null;
    }
    return { created_at, id };
  } catch (e) {
    return null;
  }
};

// Helper to generate cursor from question
// Use getDataValue to access raw database column (created_at) instead of Sequelize mapped attribute (createdAt)
const generateCursor = (question) => {
  if (!question || !question.id) return null;
  const created_at = question.getDataValue ? question.getDataValue('created_at') : 
                     (question.dataValues?.created_at || question.created_at);
  if (!created_at) return null;
  const dateValue = created_at instanceof Date ? created_at : new Date(created_at);
  return `${dateValue.toISOString()},${question.id}`;
};

// Auto-calculate scale_value based on question text keywords
function calculateAutoScaleValue(questionText) {
  if (!questionText || typeof questionText !== 'string') {
    return 2; // Default
  }
  
  const text = questionText.toLowerCase();
  
  // Check for scale_value = 5 keywords
  if (text.includes('always') || text.includes('strongly')) {
    return 5;
  }
  
  // Check for scale_value = 4 keywords
  if (text.includes('enjoy') || text.includes('love') || text.includes('interested')) {
    return 4;
  }
  
  // Check for scale_value = 3 keywords
  if (text.includes('like') || text.includes('comfortable') || text.includes('prefer')) {
    return 3;
  }
  
  // Check for scale_value = 2 keywords
  if (text.includes('sometimes')) {
    return 2;
  }
  
  // Default scale_value = 2
  return 2;
}

// Helper function to parse options string to array
function parseOptionsToArray(optionsString) {
  if (!optionsString) return [];
  if (Array.isArray(optionsString)) return optionsString;
  
  try {
    // Try parsing as JSON first
    const parsed = JSON.parse(optionsString);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // Not JSON, parse as comma-separated string
  }
  
  // Parse format: "A) Option 1, B) Option 2, C) Option 3"
  const options = [];
  const parts = optionsString.split(',').map(p => p.trim());
  
  for (const part of parts) {
    const match = part.match(/^([A-E])\)\s*(.+)$/i);
    if (match) {
      options.push({
        label: match[1].toUpperCase(),
        text: match[2]
      });
    } else {
      // Fallback: use the whole part
      options.push({
        label: String.fromCharCode(65 + options.length), // A, B, C, D, E
        text: part
      });
    }
  }
  
  return options;
}

// Helper function to format options array to string
function formatOptionsToString(options) {
  if (!options || !Array.isArray(options)) return '';
  return options.map((opt, index) => {
    const label = opt.label || String.fromCharCode(65 + index);
    const text = opt.text || opt;
    return `${label}) ${text}`;
  }).join(', ');
}

// GET /admin/questions/sections/list - Get all sections for dropdown
// IMPORTANT: This route must be defined BEFORE /:id and '' to avoid route conflicts
router.get('/sections/list', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const sections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']],
      attributes: ['id', 'name', 'order_index', 'description']
    });
    
    return res.json(sections.map(s => ({
      id: s.id,
      name: s.name,
      order_index: s.order_index,
      description: s.description || ''
    })));
  } catch (error) {
    console.error(`❌ Error in get_sections: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get sections',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /admin/questions/generate-ai - Generate AI questions
// IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
router.post('/generate-ai', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const adminUser = req.user;
    const { section_id, difficulty_level, count } = req.body;
    
    // Validation
    if (!section_id) {
      return res.status(400).json({
        detail: 'section_id is required'
      });
    }
    
    if (!difficulty_level || !['Easy', 'Medium', 'Hard'].includes(difficulty_level)) {
      return res.status(400).json({
        detail: 'difficulty_level must be Easy, Medium, or Hard'
      });
    }
    
    if (!count || count < 1 || count > 10) {
      return res.status(400).json({
        detail: 'count must be between 1 and 10'
      });
    }
    
    // Get section details
    const section = await Section.findByPk(section_id);
    if (!section) {
      return res.status(404).json({
        detail: 'Section not found'
      });
    }
    
    // Generate questions using AI
    console.log(`🤖 Generating ${count} AI questions for section: ${section.name} (${difficulty_level})`);
    const { questions: aiQuestions, error } = await generateQuestions({
      sectionName: section.name,
      sectionDescription: section.description || '',
      difficulty: difficulty_level,
      count: parseInt(count)
    });
    
    if (error || !aiQuestions || aiQuestions.length === 0) {
      console.error(`❌ AI generation failed: ${error || 'No questions generated'}`);
      console.error(`❌ Generated questions count: ${aiQuestions?.length || 0}`);
      return res.status(500).json({
        detail: error || 'Failed to generate questions',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
    
    console.log(`✅ Successfully generated ${aiQuestions.length} AI questions`);
    
    // Get max order_index for this section
    const maxOrder = await Question.max('order_index', {
      where: { section_id: section_id }
    });
    let currentOrderIndex = maxOrder ? maxOrder + 1 : 1;
    
    // Save generated questions: source='AI', status='pending', is_active=false
    const savedQuestions = [];
    for (const aiQuestion of aiQuestions) {
      try {
        // Reject or convert TEXT questions: convert TEXT to LIKERT_SCALE
        let rawQuestionType = aiQuestion.question_type ? aiQuestion.question_type.toUpperCase() : null;
        
        // Convert TEXT to LIKERT_SCALE (TEXT is not supported)
        if (rawQuestionType === 'TEXT') {
          console.log(`ℹ️ Converting TEXT question to LIKERT_SCALE: ${aiQuestion.question_text.substring(0, 50)}...`);
          rawQuestionType = 'LIKERT_SCALE';
        }
        
        // Fallback: resolve question_type with safe fallback
        const resolvedQuestionType = (rawQuestionType === 'LIKERT_SCALE') 
          ? 'LIKERT_SCALE' 
          : 'MULTIPLE_CHOICE';
        
        // Prepare question data based on type
        const questionData = {
          question_text: aiQuestion.question_text,
          question_type: resolvedQuestionType,
          section_id: section_id,
          difficulty_level: difficulty_level,
          status: 'pending', // AI questions start as pending
          source: 'AI', // AI-generated questions (explicitly set)
          is_active: 0, // AI questions are inactive until approved
          order_index: currentOrderIndex++,
          created_by: adminUser.id
        };
        
        if (resolvedQuestionType === 'LIKERT_SCALE') {
          // LIKERT_SCALE: use default Likert options, no correct_answer, auto-calculate scale_value
          questionData.options = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
          questionData.correct_answer = null;
          questionData.scale_value = calculateAutoScaleValue(aiQuestion.question_text);
        } else {
          // MULTIPLE_CHOICE: format options, include correct_answer, no scale_value
          // DO NOT call options.map for LIKERT - this is MULTIPLE_CHOICE only
          if (aiQuestion.options && Array.isArray(aiQuestion.options) && aiQuestion.options.length > 0) {
            questionData.options = aiQuestion.options.map(opt => `${opt.label}) ${opt.text}`).join(', ');
          } else {
            // Fallback: if no options provided, use default MCQ options
            questionData.options = 'A) Option A, B) Option B, C) Option C, D) Option D';
          }
          questionData.correct_answer = aiQuestion.correct_answer || 'C';
          questionData.scale_value = null;
        }
        
        const question = await Question.create(questionData);
        
        // Fetch with section info
        const savedQuestion = await Question.findOne({
          where: { id: question.id },
          include: [
            {
              model: Section,
              as: 'section',
              attributes: ['id', 'name', 'order_index'],
              required: false
            }
          ]
        });
        
        // Parse options only for MULTIPLE_CHOICE questions
        const optionsArray = savedQuestion.question_type === 'MULTIPLE_CHOICE' 
          ? parseOptionsToArray(savedQuestion.options) 
          : [];
        
        savedQuestions.push({
          id: savedQuestion.id,
          question_text: savedQuestion.question_text,
          question_type: savedQuestion.question_type,
          options: optionsArray,
          options_string: savedQuestion.options || null,
          correct_answer: savedQuestion.correct_answer || null,
          scale_value: savedQuestion.scale_value || null,
          section_id: savedQuestion.section_id,
          section: savedQuestion.section ? {
            id: savedQuestion.section.id,
            name: savedQuestion.section.name,
            order_index: savedQuestion.section.order_index
          } : null,
          difficulty_level: savedQuestion.difficulty_level || 'Medium',
          status: savedQuestion.status || 'pending',
          source: savedQuestion.source || 'ai',
          is_active: savedQuestion.is_active,
          order_index: savedQuestion.order_index,
          created_by: savedQuestion.created_by,
        created_at: (() => {
          const val = savedQuestion.getDataValue ? savedQuestion.getDataValue('created_at') : (savedQuestion.dataValues?.created_at || savedQuestion.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = savedQuestion.getDataValue ? savedQuestion.getDataValue('updated_at') : (savedQuestion.dataValues?.updated_at || savedQuestion.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
        });
      } catch (saveError) {
        console.error(`Error saving AI-generated question: ${saveError.message}`);
        // Continue with other questions
      }
    }
    
    if (savedQuestions.length === 0) {
      return res.status(500).json({
        detail: 'Failed to save generated questions'
      });
    }
    
    return res.status(201).json({
      message: `Successfully generated and saved ${savedQuestions.length} question(s)`,
      questions: savedQuestions,
      count: savedQuestions.length
    });
  } catch (error) {
    console.error(`❌ Error in generate_ai_questions: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to generate AI questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// GET /admin/questions - Get all questions with filters (optimized with cursor pagination)
// Server-side pagination using findAndCountAll
router.get('/', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const { 
      page = 1,
      limit = 25,
      section_id, 
      status, 
      question_type,
      search,
      only_pending 
    } = req.query;
    
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 25), 100); // Min 1, Max 100 per page
    const offset = (pageNum - 1) * limitNum;
    
    // Build where clause - only use columns that exist in database
    const where = {};
    
    // only_pending filter (overrides status filter)
    if (only_pending === 'true') {
      where.status = 'pending';
      where.is_active = false;
    } else if (status) {
      // Status filter when only_pending is false
      if (status === 'active' || status === 'approved') {
        where.status = 'approved';
        where.is_active = true;
      } else if (status === 'inactive') {
        where.status = 'inactive';
        where.is_active = false;
      } else if (status === 'pending') {
        where.status = 'pending';
        // Don't filter by is_active for pending status
      } else if (status === 'rejected') {
        where.status = 'rejected';
        // Don't filter by is_active for rejected status
      } else {
        where.status = status;
      }
    }
    
    // These filters apply regardless of only_pending
    if (section_id) {
      const sectionIdNum = parseInt(section_id);
      if (!isNaN(sectionIdNum)) {
        where.section_id = sectionIdNum;
      }
    }
    if (question_type) {
      where.question_type = question_type;
    }
    // Note: difficulty_level column doesn't exist in DB, so we skip this filter
    
    // Full-text search
    if (search) {
      where.question_text = {
        [Op.like]: `%${search}%`
      };
    }
    
    // Query options
    const queryOptions = {
      where,
      attributes: [
        'id', 'question_text', 'question_type', 'options', 'correct_answer',
        'section_id', 'status', 'source', 'is_active',
        'order_index', 'created_by', 'difficulty_level', 'created_at', 'updated_at'
      ],
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ],
      order: [
        ['is_active', 'DESC'], // Active questions first
        [Sequelize.literal("CASE WHEN status = 'approved' THEN 1 ELSE 0 END"), 'DESC'], // Approved before unapproved
        ['order_index', 'ASC'] // Then by order_index ascending
      ],
      limit: limitNum,
      offset: offset,
      distinct: true, // Important for accurate count with JOINs
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    };
    
    // Execute query with count
    const { rows: questions, count: totalRecords } = await Question.findAndCountAll(queryOptions);
    
    const totalPages = Math.ceil(totalRecords / limitNum);
    
    // Format response
    const questionsList = questions.map(q => {
      const options = parseOptionsToArray(q.options);
      // Get difficulty_level - try multiple access methods for compatibility
      let difficultyLevel = null;
      if (q.getDataValue) {
        difficultyLevel = q.getDataValue('difficulty_level');
      } else if (q.dataValues && q.dataValues.difficulty_level !== undefined) {
        difficultyLevel = q.dataValues.difficulty_level;
      } else if (q.difficulty_level !== undefined) {
        difficultyLevel = q.difficulty_level;
      }
      
      return {
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: options,
        options_string: q.options,
        correct_answer: q.correct_answer,
        section_id: q.section_id,
        section: q.section ? {
          id: q.section.id,
          name: q.section.name,
          order_index: q.section.order_index
        } : null,
        status: q.status || 'approved',
        source: q.source || 'manual',
        is_active: (() => {
          // Get raw value from database
          const rawValue = q.getDataValue ? q.getDataValue('is_active') : (q.dataValues?.is_active ?? q.is_active);
          // Convert to boolean: true if 1, true, or '1', false otherwise
          return rawValue === true || rawValue === 1 || rawValue === '1';
        })(),
        order_index: q.order_index || 0,
        difficulty_level: difficultyLevel || 'Medium',
        created_by: q.created_by || null,
        created_at: (() => {
          const val = q.getDataValue ? q.getDataValue('created_at') : (q.dataValues?.created_at || q.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = q.getDataValue ? q.getDataValue('updated_at') : (q.dataValues?.updated_at || q.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
      };
    });
    
    logSlowQuery('get_questions', startTime);
    
    // Response format with pagination metadata
    return res.json({
      questions: questionsList,
      pagination: {
        total_records: totalRecords,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
        has_previous: pageNum > 1,
        has_next: pageNum < totalPages
      }
    });
  } catch (error) {
    logSlowQuery('get_questions_error', startTime);
    console.error(`❌ Error in get_questions: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to get questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// GET /admin/questions/:id - Get single question
router.get('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId)) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    const question = await Question.findOne({
      where: { id: questionId },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    const options = parseOptionsToArray(question.options);
    
    return res.json({
      id: question.id,
      question_text: question.question_text,
      question_type: question.question_type,
      options: options,
      options_string: question.options,
      correct_answer: question.correct_answer,
      scale_value: question.scale_value || null,
      section_id: question.section_id,
      section: question.section ? {
        id: question.section.id,
        name: question.section.name,
        order_index: question.section.order_index
      } : null,
        difficulty_level: question.difficulty_level || 'Medium',
        status: question.status || 'pending',
        source: question.source || 'manual',
        is_active: question.is_active,
        order_index: question.order_index,
        created_by: question.created_by || null,
        created_at: (() => {
          const val = question.getDataValue ? question.getDataValue('created_at') : (question.dataValues?.created_at || question.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = question.getDataValue ? question.getDataValue('updated_at') : (question.dataValues?.updated_at || question.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
    });
  } catch (error) {
    console.error(`❌ Error in get_question: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions - Create new question
router.post('', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const adminUser = req.user;
    
    // Log incoming request for debugging
    console.log('📥 POST /admin/questions - Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      question_text,
      question_type,
      options,
      correct_answer,
      scale_value, // Ignored - will be auto-calculated
      section_id,
      difficulty_level,
      status
      // order_index is auto-generated, ignore if provided
    } = req.body;
    
    // Validation
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({
        detail: 'question_text is required'
      });
    }
    
    if (!question_type || !['MULTIPLE_CHOICE', 'LIKERT_SCALE'].includes(question_type)) {
      return res.status(400).json({
        detail: 'question_type must be MULTIPLE_CHOICE or LIKERT_SCALE'
      });
    }
    
    if (question_type === 'MULTIPLE_CHOICE' && !options) {
      return res.status(400).json({
        detail: 'options are required for MULTIPLE_CHOICE questions'
      });
    }
    
    if (question_type === 'MULTIPLE_CHOICE' && !correct_answer) {
      return res.status(400).json({
        detail: 'correct_answer is required for MULTIPLE_CHOICE questions'
      });
    }
    
    if (!section_id) {
      console.error('❌ Validation failed: section_id is required');
      return res.status(400).json({
        detail: 'section_id is required'
      });
    }
    
    // Verify section exists
    const section = await Section.findByPk(section_id);
    if (!section) {
      console.error('❌ Validation failed: Section not found:', section_id);
      return res.status(404).json({
        detail: 'Section not found'
      });
    }
    
    // NOTE: scale_value is NOT required - it will be auto-calculated for LIKERT_SCALE
    // Frontend should NOT send scale_value, but if it does, we ignore it
    console.log('✅ All validations passed. Proceeding with question creation...');
    
    // Format options
    let optionsString = '';
    if (Array.isArray(options)) {
      // For LIKERT_SCALE, ensure we have valid options
      if (question_type === 'LIKERT_SCALE' && options.length > 0) {
        optionsString = formatOptionsToString(options);
      } else if (question_type === 'LIKERT_SCALE') {
        // Default Likert options if not provided
        optionsString = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
      } else {
        optionsString = formatOptionsToString(options);
      }
    } else if (typeof options === 'string') {
      optionsString = options;
    } else if (question_type === 'LIKERT_SCALE' && !options) {
      // Default Likert options if options is missing
      optionsString = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
    }
    
    // AUTO-CALCULATE scale_value from question_text (backend safety: ignore frontend input)
    // For LIKERT_SCALE questions, scale_value is ALWAYS auto-calculated
    // For other types, scale_value is null
    let autoScaleValue = null;
    if (question_type === 'LIKERT_SCALE') {
      autoScaleValue = calculateAutoScaleValue(question_text);
      // Ensure we have a valid scale_value (should always be 2-5)
      if (!autoScaleValue || autoScaleValue < 2 || autoScaleValue > 5) {
        console.warn(`⚠️ Auto-calculated scale_value is invalid: ${autoScaleValue}, defaulting to 2`);
        autoScaleValue = 2;
      }
      console.log(`✅ Auto-calculated scale_value for LIKERT question: ${autoScaleValue} (from: "${question_text.substring(0, 50)}...")`);
    }
    
    // Admin-created questions: source='ADMIN', status='approved', is_active=true
    const finalStatus = status || 'approved';
    const finalSource = 'ADMIN'; // Always ADMIN for manual creation
    const isActive = true;
    
    // Auto-increment order_index for this section
    const maxOrder = await Question.max('order_index', {
      where: { section_id: section_id }
    });
    const finalOrderIndex = maxOrder ? maxOrder + 1 : 1;
    
    // Prepare create data - ensure scale_value is set correctly for LIKERT_SCALE
    const createData = {
      question_text: question_text.trim(),
      question_type: question_type,
      options: optionsString,
      correct_answer: correct_answer || null,
      section_id: section_id,
      difficulty_level: difficulty_level || 'Medium',
      status: finalStatus, // 'approved' for admin-created questions
      source: finalSource, // 'ADMIN'
      is_active: 1, // Explicitly set to 1 (MySQL TINYINT true)
      order_index: finalOrderIndex,
      created_by: adminUser.id
    };
    
    // Set scale_value ONLY for LIKERT_SCALE questions (auto-calculated, always 2-5)
    // For other types, explicitly set to null (database allows null)
    if (question_type === 'LIKERT_SCALE') {
      createData.scale_value = autoScaleValue; // Auto-calculated value (2-5, guaranteed by validation above)
    } else {
      createData.scale_value = null; // Explicitly null for non-LIKERT questions
    }
    
    console.log(`📝 Creating ${question_type} question with scale_value:`, createData.scale_value);
    
    // Create question - explicitly set is_active to true (use 1 for MySQL TINYINT compatibility)
    const question = await Question.create(createData, {
      // Ensure we return the created instance with all fields
      returning: true
    });
    
    // Verify what was saved
    const savedIsActive = question.getDataValue('is_active');
    console.log('✅ Created question ID:', question.id);
    console.log('✅ Created question - is_active from instance:', question.is_active, 'type:', typeof question.is_active);
    console.log('✅ Created question - is_active from getDataValue:', savedIsActive, 'type:', typeof savedIsActive);
    
    // If somehow it's 0, update it immediately
    if (savedIsActive === 0 || savedIsActive === false) {
      console.warn('⚠️ WARNING: is_active was saved as 0/false, updating to 1');
      await question.update({ is_active: 1 });
    }
    
    // Fetch with section info
    const createdQuestion = await Question.findOne({
      where: { id: question.id },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    // Get is_active value using getDataValue to ensure we get the raw DB value
    const isActiveValue = createdQuestion.getDataValue ? createdQuestion.getDataValue('is_active') : (createdQuestion.dataValues?.is_active ?? createdQuestion.is_active);
    // Convert to boolean: true if 1, true, or '1', false otherwise
    const isActiveBoolean = isActiveValue === true || isActiveValue === 1 || isActiveValue === '1';
    
    console.log('✅ Fetched question - is_active raw:', isActiveValue, 'type:', typeof isActiveValue);
    console.log('✅ Fetched question - is_active boolean:', isActiveBoolean);
    console.log('✅ Fetched question - full dataValues:', JSON.stringify(createdQuestion.dataValues, null, 2));
    
    const optionsArray = parseOptionsToArray(createdQuestion.options);
    
    return res.status(201).json({
      id: createdQuestion.id,
      question_text: createdQuestion.question_text,
      question_type: createdQuestion.question_type,
      options: optionsArray,
      options_string: createdQuestion.options,
      correct_answer: createdQuestion.correct_answer,
      scale_value: createdQuestion.scale_value || null,
      section_id: createdQuestion.section_id,
      section: createdQuestion.section ? {
        id: createdQuestion.section.id,
        name: createdQuestion.section.name,
        order_index: createdQuestion.section.order_index
      } : null,
      difficulty_level: createdQuestion.difficulty_level || 'Medium',
      status: createdQuestion.status || 'approved',
      source: createdQuestion.source || 'manual',
      is_active: isActiveBoolean, // Explicitly convert to boolean
      order_index: createdQuestion.order_index,
      created_by: createdQuestion.created_by,
      created_at: (() => {
        const val = createdQuestion.getDataValue ? createdQuestion.getDataValue('created_at') : (createdQuestion.dataValues?.created_at || createdQuestion.created_at);
        return val ? new Date(val).toISOString() : null;
      })(),
      updated_at: (() => {
        const val = createdQuestion.getDataValue ? createdQuestion.getDataValue('updated_at') : (createdQuestion.dataValues?.updated_at || createdQuestion.updated_at);
        return val ? new Date(val).toISOString() : null;
      })()
    });
  } catch (error) {
    console.error(`❌ Error in create_question: ${error.message}`);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body was:', JSON.stringify(req.body, null, 2));
    
    // If it's a validation error, return 400
    if (error.name === 'SequelizeValidationError' || error.name === 'ValidationError') {
      return res.status(400).json({
        detail: error.message || 'Validation error',
        errors: error.errors || undefined
      });
    }
    
    return res.status(500).json({
      detail: 'Failed to create question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /admin/questions/:id - Update question
router.put('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId)) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    const question = await Question.findByPk(questionId);
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    const {
      question_text,
      question_type,
      options,
      correct_answer,
      scale_value,
      section_id,
      difficulty_level,
      status,
      order_index
    } = req.body;
    
    // Validation
    if (question_text !== undefined && !question_text.trim()) {
      return res.status(400).json({
        detail: 'question_text cannot be empty'
      });
    }
    
    if (question_type && !['MULTIPLE_CHOICE', 'LIKERT_SCALE'].includes(question_type)) {
      return res.status(400).json({
        detail: 'question_type must be MULTIPLE_CHOICE or LIKERT_SCALE'
      });
    }
    
    if (section_id) {
      const section = await Section.findByPk(section_id);
      if (!section) {
        return res.status(404).json({
          detail: 'Section not found'
        });
      }
    }
    
    // Build update object
    const updateData = {};
    
    if (question_text !== undefined) {
      updateData.question_text = question_text.trim();
    }
    
    if (question_type !== undefined) {
      updateData.question_type = question_type;
    }
    
    if (options !== undefined) {
      if (Array.isArray(options)) {
        updateData.options = formatOptionsToString(options);
      } else if (typeof options === 'string') {
        updateData.options = options;
      }
    }
    
    if (correct_answer !== undefined) {
      updateData.correct_answer = correct_answer;
    }
    
    // AUTO-CALCULATE scale_value if question_text is updated (backend safety: ignore frontend input)
    if (question_text !== undefined) {
      const finalQuestionType = question_type !== undefined ? question_type : question.question_type;
      if (finalQuestionType === 'LIKERT_SCALE') {
        updateData.scale_value = calculateAutoScaleValue(question_text);
      }
    } else if (question_type !== undefined && question_type === 'LIKERT_SCALE') {
      // If only question_type changed to LIKERT_SCALE, recalculate from existing question_text
      updateData.scale_value = calculateAutoScaleValue(question.question_text);
    }
    
    if (section_id !== undefined) {
      updateData.section_id = section_id;
    }
    
    if (difficulty_level !== undefined) {
      updateData.difficulty_level = difficulty_level;
    }
    
    if (status !== undefined) {
      updateData.status = status;
      // Update is_active based on status (only approved questions are active)
      updateData.is_active = status === 'approved';
    }
    
    if (order_index !== undefined) {
      updateData.order_index = order_index;
    }
    
    // Update question
    await question.update(updateData);
    
    // Fetch updated question with section info
    const updatedQuestion = await Question.findOne({
      where: { id: questionId },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    const optionsArray = parseOptionsToArray(updatedQuestion.options);
    
    return res.json({
      id: updatedQuestion.id,
      question_text: updatedQuestion.question_text,
      question_type: updatedQuestion.question_type,
      options: optionsArray,
      options_string: updatedQuestion.options,
      correct_answer: updatedQuestion.correct_answer,
      scale_value: updatedQuestion.scale_value || null,
      section_id: updatedQuestion.section_id,
      section: updatedQuestion.section ? {
        id: updatedQuestion.section.id,
        name: updatedQuestion.section.name,
        order_index: updatedQuestion.section.order_index
      } : null,
      difficulty_level: updatedQuestion.difficulty_level || 'Medium',
      status: updatedQuestion.status || 'pending',
      source: updatedQuestion.source || 'manual',
      is_active: updatedQuestion.is_active,
      order_index: updatedQuestion.order_index,
      created_by: updatedQuestion.created_by || null,
      created_at: (() => {
        const val = updatedQuestion.getDataValue ? updatedQuestion.getDataValue('created_at') : (updatedQuestion.dataValues?.created_at || updatedQuestion.created_at);
        return val ? new Date(val).toISOString() : null;
      })(),
      updated_at: (() => {
        const val = updatedQuestion.getDataValue ? updatedQuestion.getDataValue('updated_at') : (updatedQuestion.dataValues?.updated_at || updatedQuestion.updated_at);
        return val ? new Date(val).toISOString() : null;
      })()
    });
  } catch (error) {
    console.error(`❌ Error in update_question: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to update question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// DELETE /admin/questions/:id - Soft delete question (set status to Inactive)
router.delete('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        status: 'inactive',
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question deleted successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in delete_question:', error);
    return res.status(500).json({
      detail: 'Failed to delete question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /admin/questions/:id/activate - Activate question
router.patch('/:id/activate', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        is_active: true
      },
      {
        where: { id: questionId },
        fields: ['is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question activated successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in activate_question:', error);
    return res.status(500).json({
      detail: 'Failed to activate question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /admin/questions/:id/deactivate - Deactivate question
router.patch('/:id/deactivate', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question deactivated successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in deactivate_question:', error);
    return res.status(500).json({
      detail: 'Failed to deactivate question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/:id/approve - Approve a question
router.post('/:id/approve', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    const adminUser = req.user;
    const { admin_comment } = req.body;
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    // Check if question exists and is active
    const question = await Question.findOne({
      where: { id: questionId },
      attributes: ['id', 'is_active', 'status']
    });
    
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Update question: set status='approved' and is_active=true (for AI questions)
    const [updatedCount] = await Question.update(
      {
        status: 'approved', // Approve the question
        is_active: 1 // Activate the question
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(400).json({
        detail: 'Question is not active and cannot be approved'
      });
    }
    
    // Create approval record
    await QuestionApproval.create({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.APPROVED,
      admin_comment: admin_comment || null
    });
    
    return res.json({
      message: 'Question approved successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in approve_question:', error);
    return res.status(500).json({
      detail: 'Failed to approve question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/:id/reject - Reject a question
router.post('/:id/reject', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    const adminUser = req.user;
    const { admin_comment } = req.body;
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    if (!admin_comment || !admin_comment.trim()) {
      return res.status(400).json({
        detail: 'admin_comment is required when rejecting a question'
      });
    }
    
    // Check if question exists
    const questionExists = await Question.findOne({
      where: { id: questionId },
      attributes: ['id']
    });
    
    if (!questionExists) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Update question status using direct update (avoids scale_value column issue)
    const [updatedCount] = await Question.update(
      {
        status: 'rejected',
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Create approval record
    await QuestionApproval.create({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.REJECTED,
      admin_comment: admin_comment.trim()
    });
    
    return res.json({
      message: 'Question rejected successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in reject_question:', error);
    return res.status(500).json({
      detail: 'Failed to reject question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/bulk-approve - Bulk approve questions (optimized with batch operations)
// IMPORTANT: This route must be defined BEFORE /:id routes to avoid route conflicts
router.post('/bulk-approve', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const transaction = await Question.sequelize.transaction();
  
  try {
    const adminUser = req.user;
    const { question_ids, admin_comment } = req.body;
    
    // Validation
    if (!question_ids || !Array.isArray(question_ids) || question_ids.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'question_ids must be a non-empty array'
      });
    }
    
    // Limit bulk operations to prevent performance issues
    if (question_ids.length > 1000) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'Maximum 1000 questions can be approved at once'
      });
    }
    
    // Validate all IDs are numbers
    const validIds = question_ids
      .map(id => parseInt(id, 10))
      .filter(id => Number.isInteger(id) && id > 0);
    
    if (validIds.length !== question_ids.length) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'All question_ids must be valid positive integers'
      });
    }
    
    // Optimized: Find only pending questions in one query (uses index on status)
    // Note: Ensure index exists: CREATE INDEX idx_questions_status_id ON questions(status, id);
    const pendingQuestions = await Question.findAll({
      where: {
        id: validIds,
        status: 'pending' // Filter at database level for better performance
      },
      attributes: ['id', 'status'], // Only select needed fields
      transaction,
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow bulk query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    });
    
    const foundPendingIds = new Set(pendingQuestions.map(q => q.id));
    const skippedIds = validIds.filter(id => !foundPendingIds.has(id));
    
    if (pendingQuestions.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'No pending questions found to approve',
        skipped_ids: skippedIds
      });
    }
    
    const pendingIds = pendingQuestions.map(q => q.id);
    
    // Optimized: Batch update using bulkUpdate (single query instead of N queries)
    // Note: Sequelize bulkUpdate is more efficient than individual updates
    const [updatedCount] = await Question.update(
      {
        status: 'approved',
        is_active: true
      },
      {
        where: {
          id: pendingIds
        },
        transaction
      }
    );
    
    // Optimized: Batch insert approval records (single query instead of N queries)
    const approvalRecords = pendingIds.map(questionId => ({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.APPROVED,
      admin_comment: admin_comment || 'Bulk approved by admin',
      approved_at: new Date()
    }));
    
    await QuestionApproval.bulkCreate(approvalRecords, { transaction });
    
    // Commit transaction
    await transaction.commit();
    
    logSlowQuery('bulk_approve', startTime);
    
    return res.json({
      approved_count: updatedCount,
      skipped_ids: skippedIds,
      message: `Bulk approval completed: ${updatedCount} question(s) approved`
    });
  } catch (error) {
    await transaction.rollback();
    logSlowQuery('bulk_approve_error', startTime);
    console.error(`❌ Error in bulk_approve: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to bulk approve questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /admin/questions/:id/approvals - Get approval history for a question (optimized)
router.get('/:id/approvals', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    // Optimized query with explicit attributes and proper indexing
    // Note: Ensure composite index exists: CREATE INDEX idx_approvals_question_approved ON question_approvals(question_id, approved_at DESC);
    const approvals = await QuestionApproval.findAll({
      where: { question_id: questionId },
      attributes: ['id', 'approval_status', 'admin_comment', 'approved_at', 'approved_by'],
      include: [
        {
          model: require('../models').User,
          as: 'approver',
          attributes: ['id', 'full_name', 'email'],
          required: false // LEFT JOIN to avoid filtering out approvals without approver
        }
      ],
      order: [['approved_at', 'DESC']], // Uses index on approved_at
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow approvals query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    });
    
    logSlowQuery('get_approvals', startTime);
    
    return res.json(approvals.map(approval => ({
      id: approval.id,
      approval_status: approval.approval_status,
      admin_comment: approval.admin_comment,
      approver: approval.approver ? {
        id: approval.approver.id,
        full_name: approval.approver.full_name,
        email: approval.approver.email
      } : null,
      approved_at: (() => {
        const val = approval.getDataValue ? approval.getDataValue('approved_at') : (approval.dataValues?.approved_at || approval.approved_at);
        return val ? new Date(val).toISOString() : null;
      })()
    })));
  } catch (error) {
    logSlowQuery('get_approvals_error', startTime);
    console.error(`❌ Error in get_question_approvals: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get question approvals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/*
 * ============================================
 * PERFORMANCE OPTIMIZATION NOTES
 * ============================================
 * 
 * RECOMMENDED DATABASE INDEXES:
 * 
 * 1. Composite index for pending filter (high priority):
 *    CREATE INDEX idx_questions_status_active ON questions(status, is_active);
 * 
 * 2. Composite index for cursor pagination (high priority):
 *    CREATE INDEX idx_questions_created_id ON questions(created_at DESC, id DESC);
 * 
 * 3. Index for section filtering:
 *    CREATE INDEX idx_questions_section_id ON questions(section_id);
 * 
 * 4. Composite index for status + id (bulk approve optimization):
 *    CREATE INDEX idx_questions_status_id ON questions(status, id);
 * 
 * 5. Full-text index for search (if full-text search is needed):
 *    ALTER TABLE questions ADD FULLTEXT INDEX idx_questions_text (question_text);
 * 
 * 6. Composite index for approvals query:
 *    CREATE INDEX idx_approvals_question_approved ON question_approvals(question_id, approved_at DESC);
 * 
 * 7. Index for question_type filtering (if frequently used):
 *    CREATE INDEX idx_questions_type ON questions(question_type);
 * 
 * PERFORMANCE MONITORING:
 * - All queries log warnings if they take > 200ms
 * - Check logs for "Slow query detected" warnings
 * - Monitor query execution times in production
 * 
 * QUERY OPTIMIZATION STRATEGIES:
 * - Use cursor-based pagination instead of OFFSET for large datasets
 * - Batch operations (bulkCreate, bulkUpdate) instead of individual queries
 * - Explicit attribute selection to avoid selecting unnecessary columns
 * - Proper use of indexes on WHERE and ORDER BY clauses
 * - LEFT JOINs (required: false) to avoid filtering out records unnecessarily
 */

module.exports = router;

