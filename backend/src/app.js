import express from "express";
import cors from "cors";
import authRoutes from "./api/routes/authRoutes.js";
import syncRoutes from "./api/routes/syncRoutes.js";
import embeddingRoutes from "./api/routes/embeddingRoutes.js";
import chatRoutes from "./api/routes/chat.js";

const app = express();

//base config
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
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
app.use("/chat", chatRoutes);

export default app;
