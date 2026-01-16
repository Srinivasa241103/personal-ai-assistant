// services/database/CredentialRepository.js
import { pool } from '../config/dbConfig.js';

export class CredentialRepository {
    /**
     * Create or update credentials for a source
     * @param {Object} credential
     * @returns {Promise<Object>}
     */
    async upsert(credential) {
        const query = `
            INSERT INTO api_credentials
            (source, user_id, access_token, refresh_token, token_expires_at, scope)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (source)
            DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                scope = EXCLUDED.scope,
                updated_at = NOW()
            RETURNING *;`;
        
        const values = [
            credential.source,
            credential.user_id || 'default_user',
            credential.access_token,
            credential.refresh_token,
            credential.token_expires_at,
            credential.scope || null
        ];
        
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            throw new Error('Failed to save credentials');
        }
        
        return rows[0];
    }

    /**
     * Find credentials by source
     * @param {string} source
     * @returns {Promise<Object|null>}
     */
    async findBySource(source) {
        const query = `
            SELECT * FROM api_credentials
            WHERE source = $1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Update access token (when refreshed)
     * @param {string} source
     * @param {string} accessToken
     * @param {Date} expiresAt
     * @returns {Promise<Object>}
     */
    async updateAccessToken(source, accessToken, expiresAt) {
        const query = `
            UPDATE api_credentials
            SET 
                access_token = $1,
                token_expires_at = $2,
                updated_at = NOW()
            WHERE source = $3
            RETURNING *;`;
        
        const values = [accessToken, expiresAt, source];
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            throw new Error(`Credentials for ${source} not found`);
        }
        
        return rows[0];
    }

    /**
     * Check if token is expired or about to expire
     * @param {string} source
     * @param {number} bufferMinutes - Consider expired if expires within N minutes
     * @returns {Promise<boolean>}
     */
    async isTokenExpired(source, bufferMinutes = 5) {
        const query = `
            SELECT 
                CASE 
                    WHEN token_expires_at IS NULL THEN false
                    WHEN token_expires_at <= NOW() + INTERVAL '${bufferMinutes} minutes' THEN true
                    ELSE false
                END as is_expired
            FROM api_credentials
            WHERE source = $1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            return true; // No credentials = consider expired
        }
        
        return rows[0].is_expired;
    }

    /**
     * Get all connected sources
     * @returns {Promise<Array>}
     */
    async getAllSources() {
        const query = `
            SELECT source, created_at, updated_at, token_expires_at
            FROM api_credentials
            ORDER BY source;`;
        
        const { rows } = await pool.query(query);
        
        return rows;
    }

    /**
     * Delete credentials for a source (disconnect)
     * @param {string} source
     * @returns {Promise<boolean>}
     */
    async delete(source) {
        const query = `
            DELETE FROM api_credentials
            WHERE source = $1
            RETURNING *;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0;
    }

    /**
     * Check if source is connected (has valid credentials)
     * @param {string} source
     * @returns {Promise<boolean>}
     */
    async isConnected(source) {
        const query = `
            SELECT 1 FROM api_credentials
            WHERE source = $1;`;
        
        const values = [source];
        const { rows } = await pool.query(query, values);
        
        return rows.length > 0;
    }

    /**
     * Get credentials that need refresh (expired or about to expire)
     * @param {number} bufferMinutes
     * @returns {Promise<Array>}
     */
    async findExpiredCredentials(bufferMinutes = 5) {
        const query = `
            SELECT * FROM api_credentials
            WHERE token_expires_at <= NOW() + INTERVAL '${bufferMinutes} minutes'
            OR token_expires_at IS NULL;`;
        
        const { rows } = await pool.query(query);
        
        return rows;
    }

    /**
     * Update refresh token
     * @param {string} source
     * @param {string} refreshToken
     * @returns {Promise<Object>}
     */
    async updateRefreshToken(source, refreshToken) {
        const query = `
            UPDATE api_credentials
            SET 
                refresh_token = $1,
                updated_at = NOW()
            WHERE source = $2
            RETURNING *;`;
        
        const values = [refreshToken, source];
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
            throw new Error(`Credentials for ${source} not found`);
        }
        
        return rows[0];
    }
}