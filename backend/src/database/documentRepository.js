// services/database/DocumentRepository.js
import { pool } from '../config/dbConfig.js';

export class DocumentRepository {
    /**
     * Creates a new document record in the database.
     * @param {Object} document - The document data to be inserted.
     * @return {Promise<Object>} The newly created document record.
     */
    async create(document) {
        const query = `
            INSERT INTO documents
            (document_id, source, type, content, title, timestamp, author, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;`;
        
        const values = [
            document.document_id,
            document.source,
            document.type,
            document.content,
            document.title,
            document.timestamp,
            document.author,
            JSON.stringify(document.metadata) // Ensure JSONB is properly formatted
        ];

        try {
            const { rows } = await pool.query(query, values);
            if (rows.length === 0) {
                throw new Error('Failed to create document');
            }
            return rows[0];
        } catch (error) {
            if (error.code === '23505') { // Unique violation
                throw new Error(`Document with ID ${document.document_id} already exists`);
            }
            throw error;
        }
    }

    /**
     * Find document by document_id
     * @param {string} documentId
     * @returns {Promise<Object|null>}
     */
    async findByDocumentId(documentId) {
        const query = `
            SELECT * FROM documents
            WHERE document_id = $1;`;
        const values = [documentId];
        const { rows } = await pool.query(query, values);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Find all documents from a source
     * @param {string} source
     * @returns {Promise<Array>}
     */
    async findBySource(source) {
        const query = `
            SELECT * FROM documents
            WHERE source = $1
            ORDER BY timestamp DESC;`;
        const values = [source];
        const { rows } = await pool.query(query, values);
        return rows;
    }

    /**
     * Find documents that need embeddings
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async findPendingEmbeddings(limit = 50) {
        const query = `
            SELECT * FROM documents
            WHERE embedding IS NULL  -- Fixed: singular 'embedding'
            ORDER BY created_at ASC
            LIMIT $1;`;
        const values = [limit];
        const { rows } = await pool.query(query, values);
        return rows;
    }

    /**
     * Update document with embedding vector
     * @param {string} documentId
     * @param {number[]} embedding
     * @returns {Promise<Object>}
     */
    async updateEmbedding(documentId, embedding) {
        const query = `
            UPDATE documents
            SET embedding = $1  -- Fixed: singular 'embedding'
            WHERE document_id = $2
            RETURNING *;`;
        
        // Convert array to pgvector format: '[0.1, 0.2, 0.3]'
        const embeddingString = `[${embedding.join(',')}]`;
        const values = [embeddingString, documentId];
        
        const { rows } = await pool.query(query, values);
        if (rows.length === 0) {
            throw new Error(`Document with ID ${documentId} not found`);
        }
        return rows[0];
    }

    /**
     * Vector similarity search
     * @param {number[]} queryVector
     * @param {Object} options
     * @returns {Promise<Array>}
     */
    async search(queryVector, options = {}) {
        const {
            limit = 10,
            source = null,
            startDate = null,
            endDate = null,
        } = options;

        const values = [];
        let idx = 1;

        // Convert query vector to pgvector format
        const vectorString = `[${queryVector.join(',')}]`;
        values.push(vectorString);
        idx++;

        let whereClause = `embedding IS NOT NULL`;

        if (source) {
            whereClause += ` AND source = $${idx}`;
            values.push(source);
            idx++;
        }

        if (startDate) {
            whereClause += ` AND timestamp >= $${idx}`;
            values.push(startDate);
            idx++;
        }

        if (endDate) {
            whereClause += ` AND timestamp <= $${idx}`;
            values.push(endDate);
            idx++;
        }

        const query = `
            SELECT
                *,
                embedding <=> $1::vector AS similarity
            FROM documents
            WHERE ${whereClause}
            ORDER BY similarity ASC
            LIMIT $${idx};
        `;

        values.push(limit);

        const { rows } = await pool.query(query, values);
        
        // Return empty array instead of throwing error
        return rows;
    }

    /**
     * Count documents by source
     * @returns {Promise<Object>}
     */
    async countBySource() {
        const query = `
            SELECT source, COUNT(*) as count
            FROM documents
            GROUP BY source;`;
        const { rows } = await pool.query(query);
        const result = {};
        rows.forEach(row => {
            result[row.source] = parseInt(row.count, 10);
        });
        return result;
    }

    /**
     * Check if document exists
     * @param {string} documentId
     * @returns {Promise<boolean>}
     */
    async exists(documentId) {
        const query = `
            SELECT 1 FROM documents
            WHERE document_id = $1;`;
        const values = [documentId];
        const { rows } = await pool.query(query, values);
        return rows.length > 0;
    }

    /**
     * Delete a document by document_id
     * @param {string} documentId
     * @returns {Promise<boolean>}
     */
    async delete(documentId) {
        const query = `
            DELETE FROM documents
            WHERE document_id = $1
            RETURNING *;`;
        const values = [documentId];
        const { rows } = await pool.query(query, values);
        return rows.length > 0;
    }

    /**
     * Get total count of all documents
     * @returns {Promise<number>}
     */
    async getTotalCount() {
        const query = `SELECT COUNT(*) as count FROM documents;`;
        const { rows } = await pool.query(query);
        return parseInt(rows[0].count, 10);
    }

    /**
     * Find documents within date range
     * @param {Date} startDate
     * @param {Date} endDate
     * @param {string} source - Optional source filter
     * @returns {Promise<Array>}
     */
    async findByDateRange(startDate, endDate, source = null) {
        let query = `
            SELECT * FROM documents
            WHERE timestamp >= $1 AND timestamp <= $2`;
        
        const values = [startDate, endDate];

        if (source) {
            query += ` AND source = $3`;
            values.push(source);
        }

        query += ` ORDER BY timestamp DESC;`;

        const { rows } = await pool.query(query, values);
        return rows;
    }
}