import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./api/routes/authRoutes.js";
import syncRoutes from "./api/routes/syncRoutes.js";
import embeddingRoutes from "./api/routes/embeddingRoutes.js";
import CronManager from "./service/cron/cronManager.js";

dotenv.config();

const app = express();

//base config
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN?.split(",") || [
  process.env.FRONTEND_URL || "http://localhost:5173",
];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => {
  res.send("API is running...");
});

// Auth routes
app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);
app.use("/embedding", embeddingRoutes);

export default app;
