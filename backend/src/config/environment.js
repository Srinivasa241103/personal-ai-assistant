// src/config/environment.js

import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * Validate that required environment variables are present
 */
function validateEnvVars() {
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];

  const missing = required.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Validate specific environment variables
 * @param {string[]} vars - Array of environment variable names to validate
 */
export function validateEnv(vars) {
  const missing = vars.filter((varName) => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Configuration object with all environment variables
 */
export const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isDevelopment: process.env.NODE_ENV === "development",
    isProduction: process.env.NODE_ENV === "production",
  },

  // Database configuration
  database: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true",
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || "20", 10),
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "INFO",
  },

  // API Keys (will be added later)
  apis: {
    openai: process.env.OPENAI_API_KEY,
    pinecone: {
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
      indexName: process.env.PINECONE_INDEX_NAME,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },
    spotify: {
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    },
  },

  // Sync configuration
  sync: {
    intervalHours: parseInt(process.env.SYNC_INTERVAL_HOURS || "6", 10),
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE || "50", 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
  },
};

// Validate on module load
try {
  validateEnvVars();
  console.log(`[INFO] Environment configuration loaded successfully - NODE_ENV: ${config.server.nodeEnv}, DB_HOST: ${config.database.host}, DB_NAME: ${config.database.name}`);
} catch (error) {
  console.error(`[ERROR] Failed to load environment configuration:`, error.message);
  process.exit(1);
}
