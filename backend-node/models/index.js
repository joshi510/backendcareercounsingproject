// Import all models
const { User, UserRole } = require('./User');
const { Student } = require('./Student');
const { Counsellor } = require('./Counsellor');
const { Question, QuestionType } = require('./Question');
const { TestAttempt, TestStatus } = require('./TestAttempt');
const { Answer } = require('./Answer');
const { Score } = require('./Score');
const { InterpretedResult } = require('./InterpretedResult');
const { Career } = require('./Career');
const { CounsellorNote } = require('./CounsellorNote');
const { Section } = require('./Section');
const { SectionProgress, SectionStatus } = require('./SectionProgress');

// Define associations
User.hasOne(Student, { foreignKey: 'user_id', as: 'studentProfile' });
Student.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasOne(Counsellor, { foreignKey: 'user_id', as: 'counsellorProfile' });
Counsellor.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(TestAttempt, { foreignKey: 'student_id', as: 'testAttempts' });
TestAttempt.belongsTo(User, { foreignKey: 'student_id', as: 'student' });

Section.hasMany(Question, { foreignKey: 'section_id', as: 'questions' });
Question.belongsTo(Section, { foreignKey: 'section_id', as: 'section' });

TestAttempt.hasMany(Answer, { foreignKey: 'test_attempt_id', as: 'answers' });
Answer.belongsTo(TestAttempt, { foreignKey: 'test_attempt_id', as: 'testAttempt' });
Answer.belongsTo(Question, { foreignKey: 'question_id', as: 'question' });

TestAttempt.hasMany(Score, { foreignKey: 'test_attempt_id', as: 'scores' });
Score.belongsTo(TestAttempt, { foreignKey: 'test_attempt_id', as: 'testAttempt' });

TestAttempt.hasOne(InterpretedResult, { foreignKey: 'test_attempt_id', as: 'interpretedResult' });
InterpretedResult.belongsTo(TestAttempt, { foreignKey: 'test_attempt_id', as: 'testAttempt' });

InterpretedResult.hasMany(Career, { foreignKey: 'interpreted_result_id', as: 'careers' });
Career.belongsTo(InterpretedResult, { foreignKey: 'interpreted_result_id', as: 'interpretedResult' });

Section.hasMany(SectionProgress, { foreignKey: 'section_id', as: 'sectionProgresses' });
SectionProgress.belongsTo(Section, { foreignKey: 'section_id', as: 'section' });

TestAttempt.hasMany(SectionProgress, { foreignKey: 'test_attempt_id', as: 'sectionProgresses' });
SectionProgress.belongsTo(TestAttempt, { foreignKey: 'test_attempt_id', as: 'testAttempt' });

User.hasMany(CounsellorNote, { foreignKey: 'counsellor_id', as: 'counsellorNotes' });
CounsellorNote.belongsTo(User, { foreignKey: 'counsellor_id', as: 'counsellor' });
CounsellorNote.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
CounsellorNote.belongsTo(TestAttempt, { foreignKey: 'test_attempt_id', as: 'testAttempt' });

module.exports = {
  User,
  UserRole,
  Student,
  Counsellor,
  Question,
  QuestionType,
  TestAttempt,
  TestStatus,
  Answer,
  Score,
  InterpretedResult,
  Career,
  CounsellorNote,
  Section,
  SectionProgress,
  SectionStatus
};

