import { pool } from "../config/dbConfig.js";
import { logger } from "../utils/logger.js";

class EmbeddingRepository {
  /**
   * Get documents that need embedding
   */
  async getDocumentsNeedingEmbedding(limit = 100) {
    const query = `
        SELECT 
          id,
          document_id,
          source,
          type,
          content,
          title
        FROM documents
        WHERE needs_embedding = true
          AND content IS NOT NULL
          AND content != ''
        ORDER BY created_at ASC
        LIMIT $1
      `;

    try {
      const result = await pool.query(query, [limit]);
      logger.info("Found documents needing embedding", {
        count: result.rows.length,
      });
      return result.rows;
    } catch (error) {
      logger.error("Error fetching documents needing embedding", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update document with embedding
   */
  async updateDocumentEmbedding(
    documentId,
    embedding,
    tokens,
    model = "gemini-embedding-001"
  ) {
    const query = `
        UPDATE documents
        SET
          embedding = $1::vector,
          embedding_generated_at = NOW(),
          embedding_tokens = $2,
          embedding_model = $3,
          needs_embedding = false,
          updated_at = NOW()
        WHERE document_id = $4
        RETURNING id, document_id
      `;

    // Format embedding as PostgreSQL vector
    const vectorString = `[${embedding.join(",")}]`;

    try {
      const result = await pool.query(query, [
        vectorString,
        tokens,
        model,
        documentId,
      ]);

      if (result.rows.length === 0) {
        throw new Error(`Document not found: ${documentId}`);
      }

      logger.debug("Updated document with embedding", {
        documentId,
        tokens,
        embeddingDimensions: embedding.length,
      });

      return result.rows[0];
    } catch (error) {
      logger.error("Error updating document embedding", {
        documentId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Batch update embeddings (more efficient)
   */
  async batchUpdateEmbeddings(updates, model = "gemini-embedding-001") {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const { documentId, embedding, tokens } of updates) {
        const vectorString = `[${embedding.join(",")}]`;
        const query = `
          UPDATE documents
          SET
            embedding = $1::vector,
            embedding_generated_at = NOW(),
            embedding_tokens = $2,
            embedding_model = $3,
            needs_embedding = false,
            updated_at = NOW()
          WHERE document_id = $4
        `;

        logger.debug("Updating embedding", {
          documentId,
          embeddingDimensions: embedding.length,
          tokens,
        });

        await client.query(query, [vectorString, tokens, model, documentId]);
      }

      await client.query("COMMIT");

      logger.info("Batch updated embeddings", { count: updates.length });

      return { success: true, count: updates.length };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Error in batch update embeddings", {
        error: error.message || error.toString(),
        stack: error.stack,
        code: error.code,
        detail: error.detail,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Log embedding cost tracking
   */
  async logEmbeddingCost(
    batchId,
    model,
    documentCount,
    totalTokens,
    estimatedCost
  ) {
    const query = `
        INSERT INTO embedding_costs (
          batch_id,
          model,
          document_count,
          total_tokens,
          estimated_cost,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;

    try {
      const result = await pool.query(query, [
        batchId,
        model,
        documentCount,
        totalTokens,
        estimatedCost,
        "success",
      ]);

      logger.info("Logged embedding cost", {
        batchId,
        documentCount,
        totalTokens,
        estimatedCost,
      });

      return result.rows[0].id;
    } catch (error) {
      logger.error("Error logging embedding cost", { error: error.message });
      throw error;
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats() {
    const query = `
        SELECT
          COUNT(*) FILTER (WHERE embedding IS NOT NULL) as embedded_count,
          COUNT(*) FILTER (WHERE needs_embedding = true) as pending_count,
          COUNT(*) as total_count,
          SUM(embedding_tokens) FILTER (WHERE embedding IS NOT NULL) as total_tokens,
          AVG(embedding_tokens) FILTER (WHERE embedding IS NOT NULL) as avg_tokens_per_doc
        FROM documents
      `;

    try {
      const result = await pool.query(query);
      const stats = result.rows[0];

      // Get cost stats
      const costQuery = `
          SELECT
            SUM(total_tokens) as total_tokens_used,
            SUM(estimated_cost) as total_estimated_cost,
            COUNT(DISTINCT batch_id) as total_batches
          FROM embedding_costs
        `;

      const costResult = await pool.query(costQuery);
      const costStats = costResult.rows[0];

      return {
        documents: {
          embedded: parseInt(stats.embedded_count),
          pending: parseInt(stats.pending_count),
          total: parseInt(stats.total_count),
        },
        tokens: {
          total: parseInt(stats.total_tokens || 0),
          average: parseFloat(stats.avg_tokens_per_doc || 0).toFixed(2),
        },
        costs: {
          totalTokens: parseInt(costStats.total_tokens_used || 0),
          estimatedCost: parseFloat(
            costStats.total_estimated_cost || 0
          ).toFixed(4),
          batches: parseInt(costStats.total_batches || 0),
        },
      };
    } catch (error) {
      logger.error("Error getting embedding stats", { error: error.message });
      throw error;
    }
  }

  /**
   * Mark documents as needing re-embedding
   * Useful if you change embedding model or dimensions
   */
  async markForReembedding(documentIds = null) {
    let query;
    let params = [];

    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      query = `
          UPDATE documents
          SET needs_embedding = true,
              embedding = NULL,
              embedding_generated_at = NULL
          WHERE document_id = ANY($1::text[])
          RETURNING document_id
        `;
      params = [documentIds];
    } else {
      query = `
          UPDATE documents
          SET needs_embedding = true,
              embedding = NULL,
              embedding_generated_at = NULL
          RETURNING document_id
        `;
    }

    try {
      const result = await pool.query(query, params);
      logger.info("Marked documents for re-embedding", {
        count: result.rows.length,
      });
      return result.rows.length;
    } catch (error) {
      logger.error("Error marking documents for re-embedding", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Diagnose embedding pipeline issues
   */
  async diagnose() {
    try {
      // Check document counts
      const docQuery = `
        SELECT
          COUNT(*) as total_documents,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embedding,
          COUNT(*) FILTER (WHERE embedding IS NULL) as without_embedding,
          COUNT(*) FILTER (WHERE needs_embedding = true) as needs_embedding_true,
          COUNT(*) FILTER (WHERE needs_embedding = false) as needs_embedding_false,
          COUNT(*) FILTER (WHERE needs_embedding IS NULL) as needs_embedding_null,
          COUNT(*) FILTER (WHERE content IS NULL OR content = '') as empty_content
        FROM documents
      `;
      const docResult = await pool.query(docQuery);
      const docStats = docResult.rows[0];

      // Check pgvector extension
      let pgvectorEnabled = false;
      try {
        const extQuery = `SELECT * FROM pg_extension WHERE extname = 'vector'`;
        const extResult = await pool.query(extQuery);
        pgvectorEnabled = extResult.rows.length > 0;
      } catch (e) {
        pgvectorEnabled = false;
      }

      // Check embedding_costs table exists
      let costTableExists = false;
      try {
        const tableQuery = `
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'embedding_costs'
          ) as exists
        `;
        const tableResult = await pool.query(tableQuery);
        costTableExists = tableResult.rows[0].exists;
      } catch (e) {
        costTableExists = false;
      }

      // Check recent embedding activity
      let recentActivity = null;
      try {
        const activityQuery = `
          SELECT
            COUNT(*) as count,
            MAX(embedding_generated_at) as last_embedding
          FROM documents
          WHERE embedding_generated_at > NOW() - INTERVAL '24 hours'
        `;
        const activityResult = await pool.query(activityQuery);
        recentActivity = activityResult.rows[0];
      } catch (e) {
        recentActivity = { error: e.message };
      }

      return {
        documents: {
          total: parseInt(docStats.total_documents),
          withEmbedding: parseInt(docStats.with_embedding),
          withoutEmbedding: parseInt(docStats.without_embedding),
          needsEmbeddingTrue: parseInt(docStats.needs_embedding_true),
          needsEmbeddingFalse: parseInt(docStats.needs_embedding_false),
          needsEmbeddingNull: parseInt(docStats.needs_embedding_null),
          emptyContent: parseInt(docStats.empty_content),
        },
        database: {
          pgvectorEnabled,
          costTableExists,
        },
        recentActivity: {
          embeddingsLast24h: parseInt(recentActivity?.count || 0),
          lastEmbeddingAt: recentActivity?.last_embedding || null,
        },
        issues: this.identifyIssues(docStats, pgvectorEnabled, costTableExists),
      };
    } catch (error) {
      logger.error("Error in diagnose", { error: error.message });
      throw error;
    }
  }

  /**
   * Identify potential issues
   */
  identifyIssues(docStats, pgvectorEnabled, costTableExists) {
    const issues = [];

    if (!pgvectorEnabled) {
      issues.push("CRITICAL: pgvector extension is not enabled");
    }

    if (!costTableExists) {
      issues.push("WARNING: embedding_costs table does not exist");
    }

    const needsEmbedding = parseInt(docStats.needs_embedding_true);
    const withoutEmbedding = parseInt(docStats.without_embedding);

    if (withoutEmbedding > 0 && needsEmbedding === 0) {
      issues.push(
        `ISSUE: ${withoutEmbedding} documents without embeddings but needs_embedding is not set to true. Run POST /embedding/mark-pending to fix.`
      );
    }

    if (parseInt(docStats.empty_content) > 0) {
      issues.push(
        `WARNING: ${docStats.empty_content} documents have empty content and cannot be embedded`
      );
    }

    if (issues.length === 0) {
      issues.push("No issues detected");
    }

    return issues;
  }

  /**
   * Mark all documents without embeddings as needing embedding
   */
  async markAllPendingForEmbedding() {
    const query = `
      UPDATE documents
      SET needs_embedding = true
      WHERE embedding IS NULL
        AND content IS NOT NULL
        AND content != ''
        AND (needs_embedding IS NULL OR needs_embedding = false)
      RETURNING document_id
    `;

    try {
      const result = await pool.query(query);
      logger.info("Marked documents for embedding", {
        count: result.rows.length,
      });
      return result.rows.length;
    } catch (error) {
      logger.error("Error marking documents for embedding", {
        error: error.message,
      });
      throw error;
    }
  }
}

export { EmbeddingRepository };
