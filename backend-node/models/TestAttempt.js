const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const TestStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED'
};

const TestAttempt = sequelize.define('TestAttempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  status: {
    type: DataTypes.ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED'),
    allowNull: false,
    defaultValue: 'IN_PROGRESS'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  current_section_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'sections',
      key: 'id'
    }
  },
  current_question_index: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  remaining_time_seconds: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 420 // 7 minutes = 420 seconds per section
  },
  selected_question_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Array of question IDs randomly selected for this test attempt'
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
  tableName: 'test_attempts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { TestAttempt, TestStatus };

