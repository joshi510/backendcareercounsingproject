const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const QuestionType = {
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  LIKERT_SCALE: 'LIKERT_SCALE',
  TEXT: 'TEXT'
};

const Question = sequelize.define('Question', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  question_text: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  question_type: {
    type: DataTypes.ENUM('MULTIPLE_CHOICE', 'LIKERT_SCALE', 'TEXT'),
    allowNull: false
  },
  options: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  correct_answer: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  section_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'sections',
      key: 'id'
    },
    onDelete: 'SET NULL'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'questions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { Question, QuestionType };

