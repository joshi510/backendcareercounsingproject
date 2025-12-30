const { Sequelize } = require('sequelize');
const config = require('./config');

let sequelize;

// Check if DATABASE_URL is provided (for production)
if (config.db.url) {
  // Parse DATABASE_URL
  // Format: mysql://user:password@host:port/dbname
  // Or: postgresql://user:password@host:port/dbname (for PostgreSQL)
  const url = config.db.url;
  
  // Handle postgres:// to postgresql:// conversion (for Render)
  const dbUrl = url.replace(/^postgres:\/\//, 'postgresql://');
  
  sequelize = new Sequelize(dbUrl, {
    dialect: url.startsWith('postgres') ? 'postgres' : 'mysql',
    logging: config.app.debug ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
} else {
  // Use individual config for local development
  sequelize = new Sequelize(
    config.db.database,
    config.db.user,
    config.db.password,
    {
      host: config.db.host,
      port: config.db.port,
      dialect: 'mysql',
      logging: config.app.debug ? console.log : false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );
}

// Test connection
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error.message);
    return false;
  }
}

module.exports = { sequelize, testConnection };

