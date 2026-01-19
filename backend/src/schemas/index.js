// src/schemas/index.js

/**
 * Data schemas and factory functions for creating structured documents
 */

import {
  validateDocument,
  validateGmailMetadata,
  validateCalendarMetadata,
  validateSpotifyMetadata,
} from "../utils/validation.js";

/**
 * Create a properly formatted UnifiedDocument
 *
 * @param {Object} params - Document parameters
 * @param {string} params.document_id - Unique identifier (e.g., "gmail_msg_123")
 * @param {string} params.source - Data source ("gmail" | "calendar" | "spotify")
 * @param {string} params.type - Document type ("email" | "event" | "track")
 * @param {string} params.content - Full text content
 * @param {string} params.title - Title/subject/name
 * @param {Date|string} params.timestamp - When this was created
 * @param {string} params.author - Who created it
 * @param {Object} params.metadata - Source-specific metadata
 * @returns {Object} UnifiedDocument
 */
export function createUnifiedDocument({
  document_id,
  source,
  type,
  content,
  title = null,
  timestamp,
  author = null,
  metadata = {},
}) {
  const document = {
    document_id,
    source,
    type,
    content,
    title,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    author,
    metadata,
    indexed: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Validate the document
  const validation = validateDocument(document);
  if (!validation.valid) {
    throw new Error(`Invalid document: ${validation.errors.join(", ")}`);
  }

  return document;
}

/**
 * Create Gmail-specific metadata structure
 */
export function createGmailMetadata({
  message_id,
  thread_id,
  from,
  to = [],
  cc = [],
  bcc = [],
  subject,
  labels = [],
  snippet,
  has_attachments = false,
  attachments = [],
}) {
  const metadata = {
    gmail: {
      message_id,
      thread_id,
      from,
      to,
      cc,
      bcc,
      subject,
      labels,
      snippet,
      has_attachments,
      attachments,
    },
  };

  // Validate Gmail metadata
  const validation = validateGmailMetadata(metadata.gmail);
  if (!validation.valid) {
    throw new Error(`Invalid Gmail metadata: ${validation.errors.join(", ")}`);
  }

  return metadata;
}

/**
 * Create Calendar-specific metadata structure
 */
export function createCalendarMetadata({
  event_id,
  calendar_id,
  summary,
  description = "",
  location = "",
  start_time,
  end_time,
  attendees = [],
  organizer = null,
  recurrence = null,
  is_all_day = false,
}) {
  const metadata = {
    calendar: {
      event_id,
      calendar_id,
      summary,
      description,
      location,
      start_time:
        start_time instanceof Date ? start_time : new Date(start_time),
      end_time: end_time instanceof Date ? end_time : new Date(end_time),
      attendees,
      organizer,
      recurrence,
      is_all_day,
    },
  };

  // Validate Calendar metadata
  const validation = validateCalendarMetadata(metadata.calendar);
  if (!validation.valid) {
    throw new Error(
      `Invalid Calendar metadata: ${validation.errors.join(", ")}`
    );
  }

  return metadata;
}

/**
 * Create Spotify-specific metadata structure
 */
export function createSpotifyMetadata({
  track_id,
  track_name,
  artist,
  album,
  duration_ms,
  played_at,
  audio_features = null,
}) {
  const metadata = {
    spotify: {
      track_id,
      track_name,
      artist,
      album,
      duration_ms,
      played_at: played_at instanceof Date ? played_at : new Date(played_at),
      audio_features: audio_features || {
        danceability: null,
        energy: null,
        valence: null,
        tempo: null,
      },
    },
  };

  // Validate Spotify metadata
  const validation = validateSpotifyMetadata(metadata.spotify);
  if (!validation.valid) {
    throw new Error(
      `Invalid Spotify metadata: ${validation.errors.join(", ")}`
    );
  }

  return metadata;
}

/**
 * Example: Creating a Gmail document
 *
 * const gmailMetadata = createGmailMetadata({
 *     message_id: 'msg_123',
 *     thread_id: 'thread_456',
 *     from: 'friend@example.com',
 *     to: ['me@example.com'],
 *     subject: 'Meeting Tomorrow',
 *     labels: ['INBOX'],
 *     snippet: 'Hey, let's meet...'
 * });
 *
 * const document = createUnifiedDocument({
 *     document_id: 'gmail_msg_123',
 *     source: 'gmail',
 *     type: 'email',
 *     content: 'Full email body...',
 *     title: 'Meeting Tomorrow',
 *     timestamp: new Date(),
 *     author: 'friend@example.com',
 *     metadata: gmailMetadata
 * });
 */
