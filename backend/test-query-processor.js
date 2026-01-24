import retrievalService from "./src/service/retrieval/retrievalService.js";
import { logger } from "./src/utils/logger.js";

async function testRetrievalPipeline() {
  try {
    console.log("=== Testing Complete Retrieval Pipeline ===\n");

    // Test 1: Simple query
    console.log("Test 1: Simple query");
    const result1 = await retrievalService.retrieve(
      "What mails I recieved from github for personal Ai assistant repository",
      { topN: 5 }
    );

    console.log(`Query: ${result1.query}`);
    console.log(`Intent: ${result1.processedQuery.intent}`);
    console.log(`Found: ${result1.metadata.totalFound} documents`);
    console.log(`Returned: ${result1.metadata.returned} results`);
    if (result1.results.length > 0) {
      console.log("\nTop result:");
      console.log(`  - Document: ${result1.results[0].documentId}`);
      console.log(`  - Similarity: ${result1.results[0].similarity}`);
      console.log(`  - Final Score: ${result1.results[0].finalScore}`);
      console.log(`  - Title: ${result1.results[0].title}`);
    } else {
      console.log("\nNo results found");
    }
    console.log("---\n");

    // Test 2: Time-filtered query
    console.log("Test 2: Time-filtered query");
    const result2 = await retrievalService.retrieve(
      "Show me emails from last week about meetings",
      { topN: 5 }
    );

    console.log(`Query: ${result2.query}`);
    console.log(
      `Time range: ${result2.processedQuery.timeRange?.label || "none"}`
    );
    console.log(`Found: ${result2.metadata.returned} results`);
    if (result2.results.length > 0) {
      console.log(`Top result title: ${result2.results[0].title}`);
    }
    console.log("---\n");

    // Test 3: With fallback (intentionally vague query)
    console.log("Test 3: Query with automatic fallback");
    const result3 = await retrievalService.retrieveWithFallback(
      "xyz123", // Unlikely to match anything
      { topN: 5 }
    );

    console.log(`Query: ${result3.query}`);
    console.log(`Found: ${result3.metadata.returned} results (after fallback)`);
    console.log("---\n");

    // Test 4: Explain ranking
    if (result1.results.length > 0) {
      console.log("Test 4: Explain ranking for top result");
      const explanation = retrievalService.explainRanking(
        result1,
        result1.results[0].documentId
      );
      console.log(JSON.stringify(explanation, null, 2));
      console.log("---\n");
    }

    console.log("✅ All retrieval pipeline tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testRetrievalPipeline();
