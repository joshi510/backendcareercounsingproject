const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Career = sequelize.define('Career', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  interpreted_result_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'interpreted_results',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  career_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  match_score: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true
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
  }
}, {
  tableName: 'careers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true
});

module.exports = { Career };

