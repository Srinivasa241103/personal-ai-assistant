import retrievalService from "./retrievalService.js";
import contextFormatter from "./contextFormatter.js";
import { logger } from "../../utils/logger.js";
import { promptTemplates } from "../llm/index.js";

class RAGPipeline {
  constructor() {
    // RAG pipeline configuration
    this.config = {
      defaultTopN: 10,
      defaultTopK: 20, // Retrieve more, rank and return topN
      defaultMinSimilarity: 0.4, // Lower threshold for better recall
      minSimilarityFloor: 0.25, // Absolute minimum for fallback
    };
  }

  async process(userQuery, options = {}) {
    try {
      logger.info("Starting RAG pipeline", { query: userQuery });

      // Validate query
      if (!userQuery || typeof userQuery !== "string" || userQuery.trim().length === 0) {
        throw new Error("Invalid query: Query must be a non-empty string");
      }

      const retrievalOptions = {
        topN: options.topN || this.config.defaultTopN,
        topK: options.topK || this.config.defaultTopK,
        minSimilarity: options.minSimilarity || this.config.defaultMinSimilarity,
        diversify: options.diversify !== false,
        diversityThreshold: options.diversityThreshold || 0.85,
      };

      const retrievalResult = await retrievalService.retrieveWithFallback(
        userQuery,
        retrievalOptions
      );

      const formattedContext = contextFormatter.format(
        retrievalResult.results,
        userQuery,
        {
          includeMetadata: options.includeMetadata !== false,
          includeScore: options.includeScore || false,
        }
      );

      const systemPrompt = promptTemplates.getSystemPrompt(
        options.promptType || "default"
      );

      const prompt =
        formattedContext.documents.length > 0
          ? promptTemplates.buildPrompt(
              systemPrompt,
              formattedContext.contextString,
              userQuery,
              options
            )
          : promptTemplates.buildNoContextPrompt(systemPrompt, userQuery);

      const citations = contextFormatter.formatForCitation(
        formattedContext.documents
      );

      logger.info("RAG pipeline completed", {
        query: userQuery,
        documentsRetrieved: retrievalResult.metadata.totalFound,
        documentsUsed: formattedContext.documents.length,
        hasContext: formattedContext.documents.length > 0,
      });

      return {
        query: userQuery,
        prompt,
        context: formattedContext,
        citations,
        retrievalMetadata: retrievalResult.metadata,
        processedQuery: retrievalResult.processedQuery,
        ready: true,
      };
    } catch (error) {
      logger.error("RAG pipeline failed", { error: error.message, query: userQuery });
      throw error;
    }
  }

  async processWithDebug(userQuery, options = {}) {
    const result = await this.process(userQuery, options);
    return {
      ...result,
      debug: {
        context: contextFormatter.debugView(result.context),
        retrievalIntent: result.processedQuery.intent,
        retrievalFilters: result.retrievalMetadata.filters,
        queryKeywords: result.processedQuery.keywords,
        timeRange: result.processedQuery.timeRange,
      },
    };
  }

  /**
   * Process query with custom similarity threshold
   * Useful for queries that need higher precision or recall
   */
  async processWithThreshold(userQuery, minSimilarity, options = {}) {
    return this.process(userQuery, {
      ...options,
      minSimilarity: Math.max(this.config.minSimilarityFloor, minSimilarity),
    });
  }
}

export default new RAGPipeline();
