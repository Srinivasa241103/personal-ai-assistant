import EmbeddingService from "./embeddingService.js";
import { EmbeddingRepository } from "../../database/embeddingRepository.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export default class EmbeddingPipeline {
  constructor() {
    this.batchSize = 50;
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
          procesed: 0,
          message: "No documents need embedding",
        };
      }
      logger.info(`Processing ${documents.length} documents for embedding`, {
        batchId,
      });

      const prepareDocs = documents.map((doc) => ({
        ...doc,
        preparedContent: this.embeddingService.prepareText(doc.content),
      }));

      const results = [];
      let totalTokens = 0;
      for (let i = 0; i < preparedDocs.length; i += 10) {
        const batch = preparedDocs.slice(i, i + 10);
        const texts = batch.map((doc) => doc.preparedContent);

        try {
          logger.debug(`Generating embeddings for batch`, {
            batchIndex: Math.floor(i / 10) + 1,
            size: batch.length,
          });
          const embeddings = await this.embeddingService.embedBatch(texts);

          const updates = batch.map((doc, idx) => ({
            documentId: doc.document_id,
            embedding: embeddings[idx].embedding,
            tokens: embeddings[idx].tokens,
          }));

          await embeddingRepository.batchUpdateEmbeddings(updates);
          results.push(...updates);
          totalTokens += embeddings.reduce((sum, e) => sum + e.tokens, 0);

          if (i + 10 < prepareDocs.length) {
            await this.delay(700);
          }
        } catch (error) {
          logger.error("Error during embedding generation or database update", {
            batchIndex: Math.floor(i / 10) + 1,
            error: error.message,
          });
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
