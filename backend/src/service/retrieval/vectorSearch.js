import { pool } from "../../config/dbConfig.js";
import { logger } from "../../utils/logger.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

class VectorSearchService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    });
    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "1536");

    // Simple LRU cache for query embeddings (max 100 entries, 5 min TTL)
    this.embeddingCache = new Map();
    this.cacheMaxSize = 100;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  _getCacheKey(query) {
    return query.trim().toLowerCase();
  }

  _getFromCache(query) {
    const key = this._getCacheKey(query);
    const cached = this.embeddingCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug("Using cached embedding", { query: query.substring(0, 50) });
      return cached.embedding;
    }
    if (cached) {
      this.embeddingCache.delete(key); // Expired
    }
    return null;
  }

  _setCache(query, embedding) {
    const key = this._getCacheKey(query);
    // Evict oldest if at capacity
    if (this.embeddingCache.size >= this.cacheMaxSize) {
      const oldestKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(oldestKey);
    }
    this.embeddingCache.set(key, { embedding, timestamp: Date.now() });
  }

  async embedQuery(query) {
    try {
      // Check cache first
      const cachedEmbedding = this._getFromCache(query);
      if (cachedEmbedding) {
        return cachedEmbedding;
      }

      logger.info("Generating query embedding", {
        queryLength: query.length,
      });

      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text: query.trim() }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: this.dimensions,
      });

      const embedding = result.embedding.values;

      // Cache the embedding
      this._setCache(query, embedding);

      logger.debug("Query embedding generated", {
        dimensions: embedding.length,
      });

      return embedding;
    } catch (error) {
      logger.error("Error generating query embedding", {
        error: error.message,
        query: query.substring(0, 100),
      });
      throw new Error("Failed to generate query embedding");
    }
  }

  async search(query, options = {}) {
    try {
      const {
        topK = 10,
        filters = {},
        minSimilarity = 0.5,
        includeMetadata = true,
      } = options;

      // Validate inputs
      const safeTopK = Math.min(Math.max(1, parseInt(topK) || 10), 100);
      const safeMinSimilarity = Math.min(
        Math.max(0, parseFloat(minSimilarity) || 0.5),
        1
      );

      // Step 1: Generate query embedding
      const queryEmbedding = await this.embedQuery(query);

      // Step 2: Build SQL query with filters
      const { sql, values } = this.buildSearchQuery(
        queryEmbedding,
        safeTopK,
        filters,
        safeMinSimilarity
      );

      logger.info("Executing vector search", {
        topK: safeTopK,
        filters,
        minSimilarity: safeMinSimilarity,
      });

      // Step 3: Execute search
      const result = await pool.query(sql, values);

      logger.info("Vector search completed", {
        resultsFound: result.rows.length,
      });

      // Step 4: Format results
      return this.formatResults(result.rows, includeMetadata);
    } catch (error) {
      logger.error("Vector search failed", {
        error: error.message,
        query: query.substring(0, 100),
      });
      throw error;
    }
  }

  buildSearchQuery(queryEmbedding, topK, filters, minSimilarity) {
    const values = [`[${queryEmbedding.join(",")}]`];
    let paramIndex = 2;

    let sql = `
      SELECT
        document_id,
        source,
        type,
        content,
        title,
        timestamp,
        author,
        metadata,
        1 - (embedding <=> $1::vector) AS similarity
      FROM documents
      WHERE embedding IS NOT NULL
    `;

    // Apply filters
    if (filters.source) {
      sql += ` AND source = $${paramIndex}`;
      values.push(filters.source);
      paramIndex++;
    }

    if (filters.type) {
      sql += ` AND type = $${paramIndex}`;
      values.push(filters.type);
      paramIndex++;
    }

    if (filters.author) {
      sql += ` AND author ILIKE $${paramIndex}`;
      values.push(`%${filters.author}%`);
      paramIndex++;
    }

    // Also search in metadata for author/sender
    if (filters.potentialAuthor) {
      sql += ` AND (author ILIKE $${paramIndex} OR metadata::text ILIKE $${paramIndex})`;
      values.push(`%${filters.potentialAuthor}%`);
      paramIndex++;
    }

    if (filters.timeRange) {
      if (filters.timeRange.start) {
        sql += ` AND timestamp >= $${paramIndex}`;
        values.push(filters.timeRange.start);
        paramIndex++;
      }
      if (filters.timeRange.end) {
        sql += ` AND timestamp <= $${paramIndex}`;
        values.push(filters.timeRange.end);
        paramIndex++;
      }
    }

    // Similarity threshold - parameterized to prevent SQL injection
    sql += ` AND (1 - (embedding <=> $1::vector)) >= $${paramIndex}`;
    values.push(minSimilarity);
    paramIndex++;

    // Order by similarity and limit - parameterized
    sql += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
    values.push(topK);

    return { sql, values };
  }

  formatResults(rows, includeMetadata) {
    return rows.map((row) => {
      const result = {
        documentId: row.document_id,
        source: row.source,
        type: row.type,
        content: row.content,
        title: row.title,
        timestamp: row.timestamp,
        author: row.author,
        similarity: parseFloat(row.similarity?.toFixed(4) || 0),
      };

      if (includeMetadata && row.metadata) {
        result.metadata = row.metadata;
      }

      return result;
    });
  }

  async searchWithExpansion(query, options = {}) {
    let results = await this.search(query, options);

    // If too few results, try with lower similarity threshold
    if (results.length < 3 && (options.minSimilarity || 0.5) > 0.3) {
      logger.info("Expanding search with lower similarity threshold");

      const expandedOptions = {
        ...options,
        minSimilarity: 0.3,
        topK: options.topK || 10,
      };

      results = await this.search(query, expandedOptions);
    }

    return results;
  }

  async searchByTimeRange(query, startDate, endDate, options = {}) {
    return await this.search(query, {
      ...options,
      filters: {
        ...options.filters,
        timeRange: {
          start: startDate,
          end: endDate,
        },
      },
    });
  }

  async searchBySource(query, source, options = {}) {
    return await this.search(query, {
      ...options,
      filters: {
        ...options.filters,
        source,
      },
    });
  }

  async findSimilarDocuments(documentId, topK = 5) {
    try {
      logger.info("Finding similar documents", { documentId, topK });

      const safeTopK = Math.min(Math.max(1, parseInt(topK) || 5), 50);

      // Get the embedding of the source document
      const sourceDoc = await pool.query(
        "SELECT embedding FROM documents WHERE document_id = $1",
        [documentId]
      );

      if (sourceDoc.rows.length === 0) {
        throw new Error("Document not found");
      }

      const embedding = sourceDoc.rows[0].embedding;

      if (!embedding) {
        throw new Error("Document has no embedding");
      }

      // Search for similar documents (excluding the source document)
      // embedding from DB is already in vector format, use it directly
      const sql = `
        SELECT
          document_id,
          source,
          type,
          content,
          title,
          timestamp,
          author,
          1 - (embedding <=> $1) AS similarity
        FROM documents
        WHERE embedding IS NOT NULL
          AND document_id != $2
        ORDER BY similarity DESC
        LIMIT $3
      `;

      const result = await pool.query(sql, [embedding, documentId, safeTopK]);

      return this.formatResults(result.rows, false);
    } catch (error) {
      logger.error("Error finding similar documents", {
        error: error.message,
        documentId,
      });
      throw error;
    }
  }

  /**
   * Hybrid search combining vector similarity with keyword matching
   */
  async hybridSearch(query, keywords = [], options = {}) {
    try {
      const { topK = 10, filters = {}, minSimilarity = 0.4 } = options;

      const safeTopK = Math.min(Math.max(1, parseInt(topK) || 10), 100);
      const queryEmbedding = await this.embedQuery(query);

      const values = [`[${queryEmbedding.join(",")}]`];
      let paramIndex = 2;

      // Build keyword search condition
      let keywordCondition = "";
      if (keywords.length > 0) {
        const keywordPatterns = keywords.map((kw) => {
          values.push(`%${kw}%`);
          return `content ILIKE $${paramIndex++}`;
        });
        keywordCondition = `OR (${keywordPatterns.join(" OR ")})`;
      }

      let sql = `
        SELECT
          document_id,
          source,
          type,
          content,
          title,
          timestamp,
          author,
          metadata,
          1 - (embedding <=> $1::vector) AS similarity,
          CASE WHEN ${
            keywords.length > 0
              ? keywords.map((_, i) => `content ILIKE $${i + 2}`).join(" OR ")
              : "FALSE"
          } THEN 0.1 ELSE 0 END AS keyword_boost
        FROM documents
        WHERE embedding IS NOT NULL
          AND ((1 - (embedding <=> $1::vector)) >= $${paramIndex} ${keywordCondition})
      `;

      values.push(minSimilarity);
      paramIndex++;

      // Apply filters
      if (filters.source) {
        sql += ` AND source = $${paramIndex}`;
        values.push(filters.source);
        paramIndex++;
      }

      if (filters.timeRange?.start) {
        sql += ` AND timestamp >= $${paramIndex}`;
        values.push(filters.timeRange.start);
        paramIndex++;
      }

      if (filters.timeRange?.end) {
        sql += ` AND timestamp <= $${paramIndex}`;
        values.push(filters.timeRange.end);
        paramIndex++;
      }

      sql += ` ORDER BY (similarity + keyword_boost) DESC LIMIT $${paramIndex}`;
      values.push(safeTopK);

      const result = await pool.query(sql, values);

      return this.formatResults(result.rows, true);
    } catch (error) {
      logger.error("Hybrid search failed", { error: error.message });
      throw error;
    }
  }
}

export default new VectorSearchService();
