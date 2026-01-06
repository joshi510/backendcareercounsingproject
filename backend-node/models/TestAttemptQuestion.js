const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const TestAttemptQuestion = sequelize.define('TestAttemptQuestion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  test_attempt_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'test_attempts',
      key: 'id'
    },
    onDelete: 'CASCADE',
    comment: 'Foreign key to test_attempts table'
  },
  question_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'questions',
      key: 'id'
    },
    onDelete: 'CASCADE',
    comment: 'Foreign key to questions table'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'test_attempt_questions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['test_attempt_id', 'question_id'],
      name: 'unique_attempt_question'
    },
    {
      fields: ['test_attempt_id'],
      name: 'idx_attempt_questions_attempt_id'
    },
    {
      fields: ['question_id'],
      name: 'idx_attempt_questions_question_id'
    }
  ]
});

module.exports = TestAttemptQuestion;

