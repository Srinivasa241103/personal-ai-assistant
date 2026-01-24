import { Router } from "express";
import EmbeddingPipeline from "../../service/embeddings/embeddingPipeline.js";
import { EmbeddingRepository } from "../../database/embeddingRepository.js";
import { logger } from "../../utils/logger.js";

const router = Router();
const embeddingPipeline = new EmbeddingPipeline();
const embeddingRepository = new EmbeddingRepository();

router.post("/generate", async (req, res) => {
  try {
    logger.info("Embedding generation triggered via API");

    const result = await embeddingPipeline.processPendingEmbeddings();

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Error in embedding generation endpoint", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/embeddings/status
 * Get embedding pipeline status and statistics
 */
router.get("/status", async (req, res) => {
  try {
    const status = await embeddingPipeline.getStatus();

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error("Error in embedding status endpoint", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/embeddings/stats
 * Get detailed embedding statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await embeddingRepository.getEmbeddingStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error in embedding stats endpoint", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/embeddings/reprocess
 * Mark specific documents for re-embedding
 */
router.post("/reprocess", async (req, res) => {
  try {
    const { documentIds } = req.body;

    if (!documentIds || !Array.isArray(documentIds)) {
      return res.status(400).json({
        success: false,
        error: "documentIds must be an array",
      });
    }

    const count = await embeddingRepository.markForReembedding(documentIds);

    res.json({
      success: true,
      data: { marked: count },
    });
  } catch (error) {
    logger.error("Error in reprocess endpoint", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/embeddings/diagnose
 * Diagnose embedding pipeline issues
 */
router.get("/diagnose", async (req, res) => {
  try {
    const diagnosis = await embeddingRepository.diagnose();
    const status = await embeddingPipeline.getStatus();

    res.json({
      success: true,
      data: {
        ...diagnosis,
        service: status.service,
        config: {
          geminiApiKeySet: !!process.env.GEMINI_API_KEY,
          embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
          cronEnabled: process.env.ENABLE_EMBEDDING_CRON !== "false",
        },
      },
    });
  } catch (error) {
    logger.error("Error in diagnose endpoint", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/embeddings/mark-pending
 * Mark all documents without embeddings as needing embedding
 */
router.post("/mark-pending", async (req, res) => {
  try {
    const count = await embeddingRepository.markAllPendingForEmbedding();

    res.json({
      success: true,
      data: {
        marked: count,
        message: `Marked ${count} documents for embedding`
      },
    });
  } catch (error) {
    logger.error("Error in mark-pending endpoint", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
