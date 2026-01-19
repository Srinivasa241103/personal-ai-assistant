// test/test-setup.js

import { logger } from "../src/utils/logger.js";
import {
  validateDocument,
  validateGmailMetadata,
} from "../src/utils/validation.js";
import {
  createUnifiedDocument,
  createGmailMetadata,
} from "../src/schemas/index.js";
import { config } from "../src/config/environment.js";

console.log("=== Testing Core Setup ===\n");

// Test 1: Logger
console.log("Test 1: Logger");
logger.info("Testing info log");
logger.warn("Testing warning log");
logger.error("Testing error log", new Error("Sample error"));
logger.debug("Testing debug log");
console.log("✅ Logger working\n");

// Test 2: Configuration
console.log("Test 2: Configuration");
console.log("Server config:", config.server);
console.log("Database config:", config.database.host, config.database.name);
console.log("✅ Configuration loaded\n");

// Test 3: Schema creation
console.log("Test 3: Schema Creation");
try {
  const gmailMetadata = createGmailMetadata({
    message_id: "test_msg_123",
    thread_id: "test_thread_456",
    from: "test@example.com",
    to: ["recipient@example.com"],
    subject: "Test Email",
    labels: ["INBOX"],
    snippet: "This is a test email",
  });

  const document = createUnifiedDocument({
    document_id: "gmail_test_123",
    source: "gmail",
    type: "email",
    content: "Full test email content",
    title: "Test Email",
    timestamp: new Date(),
    author: "test@example.com",
    metadata: gmailMetadata,
  });

  console.log("Created document:", document);
  console.log("✅ Schema creation working\n");
} catch (error) {
  console.error("❌ Schema creation failed:", error.message);
}

// Test 4: Validation
console.log("Test 4: Validation");
const validDoc = {
  document_id: "test_123",
  source: "gmail",
  type: "email",
  content: "Test content",
  timestamp: new Date(),
};

const invalidDoc = {
  document_id: "test_456",
  source: "invalid_source", // Invalid!
  type: "email",
  // Missing content and timestamp
};

const validResult = validateDocument(validDoc);
const invalidResult = validateDocument(invalidDoc);

console.log("Valid document result:", validResult);
console.log("Invalid document result:", invalidResult);
console.log("✅ Validation working\n");

console.log("=== All Tests Complete ===");
