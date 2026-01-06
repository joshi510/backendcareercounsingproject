const express = require('express');
const cors = require('cors');
const config = require('./config');
const { sequelize, testConnection } = require('./database');
const { User, UserRole, Section, Question, QuestionType, Student } = require('./models');
const { getPasswordHash } = require('./middleware/password');

// Import routes
const authRoutes = require('./routes/auth');
const testRoutes = require('./routes/test');
const studentResultRoutes = require('./routes/studentResult');
const counsellorNotesRoutes = require('./routes/counsellorNotes');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const adminStudentsRoutes = require('./routes/adminStudents');
const adminQuestionsRoutes = require('./routes/adminQuestions');
const adminCounsellorsRoutes = require('./routes/adminCounsellors');
const adminUsersRoutes = require('./routes/adminUsers');
const counsellorStudentsRoutes = require('./routes/counsellorStudents');
const changePasswordRoutes = require('./routes/changePassword');
const testAccessRoutes = require('./routes/testAccess');

const app = express();

// CORS configuration - MUST be before other middleware
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : (process.env.NODE_ENV === 'production' ? [] : true); // Allow all in dev, none in prod unless specified

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware for debugging
app.use((req, res, next) => {
  if (config.app.debug) {
    console.log(`${req.method} ${req.path}`, req.query, req.body);
  }
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/auth/change-password', changePasswordRoutes);
app.use('/test', testRoutes);
app.use('/student/result', studentResultRoutes);
app.use('/counsellor/notes', counsellorNotesRoutes);
app.use('/counsellor/students', counsellorStudentsRoutes);
app.use('/admin/analytics', adminAnalyticsRoutes);
app.use('/admin/students', adminStudentsRoutes);
app.use('/admin/questions', adminQuestionsRoutes);
app.use('/admin/counsellors', adminCounsellorsRoutes);
app.use('/admin/users', adminUsersRoutes);
app.use('/test', testAccessRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Career Profiling Platform API',
    version: '1.0.0',
    status: 'running',
    docs: '/docs',
    health: '/health'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: config.app.name
  });
});

// Database sync and seeding
async function initializeDatabase() {
  try {
    console.log('🔵 Creating database tables...');
    
    // Sync all models
    await sequelize.sync({ alter: false }); // Use alter: false to avoid data loss
    
    console.log('✅ Database tables created/verified');
    
    // Add new columns to test_attempts table if they don't exist
    try {
      const queryInterface = sequelize.getQueryInterface();
      const tableDescription = await queryInterface.describeTable('test_attempts');
      
        // Add current_section_id if it doesn't exist
      if (!tableDescription.current_section_id) {
        console.log('🔵 Adding current_section_id column to test_attempts...');
        await queryInterface.addColumn('test_attempts', 'current_section_id', {
          type: require('sequelize').DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'sections',
            key: 'id'
          }
        });
        console.log('✅ Added current_section_id column');
      }
      
      // Add current_question_index if it doesn't exist
      if (!tableDescription.current_question_index) {
        console.log('🔵 Adding current_question_index column to test_attempts...');
        await queryInterface.addColumn('test_attempts', 'current_question_index', {
          type: require('sequelize').DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0
        });
        console.log('✅ Added current_question_index column');
      }
      
      // Add remaining_time_seconds if it doesn't exist
      if (!tableDescription.remaining_time_seconds) {
        console.log('🔵 Adding remaining_time_seconds column to test_attempts...');
        await queryInterface.addColumn('test_attempts', 'remaining_time_seconds', {
          type: require('sequelize').DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 420
        });
        console.log('✅ Added remaining_time_seconds column');
      }

      // Add is_first_login column to users table if it doesn't exist
      const usersTableDescription = await queryInterface.describeTable('users');
      if (!usersTableDescription.is_first_login) {
        console.log('🔵 Adding is_first_login column to users...');
        await queryInterface.addColumn('users', 'is_first_login', {
          type: require('sequelize').DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        });
        console.log('✅ Added is_first_login column');
      }

      // Add center column to users table if it doesn't exist
      if (!usersTableDescription.center) {
        console.log('🔵 Adding center column to users...');
        await queryInterface.addColumn('users', 'center', {
          type: require('sequelize').DataTypes.ENUM('CG', 'SG', 'Maninagar', 'Surat', 'Rajkot'),
          allowNull: true,
          comment: 'Center location for counselors'
        });
        console.log('✅ Added center column');
      }

      // Create test_attempt_questions junction table if it doesn't exist
      try {
        const { TestAttemptQuestion } = require('./models');
        await TestAttemptQuestion.sync({ alter: false });
        console.log('✅ test_attempt_questions table verified/created');
      } catch (tableError) {
        console.warn('⚠️ test_attempt_questions table creation warning:', tableError.message);
      }
    } catch (migrationError) {
      console.warn('⚠️ Migration warning (columns may already exist):', migrationError.message);
    }

    // Verify tables exist
    const tables = await sequelize.getQueryInterface().showAllTables();
    console.log(`📊 Existing tables: ${tables.join(', ')}`);

    // Seed admin user
    const adminExists = await User.findOne({
      where: { role: UserRole.ADMIN }
    });

    if (!adminExists) {
      // Create admin user with properly hashed password
      const hashedPassword = await getPasswordHash('admin123');
      await User.create({
        email: 'admin@test.com',
        password_hash: hashedPassword,
        full_name: 'Admin User',
        role: UserRole.ADMIN
      });
      console.log('✅ Admin user created with hashed password');
    } else {
      console.log('ℹ️ Admin already exists');
    }

    // Seed sections if table is empty - EXACTLY 5 sections in mandatory order
    const sectionCount = await Section.count();
    if (sectionCount === 0) {
      const sections = [
        {
          name: 'Section 1: Intelligence Test (Cognitive Reasoning)',
          description: 'Logical Reasoning, Numerical Reasoning, Verbal Reasoning, Abstract Reasoning',
          order_index: 1,
          is_active: true
        },
        {
          name: 'Section 2: Aptitude Test',
          description: 'Numerical Aptitude, Logical Aptitude, Verbal Aptitude, Spatial/Mechanical Aptitude',
          order_index: 2,
          is_active: true
        },
        {
          name: 'Section 3: Study Habits',
          description: 'Concentration, Consistency, Time Management, Exam Preparedness, Self-discipline',
          order_index: 3,
          is_active: true
        },
        {
          name: 'Section 4: Learning Style',
          description: 'Visual, Auditory, Reading/Writing, Kinesthetic',
          order_index: 4,
          is_active: true
        },
        {
          name: 'Section 5: Career Interest (RIASEC)',
          description: 'Realistic, Investigative, Artistic, Social, Enterprising, Conventional',
          order_index: 5,
          is_active: true
        }
      ];

      await Section.bulkCreate(sections);
      console.log(`✅ Created ${sections.length} sections`);
    } else {
      // Ensure all 5 sections exist - create missing ones
      const existingSections = await Section.findAll({
        order: [['order_index', 'ASC']]
      });
      const existingOrderIndices = new Set(existingSections.map(s => s.order_index));

      const allSectionsConfig = [
        { order_index: 1, name: 'Section 1: Intelligence Test (Cognitive Reasoning)', description: 'Logical Reasoning, Numerical Reasoning, Verbal Reasoning, Abstract Reasoning' },
        { order_index: 2, name: 'Section 2: Aptitude Test', description: 'Numerical Aptitude, Logical Aptitude, Verbal Aptitude, Spatial/Mechanical Aptitude' },
        { order_index: 3, name: 'Section 3: Study Habits', description: 'Concentration, Consistency, Time Management, Exam Preparedness, Self-discipline' },
        { order_index: 4, name: 'Section 4: Learning Style', description: 'Visual, Auditory, Reading/Writing, Kinesthetic' },
        { order_index: 5, name: 'Section 5: Career Interest (RIASEC)', description: 'Realistic, Investigative, Artistic, Social, Enterprising, Conventional' }
      ];

      const sectionsToCreate = [];
      for (const config of allSectionsConfig) {
        if (!existingOrderIndices.has(config.order_index)) {
          sectionsToCreate.push({
            name: config.name,
            description: config.description,
            order_index: config.order_index,
            is_active: true
          });
        }
      }

      if (sectionsToCreate.length > 0) {
        await Section.bulkCreate(sectionsToCreate);
        console.log(`✅ Created ${sectionsToCreate.length} missing sections`);
      } else {
        console.log('ℹ️ All 5 sections already exist');
      }
    }

    // Seed questions - ensure each section has exactly 7 questions
    const allSections = await Section.findAll({
      order: [['order_index', 'ASC']]
    });
    console.log(`🔵 Total sections in database: ${allSections.length}`);

    for (const section of allSections) {
      console.log(`🔵 Checking Section ${section.order_index} (${section.name}) for questions...`);
      
      // Count approved and active questions (defensive query in case status column doesn't exist)
      let sectionQuestionCount = 0;
      try {
        sectionQuestionCount = await Question.count({
          where: {
            section_id: section.id,
            status: 'approved',
            is_active: true
          }
        });
      } catch (error) {
        // Fallback: if status column doesn't exist, count by is_active only
        if (error.message && error.message.includes('status')) {
          console.log(`⚠️  Status column not found, using is_active only for section ${section.id}`);
          sectionQuestionCount = await Question.count({
            where: {
              section_id: section.id,
              is_active: true
            }
          });
        } else {
          throw error;
        }
      }

      if (sectionQuestionCount < 7) {
        const questionsToCreate = 7 - sectionQuestionCount;
        console.log(`🔵 Section ${section.order_index} (${section.name}) has ${sectionQuestionCount} questions. Creating ${questionsToCreate} more...`);

        const newQuestions = [];
        for (let i = 0; i < questionsToCreate; i++) {
          const questionNum = sectionQuestionCount + i + 1;
          
          // Generate question text based on section
          let questionTexts = [];
          if (section.order_index === 1) {
            questionTexts = [
              'I can easily identify patterns in sequences',
              'I enjoy solving mathematical problems',
              'I can quickly understand complex instructions',
              'I am good at logical reasoning',
              'I can analyze problems from multiple angles',
              'I enjoy brain teasers and puzzles',
              'I can think abstractly'
            ];
          } else if (section.order_index === 2) {
            questionTexts = [
              'I have strong numerical skills',
              'I am good at spatial reasoning',
              'I can quickly learn new skills',
              'I have good mechanical aptitude',
              'I am skilled at verbal reasoning',
              'I can work with my hands effectively',
              'I have good problem-solving abilities'
            ];
          } else if (section.order_index === 3) {
            questionTexts = [
              'I maintain a consistent study schedule',
              'I can concentrate for long periods',
              'I manage my time effectively',
              'I prepare well for exams',
              'I have good self-discipline',
              'I review my notes regularly',
              'I avoid distractions while studying'
            ];
          } else if (section.order_index === 4) {
            questionTexts = [
              'I learn best by seeing visual aids',
              'I prefer listening to lectures',
              'I learn by reading and writing',
              'I learn best through hands-on activities',
              'I remember things I see better than things I hear',
              'I prefer audio recordings over written notes',
              'I like to take detailed written notes'
            ];
          } else { // section.order_index === 5
            questionTexts = [
              'I enjoy working with tools and machinery',
              'I like to investigate and research',
              'I enjoy creative and artistic activities',
              'I like helping and teaching others',
              'I enjoy leading and managing projects',
              'I prefer structured and organized work',
              'I like working outdoors'
            ];
          }

          const questionText = questionNum <= questionTexts.length ? questionTexts[questionNum - 1] : `Question ${questionNum} for ${section.name}`;

          newQuestions.push({
            question_text: questionText,
            question_type: QuestionType.MULTIPLE_CHOICE,
            options: 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree',
            correct_answer: 'C', // Default neutral answer
            category: `section_${section.order_index}`,
            section_id: section.id,
            status: 'approved',
            source: 'manual',
            is_active: true,
            order_index: questionNum
          });
        }

        await Question.bulkCreate(newQuestions);
        console.log(`✅ Created ${newQuestions.length} questions for Section ${section.order_index}`);
      }
    }

    // Final verification
    const section4 = await Section.findOne({ where: { order_index: 4 } });
    const section5 = await Section.findOne({ where: { order_index: 5 } });

    if (section4) {
      const section4Questions = await Question.count({
        where: { section_id: section4.id, status: 'approved' }
      });
      console.log(`✅ Section 4: ${section4Questions}/7 questions`);
    }

    if (section5) {
      const section5Questions = await Question.count({
        where: { section_id: section5.id, status: 'approved' }
      });
      console.log(`✅ Section 5: ${section5Questions}/7 questions`);
    }

    const totalQuestions = await Question.count();
    console.log(`ℹ️ Total questions in database: ${totalQuestions}`);

    // Migration: Update existing active questions to approved status
    // This ensures backward compatibility with existing test attempts
    const { Op } = require('sequelize');
    const activeQuestions = await Question.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { status: null },
          { status: { [Op.notIn]: ['pending', 'approved', 'rejected', 'inactive'] } }
        ]
      },
      attributes: ['id']
    });
    
    if (activeQuestions.length > 0) {
      await Question.update(
        { 
          status: 'approved',
          source: 'manual'
        },
        {
          where: {
            id: { [Op.in]: activeQuestions.map(q => q.id) }
          }
        }
      );
      console.log(`✅ Migrated ${activeQuestions.length} existing active questions to approved status`);
    }
    
  } catch (error) {
    console.error(`❌ Seed error: ${error.message}`);
    console.error(error.stack);
  }
}

// Start server
async function startServer() {
  try {
    // Test database connection
    const connected = await testConnection();
    if (!connected) {
      console.error('❌ Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Initialize database (sync tables and seed data)
    await initializeDatabase();

    // Start listening
    const port = config.app.port;
    app.listen(port, () => {
      console.log(`\n🚀 Server running on port ${port}`);
      console.log(`📝 Environment: ${config.app.debug ? 'DEBUG' : 'PRODUCTION'}`);
      console.log(`🌐 Frontend URL: ${config.app.frontendUrl}\n`);
    });
  } catch (error) {
    console.error(`❌ Failed to start server: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connections...');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connections...');
  await sequelize.close();
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;

