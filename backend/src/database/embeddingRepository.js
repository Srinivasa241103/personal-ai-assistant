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
}

export { EmbeddingRepository };
