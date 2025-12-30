const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Score = sequelize.define('Score', {
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
  dimension: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  score_value: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  percentile: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'scores',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true
});

module.exports = { Score };

