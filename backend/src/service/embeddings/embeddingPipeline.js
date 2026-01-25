import EmbeddingService from "./embeddingService.js";
import { EmbeddingRepository } from "../../database/embeddingRepository.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import socketServer from "../websocket/sockeService.js";

export default class EmbeddingPipeline {
  constructor() {
    this.batchSize = 50; // Batch size per iteration
    this.embeddingRepo = new EmbeddingRepository();
    this.embeddingService = new EmbeddingService();
  }

  async processPendingEmbeddings() {
    const startTime = Date.now();
    const batchId = uuidv4();

    logger.info("Starting embedding pipeline", { batchId });
    try {
      const documents = await this.embeddingRepo.getDocumentsNeedingEmbedding(
        this.batchSize
      );

      if (documents.length == 0) {
        logger.info("No documents need embedding", { batchId });
        return {
          success: true,
          processed: 0,
          message: "No documents need embedding",
        };
      }
      logger.info(`Processing ${documents.length} documents for embedding`, {
        batchId,
      });

      const preparedDocs = documents.map((doc) => ({
        ...doc,
        preparedContent: this.embeddingService.prepareText(doc.content),
      }));

      const results = [];
      let totalTokens = 0;
      const batchChunkSize = 10; // Process 10 documents at a time

      for (let i = 0; i < preparedDocs.length; i += batchChunkSize) {
        const batch = preparedDocs.slice(i, i + batchChunkSize);
        const texts = batch.map((doc) => doc.preparedContent);

        try {
          logger.info(
            `Generating embeddings for batch ${
              Math.floor(i / batchChunkSize) + 1
            }`,
            {
              size: batch.length,
            }
          );
          const embeddings = await this.embeddingService.embedBatch(texts);

          const updates = batch.map((doc, idx) => ({
            documentId: doc.document_id,
            embedding: embeddings[idx].embedding,
            tokens: embeddings[idx].tokens,
          }));

          await this.embeddingRepo.batchUpdateEmbeddings(updates);
          results.push(...updates);
          totalTokens += embeddings.reduce((sum, e) => sum + e.tokens, 0);

          logger.info(`Batch ${Math.floor(i / batchChunkSize) + 1} completed`, {
            documentsProcessed: results.length,
          });

          if (i + batchChunkSize < preparedDocs.length) {
            await this.delay(500); // 500ms delay between batches
          }
        } catch (error) {
          logger.error("Error during embedding generation or database update", {
            batchIndex: Math.floor(i / batchChunkSize) + 1,
            error: error.message || error.toString(),
            stack: error.stack,
          });
          // Continue with next batch instead of stopping entirely
        }
      }

      const estimatedCost = this.embeddingService.calculateCost(totalTokens);
      await this.embeddingRepo.logEmbeddingCost(
        batchId,
        process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        results.length,
        totalTokens,
        estimatedCost
      );
      const duration = Date.now() - startTime;
      return {
        success: true,
        batchId,
        processed: results.length,
        totalTokens,
        estimatedCost,
        duration,
      };
    } catch (error) {
      logger.error("Fatal error in embedding pipeline", {
        error: error.message,
        batchId,
      });
      throw error;
    }
  }

  async processDocuments(documentIds) {
    logger.info("Starting embedding for specific documents", { documentIds });
    await this.embeddingRepo.markForReembedding(documentIds);
    return await this.processPendingEmbeddings();
  }

  /**
   * Process ALL pending embeddings (loops until none left)
   * Used after sync to ensure all documents are embedded
   * @param {string} syncId - Optional sync ID for WebSocket progress tracking
   */
  async processAllPendingEmbeddings(syncId = null) {
    const startTime = Date.now();
    const overallBatchId = uuidv4();
    let totalProcessed = 0;
    let totalTokens = 0;
    let iteration = 0;

    logger.info("Starting full embedding pipeline - processing ALL pending", {
      overallBatchId,
    });

    // Get initial count of pending documents
    const stats = await this.embeddingRepo.getEmbeddingStats();
    const initialPending = stats.documents.pending;

    if (initialPending === 0) {
      logger.info("No documents need embedding", { overallBatchId });
      return {
        success: true,
        processed: 0,
        message: "No documents need embedding",
      };
    }

    logger.info(`Found ${initialPending} documents needing embedding`, {
      overallBatchId,
    });

    // Emit initial progress
    if (syncId) {
      socketServer.emitSyncProgress("gmail", {
        syncId,
        status: "in_progress",
        phase: "embedding",
        message: `Starting embeddings for ${initialPending} documents...`,
        progress: 0,
        totalDocuments: initialPending,
      });
    }

    // Loop until no more pending documents
    while (true) {
      iteration++;

      const documents = await this.embeddingRepo.getDocumentsNeedingEmbedding(
        this.batchSize
      );

      if (documents.length === 0) {
        logger.info("All pending embeddings processed", {
          overallBatchId,
          totalProcessed,
          iterations: iteration - 1,
        });
        break;
      }

      logger.info(`Processing batch ${iteration}: ${documents.length} documents`, {
        overallBatchId,
      });

      // Prepare documents
      const preparedDocs = documents.map((doc) => ({
        ...doc,
        preparedContent: this.embeddingService.prepareText(doc.content),
      }));

      // Process in chunks of 10
      const batchChunkSize = 10;
      for (let i = 0; i < preparedDocs.length; i += batchChunkSize) {
        const batch = preparedDocs.slice(i, i + batchChunkSize);
        const texts = batch.map((doc) => doc.preparedContent);

        try {
          const embeddings = await this.embeddingService.embedBatch(texts);

          const updates = batch.map((doc, idx) => ({
            documentId: doc.document_id,
            embedding: embeddings[idx].embedding,
            tokens: embeddings[idx].tokens,
          }));

          await this.embeddingRepo.batchUpdateEmbeddings(updates);
          totalProcessed += updates.length;
          totalTokens += embeddings.reduce((sum, e) => sum + e.tokens, 0);

          // Emit progress via WebSocket
          if (syncId) {
            const progressPercent = Math.min(
              99,
              Math.floor((totalProcessed / initialPending) * 100)
            );
            socketServer.emitSyncProgress("gmail", {
              syncId,
              status: "in_progress",
              phase: "embedding",
              message: `Embedded ${totalProcessed}/${initialPending} documents...`,
              progress: progressPercent,
              documentsEmbedded: totalProcessed,
              totalDocuments: initialPending,
            });
          }

          // Also emit embedding-specific progress
          socketServer.emitEmbeddingProgress({
            phase: "processing",
            processed: totalProcessed,
            total: initialPending,
            progress: Math.floor((totalProcessed / initialPending) * 100),
          });

          // Small delay between chunks to avoid rate limits
          if (i + batchChunkSize < preparedDocs.length) {
            await this.delay(300);
          }
        } catch (error) {
          logger.error("Error during batch embedding", {
            iteration,
            chunkIndex: Math.floor(i / batchChunkSize),
            error: error.message,
          });
          // Continue with next chunk
        }
      }

      // Delay between iterations
      await this.delay(500);
    }

    // Log cost
    const estimatedCost = this.embeddingService.calculateCost(totalTokens);
    if (totalProcessed > 0) {
      await this.embeddingRepo.logEmbeddingCost(
        overallBatchId,
        process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        totalProcessed,
        totalTokens,
        estimatedCost
      );
    }

    const duration = Date.now() - startTime;

    logger.info("Full embedding pipeline completed", {
      overallBatchId,
      totalProcessed,
      totalTokens,
      estimatedCost,
      duration,
      iterations: iteration - 1,
    });

    return {
      success: true,
      batchId: overallBatchId,
      processed: totalProcessed,
      totalTokens,
      estimatedCost,
      duration,
      iterations: iteration - 1,
    };
  }

  async getStatus() {
    const stats = await this.embeddingRepo.getEmbeddingStats();
    const health = await this.embeddingService.healthCheck();

    return {
      service: health,
      statictics: stats,
      pipeline: {
        batchSize: this.batchSize,
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        dimensions: this.embeddingService.dimensions,
      },
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
