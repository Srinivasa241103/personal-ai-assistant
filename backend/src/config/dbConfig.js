import { Pool } from "pg";
import { logger } from "../utils/logger.js";

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  connectionTimeoutMillis: 5000, // Timeout after 5 seconds if connection can't be established
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});
export const connectToDB = async () => {
  try {
    const client = await pool.connect();
    logger.info("[Database connection established successfully.]");
    client.release();
  } catch (error) {
    logger.error("Database connection failed:", error.message);
    throw error;
  }
};
