// schemas/index.js

/**
 * Unified Document structure - all data sources normalize to this format
 * @typedef {Object} UnifiedDocument
 * @property {string} document_id - Unique ID (e.g., "gmail_msg_12345")
 * @property {string} source - Data source: 'gmail', 'calendar', 'spotify'
 * @property {string} type - Document type: 'email', 'event', 'track'
 * @property {string} content - Main text content
 * @property {string} [title] - Subject/name/title (optional)
 * @property {Date} timestamp - When the original was created
 * @property {string} [author] - Creator/sender/artist (optional)
 * @property {Object} metadata - Source-specific data (JSONB)
 * @property {number[]} [embedding] - Vector embedding (1536 dimensions)
 */

/**
 * Sync result returned by connectors
 * @typedef {Object} SyncResult
 * @property {boolean} success - Whether sync succeeded
 * @property {number} documentsFetched - How many documents retrieved
 * @property {number} documentsStored - How many saved to DB
 * @property {Date} lastSyncTimestamp - Latest document timestamp
 * @property {string} [error] - Error message if failed
 */

/**
 * Search filters for querying documents
 * @typedef {Object} SearchFilters
 * @property {string[]} [sources] - Filter by sources
 * @property {Date} [startDate] - Start of date range
 * @property {Date} [endDate] - End of date range
 * @property {string} [author] - Filter by author
 * @property {number} [limit] - Max results
 */

/**
 * Helper to create a UnifiedDocument
 * @param {Object} params
 * @returns {UnifiedDocument}
 */
function createUnifiedDocument({
    document_id,
    source,
    type,
    content,
    title = null,
    timestamp,
    author = null,
    metadata = {}
  }) {
    // Validation
    if (!document_id || !source || !type || !content || !timestamp) {
      throw new Error('Missing required fields for UnifiedDocument');
    }
  
    if (!['gmail', 'calendar', 'spotify'].includes(source)) {
      throw new Error(`Invalid source: ${source}`);
    }
  
    if (!['email', 'event', 'track'].includes(type)) {
      throw new Error(`Invalid type: ${type}`);
    }
  
    return {
      document_id,
      source,
      type,
      content,
      title,
      timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
      author,
      metadata
    };
  }
  
  export {
    createUnifiedDocument
  };