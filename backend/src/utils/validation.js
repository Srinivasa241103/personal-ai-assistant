// src/utils/validation.js

/**
 * Validation utilities for data integrity
 */

/**
 * Valid data sources
 */
export const VALID_SOURCES = ["gmail", "calendar", "spotify"];

/**
 * Valid document types
 */
export const VALID_TYPES = ["email", "event", "track"];

/**
 * Source to type mapping
 */
export const SOURCE_TYPE_MAP = {
  gmail: ["email"],
  calendar: ["event"],
  spotify: ["track"],
};

/**
 * Validate that a document has all required fields
 * @param {Object} document - Document to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateDocument(document) {
  const errors = [];

  // Check required fields
  if (!document.document_id) {
    errors.push("Missing required field: document_id");
  }

  if (!document.source) {
    errors.push("Missing required field: source");
  } else if (!VALID_SOURCES.includes(document.source)) {
    errors.push(
      `Invalid source: ${document.source}. Must be one of: ${VALID_SOURCES.join(
        ", "
      )}`
    );
  }

  if (!document.type) {
    errors.push("Missing required field: type");
  } else if (!VALID_TYPES.includes(document.type)) {
    errors.push(
      `Invalid type: ${document.type}. Must be one of: ${VALID_TYPES.join(
        ", "
      )}`
    );
  }

  // Validate source-type compatibility
  if (document.source && document.type) {
    const allowedTypes = SOURCE_TYPE_MAP[document.source];
    if (allowedTypes && !allowedTypes.includes(document.type)) {
      errors.push(
        `Type '${document.type}' is not valid for source '${document.source}'`
      );
    }
  }

  if (!document.content) {
    errors.push("Missing required field: content");
  }

  if (!document.timestamp) {
    errors.push("Missing required field: timestamp");
  } else if (
    !(document.timestamp instanceof Date) &&
    isNaN(Date.parse(document.timestamp))
  ) {
    errors.push("Invalid timestamp format");
  }

  // Validate metadata is an object
  if (document.metadata && typeof document.metadata !== "object") {
    errors.push("Metadata must be an object");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate Gmail-specific metadata
 */
export function validateGmailMetadata(metadata) {
  const errors = [];

  if (!metadata.from) {
    errors.push("Gmail metadata missing: from");
  }

  if (!metadata.message_id) {
    errors.push("Gmail metadata missing: message_id");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate Calendar-specific metadata
 */
export function validateCalendarMetadata(metadata) {
  const errors = [];

  if (!metadata.event_id) {
    errors.push("Calendar metadata missing: event_id");
  }

  if (!metadata.start_time) {
    errors.push("Calendar metadata missing: start_time");
  }

  if (!metadata.end_time) {
    errors.push("Calendar metadata missing: end_time");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate Spotify-specific metadata
 */
export function validateSpotifyMetadata(metadata) {
  const errors = [];

  if (!metadata.track_id) {
    errors.push("Spotify metadata missing: track_id");
  }

  if (!metadata.artist) {
    errors.push("Spotify metadata missing: artist");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate email address format
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize string input (remove dangerous characters)
 */
export function sanitizeString(str) {
  if (typeof str !== "string") return str;

  // Remove null bytes and control characters
  return str.replace(/[\x00-\x1F\x7F]/g, "");
}

/**
 * Validate that a value is within expected range
 */
export function validateRange(value, min, max, fieldName) {
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return true;
}

/**
 * Check if a date is valid and not in the future
 */
export function validatePastDate(date, fieldName = "Date") {
  const parsedDate = new Date(date);

  if (isNaN(parsedDate.getTime())) {
    throw new Error(`${fieldName} is not a valid date`);
  }

  if (parsedDate > new Date()) {
    throw new Error(`${fieldName} cannot be in the future`);
  }

  return true;
}
