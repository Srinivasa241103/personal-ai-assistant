import { logger } from "../../utils/logger.js";
import { extractKeywords } from "../../utils/textProcessing.js";

class ResultRanker {
  constructor() {
    // Tuned weights for better relevance
    // Higher vector weight since embeddings capture semantic meaning well
    // Keyword match is important for exact term matching
    this.weights = {
      vectorSimilarity: 0.45,
      recency: 0.15,
      keywordMatch: 0.25, // Increased for better exact matching
      sourceRelevance: 0.10,
      lengthQuality: 0.05,
    };

    this.sourcePriority = {
      gmail: 1.0,
      google_calendar: 0.95,
      spotify: 0.8,
    };

    // Faster decay - recent documents are more relevant
    this.recencyDecayDays = 60;
  }

  rank(results, originalQuery, options = {}) {
    try {
      logger.info("Ranking search results", {
        resultCount: results.length,
        query: originalQuery,
      });

      if (!results || results.length === 0) {
        return [];
      }

      // Extract keywords from query for keyword matching
      const queryKeywords = extractKeywords(originalQuery, 15);

      // Score each result
      const scoredResults = results.map((result) => {
        const scores = this.calculateScores(
          result,
          queryKeywords,
          originalQuery
        );
        const vectorSimilarity = result.similarity || 0;

        // If hybrid search provided a keyword boost, incorporate it
        // This ensures we don't double-count but still benefit from DB-level keyword matching
        if (result.keywordBoost && result.keywordBoost > 0) {
          // Blend the DB keyword boost with our calculated keyword score
          scores.keyword = Math.min(1, scores.keyword + result.keywordBoost * 0.5);
        }

        const finalScore = this.calculateFinalScore(scores, vectorSimilarity);

        return {
          ...result,
          scores: {
            vector: vectorSimilarity,
            recency: scores.recency,
            keyword: scores.keyword,
            source: scores.source,
            length: scores.length,
            dbKeywordBoost: result.keywordBoost || 0,
            final: finalScore,
          },
          finalScore,
        };
      });

      // Sort by final score (descending)
      const ranked = scoredResults.sort((a, b) => b.finalScore - a.finalScore);

      // Apply diversity filtering if requested
      const diversified = options.diversify
        ? this.diversifyResults(ranked, options.diversityThreshold || 0.9)
        : ranked;

      logger.info("Ranking completed", {
        originalCount: results.length,
        finalCount: diversified.length,
        topScore: diversified[0]?.finalScore?.toFixed(4) || 0,
      });

      return diversified;
    } catch (error) {
      logger.error("Error ranking results", { error: error.message });
      // Fallback: return original results sorted by similarity
      return results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    }
  }

  calculateScores(result, queryKeywords, originalQuery) {
    return {
      recency: this.calculateRecencyScore(result.timestamp),
      keyword: this.calculateKeywordScore(result, queryKeywords, originalQuery),
      source: this.calculateSourceScore(result.source),
      length: this.calculateLengthScore(result.content),
    };
  }

  calculateRecencyScore(timestamp) {
    try {
      const now = new Date();
      const docDate = new Date(timestamp);
      const daysDiff = (now - docDate) / (1000 * 60 * 60 * 24);

      // Exponential decay: score = e^(-days / decayConstant)
      const decayConstant = this.recencyDecayDays / Math.log(2); // Half-life
      const score = Math.exp(-daysDiff / decayConstant);

      return Math.max(0, Math.min(1, score)); // Clamp between 0-1
    } catch (error) {
      logger.warn("Error calculating recency score", { timestamp });
      return 0.5; // Default medium score
    }
  }

  calculateKeywordScore(result, queryKeywords, originalQuery) {
    const content = (result.content || "").toLowerCase();
    const title = (result.title || "").toLowerCase();
    const author = (result.author || "").toLowerCase();

    let score = 0;
    let matches = 0;

    // Check each keyword
    queryKeywords.forEach((keyword) => {
      const keywordLower = keyword.toLowerCase();
      if (title.includes(keywordLower)) {
        score += 0.4;
        matches++;
      }
      if (author.includes(keywordLower)) {
        score += 0.3;
        matches++;
      }
      if (content.includes(keywordLower)) {
        score += 0.2;
        matches++;
      }
    });
    if (content.includes(originalQuery.toLowerCase())) {
      score += 0.5;
    }
    if (queryKeywords.length > 0) {
      score = score / queryKeywords.length;
    }

    return Math.min(1, score); // Cap at 1.0
  }
  calculateSourceScore(source) {
    return this.sourcePriority[source] || 0.5;
  }

  calculateLengthScore(content) {
    if (!content) return 0;
    const length = content.length;
    const minOptimal = 200;
    const maxOptimal = 2000;
    if (length >= minOptimal && length <= maxOptimal) {
      return 1.0;
    }
    if (length < minOptimal) {
      return length / minOptimal;
    }

    const excess = length - maxOptimal;
    const penalty = 1 / (1 + Math.log10(excess / 1000 + 1));
    return penalty;
  }

  calculateFinalScore(scores, vectorSimilarity) {
    const final =
      vectorSimilarity * this.weights.vectorSimilarity +
      scores.recency * this.weights.recency +
      scores.keyword * this.weights.keywordMatch +
      scores.source * this.weights.sourceRelevance +
      scores.length * this.weights.lengthQuality;

    return Math.max(0, Math.min(1, final));
  }

  diversifyResults(results, similarityThreshold = 0.9) {
    if (results.length <= 1) return results;

    const diverse = [results[0]]; // Always keep top result

    for (let i = 1; i < results.length; i++) {
      const candidate = results[i];
      let isDiverse = true;

      // Check against already selected results
      for (const selected of diverse) {
        const contentSimilarity = this.calculateContentSimilarity(
          candidate.content,
          selected.content
        );

        if (contentSimilarity > similarityThreshold) {
          isDiverse = false;
          logger.debug("Removing similar document", {
            candidate: candidate.documentId,
            similarTo: selected.documentId,
            similarity: contentSimilarity,
          });
          break;
        }
      }

      if (isDiverse) {
        diverse.push(candidate);
      }
    }

    return diverse;
  }

  calculateContentSimilarity(content1, content2) {
    if (!content1 || !content2) return 0;

    // Simple: compare first 200 characters
    const sample1 = content1.substring(0, 200).toLowerCase();
    const sample2 = content2.substring(0, 200).toLowerCase();

    // Count matching words
    const words1 = new Set(sample1.split(/\s+/));
    const words2 = new Set(sample2.split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size; // Jaccard similarity
  }

  boostSource(results, source, boostFactor = 1.2) {
    return results.map((result) => {
      if (result.source === source) {
        return {
          ...result,
          finalScore: Math.min(1, result.finalScore * boostFactor),
        };
      }
      return result;
    });
  }

  /**
   * Filter results by minimum score threshold
   */
  filterByMinScore(results, minScore = 0.3) {
    return results.filter((result) => result.finalScore >= minScore);
  }

  getTopN(results, n = 10) {
    return results.slice(0, n);
  }

  explainScoring(result) {
    return {
      documentId: result.documentId,
      finalScore: result.finalScore,
      breakdown: {
        vectorSimilarity: {
          score: result.scores.vector,
          weight: this.weights.vectorSimilarity,
          contribution: result.scores.vector * this.weights.vectorSimilarity,
        },
        recency: {
          score: result.scores.recency,
          weight: this.weights.recency,
          contribution: result.scores.recency * this.weights.recency,
        },
        keywordMatch: {
          score: result.scores.keyword,
          weight: this.weights.keywordMatch,
          contribution: result.scores.keyword * this.weights.keywordMatch,
        },
        sourceRelevance: {
          score: result.scores.source,
          weight: this.weights.sourceRelevance,
          contribution: result.scores.source * this.weights.sourceRelevance,
        },
        lengthQuality: {
          score: result.scores.length,
          weight: this.weights.lengthQuality,
          contribution: result.scores.length * this.weights.lengthQuality,
        },
      },
    };
  }
}

export default new ResultRanker();
