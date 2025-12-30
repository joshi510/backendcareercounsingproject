const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const InterpretedResult = sequelize.define('InterpretedResult', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  test_attempt_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    references: {
      model: 'test_attempts',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  interpretation_text: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  strengths: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  areas_for_improvement: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_ai_generated: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  readiness_status: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  readiness_explanation: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  risk_level: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  risk_explanation: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  career_direction: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  career_direction_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  roadmap: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  counsellor_summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  readiness_action_guidance: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  career_confidence_level: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  career_confidence_explanation: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  do_now_actions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  do_later_actions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  risk_explanation_human: {
    type: DataTypes.TEXT,
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
  tableName: 'interpreted_results',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { InterpretedResult };

