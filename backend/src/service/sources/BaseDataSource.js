// src/services/base/BaseDataSource.js

import { logger } from "../../utils/logger.js";

/**
 * Abstract base class for all data source connectors
 * All connectors (Gmail, Calendar, Spotify) must extend this class
 */
export default class BaseDataSource {
  constructor(sourceName) {
    if (new.target === BaseDataSource) {
      throw new Error(
        "BaseDataSource is abstract and cannot be instantiated directly"
      );
    }
    this.sourceName = sourceName;
    this.isConnected = false;
    this.lastSyncTime = null;
  }

  /**
   * Get the name of this data source
   * @returns {string}
   */
  getName() {
    return this.sourceName;
  }

  /**
   * Authenticate with the data source
   * Must be implemented by subclasses
   * @param {Object} credentials - Authentication credentials
   * @returns {Promise<void>}
   */
  async authenticate(credentials) {
    throw new Error("authenticate() must be implemented by subclass");
  }

  /**
   * Fetch new data since last sync
   * Must be implemented by subclasses
   * @param {Date} since - Fetch data since this date
   * @returns {Promise<Array>} Array of raw documents from API
   */
  async fetchNew(since) {
    throw new Error("fetchNew() must be implemented by subclass");
  }

  /**
   * Fetch all data (for initial sync)
   * Must be implemented by subclasses
   * @returns {Promise<Array>} Array of raw documents from API
   */
  async fetchAll() {
    throw new Error("fetchAll() must be implemented by subclass");
  }

  /**
   * Normalize raw API response to UnifiedDocument format
   * Must be implemented by subclasses
   * @param {Object} rawData - Raw response from API
   * @returns {Promise<Object>} UnifiedDocument
   */
  async normalize(rawData) {
    throw new Error("normalize() must be implemented by subclass");
  }

  /**
   * Normalize a batch of raw documents
   * @param {Array} rawDocuments - Array of raw API responses
   * @returns {Promise<Array>} Array of UnifiedDocuments
   */
  async normalizeBatch(rawDocuments) {
    const normalized = [];

    for (const raw of rawDocuments) {
      try {
        const doc = await this.normalize(raw);
        normalized.push(doc);
      } catch (error) {
        logger.error(
          `Failed to normalize document from ${this.sourceName}`,
          error,
          {
            rawDocument: raw,
          }
        );
        // Continue with other documents
      }
    }

    return normalized;
  }

  /**
   * Validate that connection is still valid
   * @returns {Promise<boolean>}
   */
  async validateConnection() {
    throw new Error("validateConnection() must be implemented by subclass");
  }

  /**
   * Main sync method - orchestrates the full sync process
   * This method can be called by all subclasses
   * @param {Date} since - Sync data since this date (null for full sync)
   * @returns {Promise<Object>} Sync result with statistics
   */
  async sync(since = null) {
    try {
      logger.syncStart(this.sourceName, { since });

      // Validate connection first
      const isValid = await this.validateConnection();
      if (!isValid) {
        throw new Error(`Connection validation failed for ${this.sourceName}`);
      }

      // Fetch data
      let rawDocuments;
      if (since) {
        rawDocuments = await this.fetchNew(since);
      } else {
        rawDocuments = await this.fetchAll();
      }

      logger.info(
        `Fetched ${rawDocuments.length} raw documents from ${this.sourceName}`
      );

      // Normalize data
      const normalizedDocuments = await this.normalizeBatch(rawDocuments);

      logger.syncComplete(this.sourceName, {
        fetched: rawDocuments.length,
        normalized: normalizedDocuments.length,
        failed: rawDocuments.length - normalizedDocuments.length,
      });

      this.lastSyncTime = new Date();

      return {
        success: true,
        source: this.sourceName,
        fetched: rawDocuments.length,
        normalized: normalizedDocuments.length,
        failed: rawDocuments.length - normalizedDocuments.length,
        documents: normalizedDocuments,
        syncTime: this.lastSyncTime,
      };
    } catch (error) {
      logger.syncFailed(this.sourceName, error);

      return {
        success: false,
        source: this.sourceName,
        error: error.message,
        syncTime: new Date(),
      };
    }
  }

  /**
   * Disconnect from the data source
   * Override if cleanup is needed
   */
  async disconnect() {
    this.isConnected = false;
    logger.info(`Disconnected from ${this.sourceName}`);
  }

  /**
   * Get the last sync time
   * @returns {Date|null}
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  /**
   * Set connection status
   * @param {boolean} status
   */
  setConnectionStatus(status) {
    this.isConnected = status;
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isSourceConnected() {
    return this.isConnected;
  }
}

/**
 * Example of how a connector will extend this:
 *
 * class GmailConnector extends BaseDataSource {
 *     constructor() {
 *         super('gmail');
 *     }
 *
 *     async authenticate(credentials) {
 *         // Implement Gmail OAuth
 *     }
 *
 *     async fetchNew(since) {
 *         // Fetch emails since date
 *     }
 *
 *     async normalize(rawEmail) {
 *         // Convert Gmail API response to UnifiedDocument
 *     }
 *
 *     async validateConnection() {
 *         // Check if OAuth tokens are still valid
 *     }
 * }
 */
