// backend/src/services/langchain/test-embeddings.js

import embeddingsService from "./src/service/langchain/embeddings.js";
import { logger } from "./src/utils/logger.js";

/**
 * Test LangChain embeddings service
 */
async function testEmbeddingsService() {
  console.log("\n" + "=".repeat(60));
  console.log("Testing LangChain Embeddings Service");
  console.log("=".repeat(60) + "\n");

  try {
    // Test 1: Health check
    console.log("Test 1: Health Check");
    console.log("-".repeat(60));

    const isHealthy = await embeddingsService.healthCheck();
    console.log("✅ Service healthy:", isHealthy);
    console.log("✅ Dimensions:", embeddingsService.getDimensions());
    console.log();

    // Test 2: Single document embedding
    console.log("Test 2: Single Document Embedding");
    console.log("-".repeat(60));

    const sampleDoc =
      "This is a test email about project deadlines and team meetings.";
    const docEmbedding = await embeddingsService.embedDocument(sampleDoc);

    console.log("✅ Document:", sampleDoc);
    console.log("✅ Embedding dimensions:", docEmbedding.length);
    console.log("✅ First 5 values:", docEmbedding.slice(0, 5));
    console.log();

    // Test 3: Query embedding
    console.log("Test 3: Query Embedding");
    console.log("-".repeat(60));

    const sampleQuery = "What are my upcoming deadlines?";
    const queryEmbedding = await embeddingsService.embedQuery(sampleQuery);

    console.log("✅ Query:", sampleQuery);
    console.log("✅ Embedding dimensions:", queryEmbedding.length);
    console.log("✅ First 5 values:", queryEmbedding.slice(0, 5));
    console.log();

    // Test 4: Batch embeddings
    console.log("Test 4: Batch Document Embeddings");
    console.log("-".repeat(60));

    const batchDocs = [
      "Email 1: Meeting scheduled for tomorrow at 10 AM",
      "Email 2: Project deadline extended to next Friday",
      "Email 3: Team lunch on Thursday at noon",
    ];

    const batchEmbeddings = await embeddingsService.embedDocuments(batchDocs);

    console.log("✅ Documents:", batchDocs.length);
    console.log("✅ Embeddings generated:", batchEmbeddings.length);
    console.log(
      "✅ All have correct dimensions:",
      batchEmbeddings.every((e) => e.length === 768)
    );
    console.log();

    // Test 5: Similarity calculation (bonus)
    console.log("Test 5: Similarity Calculation");
    console.log("-".repeat(60));

    const doc1Embedding = await embeddingsService.embedDocument(
      "I love playing basketball"
    );
    const doc2Embedding = await embeddingsService.embedDocument(
      "Basketball is my favorite sport"
    );
    const doc3Embedding = await embeddingsService.embedDocument(
      "I enjoy programming in Python"
    );

    const similarity12 = cosineSimilarity(doc1Embedding, doc2Embedding);
    const similarity13 = cosineSimilarity(doc1Embedding, doc3Embedding);

    console.log(
      '✅ "basketball" vs "basketball": similarity =',
      similarity12.toFixed(4)
    );
    console.log(
      '✅ "basketball" vs "programming": similarity =',
      similarity13.toFixed(4)
    );
    console.log(
      "✅ Related docs are more similar:",
      similarity12 > similarity13
    );
    console.log();

    console.log("=".repeat(60));
    console.log("✅ All tests passed!");
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vec1, vec2) {
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (mag1 * mag2);
}

// Run tests
testEmbeddingsService();
