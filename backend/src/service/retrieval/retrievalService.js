// backend/src/services/retrieval/retrievalService.js

import QueryProcessor from "./queryProcessor.js";
import vectorSearch from "./vectorSearch.js";
import resultRanker from "./resultRanker.js";
import { logger } from "../../utils/logger.js";

class RetrievalService {
  constructor() {
    this.queryProcessor = new QueryProcessor();
  }

  /**
   * Complete retrieval pipeline
   * Processes query → Searches → Ranks → Returns results
   */
  async retrieve(query, options = {}) {
    try {
      logger.info("Starting retrieval pipeline", { query });

      // Step 1: Process query to extract intent and filters
      const processedQuery = await this.queryProcessor.process(query);

      logger.debug("Query processed", {
        intent: processedQuery.intent,
        filters: processedQuery.filters,
      });

      // Step 2: Merge user options with extracted filters
      const searchOptions = {
        topK: options.topK || 25, // Retrieve more candidates for better ranking
        minSimilarity: options.minSimilarity || 0.4, // Lower threshold for better recall
        filters: {
          ...processedQuery.filters,
          ...options.filters,
        },
      };

      // Step 3: Vector search
      const searchResults = await vectorSearch.search(
        processedQuery.originalQuery,
        searchOptions
      );

      logger.debug("Vector search completed", {
        resultsFound: searchResults.length,
      });

      // Step 4: Rank results
      const rankedResults = resultRanker.rank(
        searchResults,
        processedQuery.originalQuery,
        {
          diversify: options.diversify !== false, // Default true
          diversityThreshold: options.diversityThreshold || 0.85, // Lower threshold keeps more diverse results
        }
      );

      // Step 5: Apply final filtering
      let finalResults = rankedResults;

      // Filter by minimum final score
      if (options.minFinalScore) {
        finalResults = resultRanker.filterByMinScore(
          finalResults,
          options.minFinalScore
        );
      }

      // Get top N
      const topN = options.topN || 10;
      finalResults = resultRanker.getTopN(finalResults, topN);

      logger.info("Retrieval pipeline completed", {
        query,
        totalFound: searchResults.length,
        afterRanking: rankedResults.length,
        finalReturned: finalResults.length,
      });

      return {
        query: processedQuery.originalQuery,
        processedQuery,
        results: finalResults,
        metadata: {
          totalFound: searchResults.length,
          returned: finalResults.length,
          intent: processedQuery.intent,
          filters: searchOptions.filters,
        },
      };
    } catch (error) {
      logger.error("Retrieval pipeline failed", {
        error: error.message,
        query,
      });
      throw error;
    }
  }

  /**
   * Retrieve with automatic fallback
   * If no results or too few, tries with relaxed parameters
   */
  async retrieveWithFallback(query, options = {}) {
    let results = await this.retrieve(query, options);
    const minResultsRequired = options.minResults || 3;

    // If no results or too few, try again with relaxed parameters
    if (results.results.length < minResultsRequired) {
      logger.info("Insufficient results, trying with relaxed parameters", {
        found: results.results.length,
        required: minResultsRequired,
      });

      const relaxedOptions = {
        ...options,
        topK: (options.topK || 25) + 15, // Search more candidates
        minSimilarity: 0.25, // Much lower threshold for recall
        minFinalScore: 0.15, // Lower final score threshold
        topN: options.topN || 10,
        diversityThreshold: 0.8, // Allow more similar results
      };

      const relaxedResults = await this.retrieve(query, relaxedOptions);

      // Return relaxed results only if they found more
      if (relaxedResults.results.length > results.results.length) {
        results = relaxedResults;
        results.metadata.usedFallback = true;
      }
    }

    return results;
  }

  /**
   * Explain why a document was ranked at a certain position
   */
  explainRanking(retrievalResults, documentId) {
    const result = retrievalResults.results.find(
      (r) => r.documentId === documentId
    );

    if (!result) {
      return { error: "Document not found in results" };
    }

    return resultRanker.explainScoring(result);
  }
}

export default new RetrievalService();
