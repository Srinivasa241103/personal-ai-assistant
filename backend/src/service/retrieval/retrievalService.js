// backend/src/services/retrieval/retrievalService.js

import QueryProcessor from "./queryProcessor.js";
import vectorSearch from "./vectorSearch.js";
import resultRanker from "./resultRanker.js";
import { logger } from "../../utils/logger.js";

class RetrievalService {
  constructor() {
    this.queryProcessor = new QueryProcessor();

    // Configuration for adaptive search strategies
    this.searchConfig = {
      // Use hybrid search when keywords are significant
      hybridKeywordThreshold: 2,
      // Boost weights for specific intents
      intentBoosts: {
        search_email: { source: "gmail", boost: 1.3 },
        search_calendar: { source: "google_calendar", boost: 1.3 },
        search_spotify: { source: "spotify", boost: 1.3 },
      },
    };
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
        keywords: processedQuery.keywords,
        filters: processedQuery.filters,
      });

      // Step 2: Merge user options with extracted filters
      const searchOptions = {
        topK: options.topK || 30, // Retrieve more candidates for better ranking
        minSimilarity: options.minSimilarity || 0.35, // Lower threshold for better recall
        filters: {
          ...processedQuery.filters,
          ...options.filters,
        },
      };

      // Step 3: Choose search strategy based on query characteristics
      let searchResults;
      const useHybrid = processedQuery.keywords.length >= this.searchConfig.hybridKeywordThreshold;

      if (useHybrid) {
        // Use hybrid search for queries with significant keywords
        logger.debug("Using hybrid search strategy", {
          keywords: processedQuery.keywords,
        });

        searchResults = await vectorSearch.hybridSearch(
          processedQuery.originalQuery,
          processedQuery.keywords.slice(0, 5), // Use top 5 keywords
          searchOptions
        );
      } else {
        // Use standard vector search with expansion
        searchResults = await vectorSearch.searchWithExpansion(
          processedQuery.originalQuery,
          searchOptions
        );
      }

      logger.debug("Search completed", {
        strategy: useHybrid ? "hybrid" : "vector",
        resultsFound: searchResults.length,
      });

      // Step 4: Rank results with intent-aware boosting
      let rankedResults = resultRanker.rank(
        searchResults,
        processedQuery.originalQuery,
        {
          diversify: options.diversify !== false,
          diversityThreshold: options.diversityThreshold || 0.85,
        }
      );

      // Apply intent-based source boosting
      const intentBoost = this.searchConfig.intentBoosts[processedQuery.intent];
      if (intentBoost) {
        rankedResults = resultRanker.boostSource(
          rankedResults,
          intentBoost.source,
          intentBoost.boost
        );
        // Re-sort after boosting
        rankedResults.sort((a, b) => b.finalScore - a.finalScore);
      }

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
        searchStrategy: useHybrid ? "hybrid" : "vector",
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
          searchStrategy: useHybrid ? "hybrid" : "vector",
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
