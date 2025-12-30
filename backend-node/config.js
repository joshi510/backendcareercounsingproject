require('dotenv').config();

module.exports = {
  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'career_profiling_db',
    // Support DATABASE_URL for production (Railway/Render)
    url: process.env.DATABASE_URL
  },
  
  // App
  app: {
    name: process.env.APP_NAME || 'Career Profiling Platform',
    debug: process.env.DEBUG === 'true',
    port: parseInt(process.env.PORT || '8001', 10),
    frontendUrl: process.env.FRONTEND_URL || '*'
  },
  
  // JWT
  jwt: {
    secretKey: process.env.JWT_SECRET_KEY || 'your-secret-key-change-in-production',
    algorithm: 'HS256',
    expiresIn: parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES || '1440', 10) * 60 // Convert to seconds
  },
  
  // AI
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || ''
  }
};

