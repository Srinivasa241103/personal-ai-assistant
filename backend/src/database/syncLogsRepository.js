// services/database/SyncLogRepository.js
import { pool } from '../config/dbConfig.js';

export class SyncLogRepository {
    /**
     * Find sync log by ID
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    async findById(id) {
        const query = `
            SELECT * FROM sync_logs
            WHERE id = $1;`;

        const values = [id];
        const { rows } = await pool.query(query, values);

        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Create a new sync log entry
     * @param {string} source
     * @returns {Promise<Object>}
     */
    async create(source) {
        const query = `
            INSERT INTO sync_logs
            (source, status)
            VALUES ($1, $2)
            RETURNING *;`;
        
        const values = [source, 'in_progress'];
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            throw new Error('Failed to create sync log');
        }
        
        return rows[0];
    }

    /**
     * Update sync log when complete
     * @param {number} id
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async complete(id, updates) {
        const query = `
            UPDATE sync_logs
            SET 
                sync_completed_at = NOW(),
                status = $1,
                documents_fetched = $2,
                documents_stored = $3,
                last_sync_timestamp = $4,
                error_message = $5
            WHERE id = $6
            RETURNING *;`;
        
        const values = [
            updates.status || 'success',
            updates.documentsFetched || 0,
            updates.documentsStored || 0,
            updates.lastSyncTimestamp || null,
            updates.error || null,
            id
        ];
        
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            throw new Error(`Sync log with ID ${id} not found`);
        }
        
        return rows[0];
    }

    /**
     * Mark sync log as failed
     * @param {number} id
     * @param {string} errorMessage
     * @returns {Promise<Object>}
     */
    async fail(id, errorMessage) {
        return this.complete(id, {
            status: 'failed',
            error: errorMessage,
            documentsFetched: 0,
            documentsStored: 0
        });
    }

    /**
     * Get last successful sync for a source
     * @param {string} source
     * @returns {Promise<Object|null>}
     */
    async getLastSuccessfulSync(source) {
        const query = `
            SELECT * FROM sync_logs
            WHERE source = $1 AND status = 'success'
            ORDER BY sync_completed_at DESC
            LIMIT 1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Get last sync (any status) for a source
     * @param {string} source
     * @returns {Promise<Object|null>}
     */
    async getLastSync(source) {
        const query = `
            SELECT * FROM sync_logs
            WHERE source = $1
            ORDER BY sync_started_at DESC
            LIMIT 1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Get all sync logs for a source
     * @param {string} source
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async findBySource(source, limit = 10) {
        const query = `
            SELECT * FROM sync_logs
            WHERE source = $1
            ORDER BY sync_started_at DESC
            LIMIT $2;`;
        
        const values = [source, limit];
        const { rows } = await pool.query(query, values);
        
        return rows;
    }

    /**
     * Get all sync logs (all sources)
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async findAll(limit = 20) {
        const query = `
            SELECT * FROM sync_logs
            ORDER BY sync_started_at DESC
            LIMIT $1;`;
        
        const values = [limit];
        const { rows } = await pool.query(query, values);
        
        return rows;
    }

    /**
     * Get sync statistics for a source
     * @param {string} source
     * @returns {Promise<Object>}
     */
    async getStats(source) {
        const query = `
            SELECT 
                COUNT(*) as total_syncs,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_syncs,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_syncs,
                SUM(documents_fetched) as total_documents_fetched,
                SUM(documents_stored) as total_documents_stored,
                MAX(sync_completed_at) as last_sync_time
            FROM sync_logs
            WHERE source = $1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows[0];
    }

    /**
     * Check if a sync is currently in progress for a source
     * @param {string} source
     * @returns {Promise<boolean>}
     */
    async isSyncInProgress(source) {
        const query = `
            SELECT 1 FROM sync_logs
            WHERE source = $1 AND status = 'in_progress'
            LIMIT 1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0;
    }

    /**
     * Delete old sync logs (cleanup)
     * @param {number} daysToKeep - Keep logs from last N days
     * @returns {Promise<number>} Number of deleted rows
     */
    async deleteOldLogs(daysToKeep = 30) {
        // Validate daysToKeep is a safe number
        const safeDaysToKeep = parseInt(daysToKeep, 10);
        if (isNaN(safeDaysToKeep) || safeDaysToKeep < 0) {
            throw new Error('daysToKeep must be a positive number');
        }

        const query = `
            DELETE FROM sync_logs
            WHERE sync_started_at < NOW() - INTERVAL '1 day' * $1
            RETURNING *;`;

        const values = [safeDaysToKeep];
        const { rows } = await pool.query(query, values);

        return rows.length;
    }

    /**
     * Get sync logs by status
     * @param {string} status - 'success', 'failed', or 'in_progress'
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async findByStatus(status, limit = 10) {
        const query = `
            SELECT * FROM sync_logs
            WHERE status = $1
            ORDER BY sync_started_at DESC
            LIMIT $2;`;
        
        const values = [status, limit];
        const { rows } = await pool.query(query, values);
        
        return rows;
    }
}