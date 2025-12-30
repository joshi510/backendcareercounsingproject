const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Answer = sequelize.define('Answer', {
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
    onDelete: 'CASCADE'
  },
  question_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'questions',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  answer_text: {
    type: DataTypes.TEXT,
    allowNull: false
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
  tableName: 'answers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { Answer };

