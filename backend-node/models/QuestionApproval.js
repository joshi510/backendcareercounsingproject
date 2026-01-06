const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const ApprovalStatus = {
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const QuestionApproval = sequelize.define('QuestionApproval', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
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
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'Admin user who approved/rejected the question'
  },
  approval_status: {
    type: DataTypes.ENUM('approved', 'rejected'),
    allowNull: false,
    comment: 'approval decision'
  },
  admin_comment: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional comment from admin explaining approval/rejection'
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Timestamp when approval decision was made'
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
  tableName: 'question_approvals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true,
  indexes: [
    {
      fields: ['question_id'],
      name: 'idx_question_approvals_question_id'
    },
    {
      fields: ['approved_by'],
      name: 'idx_question_approvals_approved_by'
    },
    {
      fields: ['approval_status'],
      name: 'idx_question_approvals_status'
    }
  ]
});

module.exports = { QuestionApproval, ApprovalStatus };

