const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const SectionStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED'
};

const SectionProgress = sequelize.define('SectionProgress', {
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
  section_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'sections',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  status: {
    type: DataTypes.ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'),
    allowNull: false,
    defaultValue: 'NOT_STARTED'
  },
  section_start_time: {
    type: DataTypes.DATE,
    allowNull: true
  },
  total_time_spent: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  paused_at: {
    type: DataTypes.DATE,
    allowNull: true
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
  tableName: 'section_progresses',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { SectionProgress, SectionStatus };

