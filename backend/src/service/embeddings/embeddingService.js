import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
//import { validateEnv } from "../../config/environment.js";

export default class EmbeddingService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    });

    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "1536");
    this.batchSize = 100; // Gemini allows batching
    this.costPerMillionTokens = 0.15;
  }

  async embedText(text) {
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Text must be a non-empty string");
    }

    try {
      const result = await this.model.embedContent({
        content: { parts: [{ text: text.trim() }] },
        outputDimensionality: this.dimensions,
      });

      return {
        embedding: result.embedding.values,
        tokens: this.estimateTokens(text),
      };
    } catch (error) {
      logger.error("Error generating embedding for text", {
        error: error.message,
        textLength: text.length,
      });
      throw error;
    }
  }

  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error("Texts must be a non-empty array");
    }
    const validTexts = texts.filter((t) => t && t.trim().length > 0);

    if (validTexts.length === 0) {
      logger.warn("No valid texts to embed in batch");
      return [];
    }

    try {
      // Gemini can handle multiple texts in parallel
      const embeddings = [];
      const batchPromises = validTexts.map((text) => this.embedText(text));

      const results = await Promise.all(batchPromises);

      return results.map((result, index) => ({
        text: validTexts[index],
        embedding: result.embedding,
        tokens: result.tokens,
      }));
    } catch (error) {
      logger.error("Error generating batch embeddings", {
        error: error.message,
        batchSize: validTexts.length,
      });
      throw error;
    }
  }

  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  calculateCost(tokens) {
    return (tokens / 1_000_000) * this.costPerMillionTokens;
  }

  isWithinTokenLimit(text) {
    const tokens = this.estimateTokens(text);
    const maxTokens = 2048;

    if (tokens > maxTokens) {
      logger.warn("Text exceeds token limit", {
        tokens,
        maxTokens,
        textLength: text.length,
      });
      return false;
    }

    return true;
  }

  truncateToTokenLimit(text) {
    const maxTokens = 2048;
    const maxChars = maxTokens * 4; // Conservative estimate

    if (text.length <= maxChars) {
      return text;
    }

    logger.warn("Truncating text to fit token limit", {
      originalLength: text.length,
      truncatedLength: maxChars,
    });

    return text.substring(0, maxChars) + "...";
  }

  prepareText(text) {
    if (!text) return "";

    // Clean text
    let cleaned = text.trim();

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, " ");

    // Truncate if needed
    if (!this.isWithinTokenLimit(cleaned)) {
      cleaned = this.truncateToTokenLimit(cleaned);
    }

    return cleaned;
  }

  async healthCheck() {
    try {
      const result = await this.embedText("Health check");
      return {
        status: "healthy",
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        dimensions: this.dimensions,
        embeddingLength: result.embedding.length,
      };
    } catch (error) {
      logger.error("Embedding service health check failed", {
        error: error.message,
      });
      return {
        status: "unhealthy",
        error: error.message,
      };
    }
  }
}
