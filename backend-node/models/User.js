const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const UserRole = {
  STUDENT: 'STUDENT',
  COUNSELLOR: 'COUNSELLOR',
  ADMIN: 'ADMIN'
};

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  full_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('STUDENT', 'COUNSELLOR', 'ADMIN'),
    allowNull: false,
    defaultValue: 'STUDENT'
  },
  is_first_login: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  center: {
    type: DataTypes.ENUM('CG', 'SG', 'Maninagar', 'Surat', 'Rajkot'),
    allowNull: true,
    comment: 'Center location for counselors'
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
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { User, UserRole };

