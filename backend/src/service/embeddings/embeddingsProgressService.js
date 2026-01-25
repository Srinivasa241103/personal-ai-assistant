import SocketServer from "../websocket/sockeService";
import { logger } from "../../utils/logger";

export default class EmbeddingProgressService {
  constructor() {
    this.socketServer = SocketServer();
  }
  async generateWithProgress(documents, batchSize = 50) {
    const batchId = `embedding_${Date.now()}`;
    const totalDocuments = documents.length;

    try {
      this.socketServer.emitEmbeddingProgress({
        batchId,
        stage: "starting",
        message: "Starting embedding generation...",
        progress: 0,
        total: totalDocuments,
      });

      const batches = this.createBatches(documents, batchSize);
      const results = [];
      let processed = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        this.socketServer.emitEmbeddingProgress({
          batchId,
          stage: "processing",
          message: `Processing batch ${i + 1}/${batches.length}...`,
          progress: (processed / totalDocuments) * 100,
          current: processed,
          total: totalDocuments,
          currentBatch: i + 1,
          totalBatches: batches.length,
        });

        // Generate embeddings for this batch
        const batchResults = await this.generateEmbeddingsBatch(batch);
        results.push(...batchResults);
        processed += batch.length;

        this.socketServer.emitEmbeddingProgress({
          batchId,
          stage: "processing",
          message: `Completed batch ${i + 1}/${batches.length}`,
          progress: (processed / totalDocuments) * 100,
          current: processed,
          total: totalDocuments,
        });

        // Small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await this.delay(500);
        }
      }

      // Store embeddings
      this.socketServer.emitEmbeddingProgress({
        batchId,
        stage: "storing",
        message: "Storing embeddings in vector database...",
        progress: 95,
      });

      await this.storeEmbeddings(results);

      this.socketServer.emitEmbeddingProgress({
        batchId,
        stage: "complete",
        message: "Embedding generation completed",
        progress: 100,
        total: totalDocuments,
        success: true,
      });

      return results;
    } catch (error) {
      logger.error("Embedding generation error:", error);

      this.socketServer.emitEmbeddingProgress({
        batchId,
        stage: "error",
        message: error.message,
        progress: 0,
        error: true,
      });

      throw error;
    }
  }

  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Implement actual embedding generation logic
  async generateEmbeddingsBatch(documents) {
    // Your Gemini API embedding generation logic here
    // This is placeholder
    return documents.map((doc) => ({
      id: doc.id,
      embedding: [], // actual embedding vector
    }));
  }

  async storeEmbeddings(embeddings) {
    // Store in Supabase/pgvector
  }
}
