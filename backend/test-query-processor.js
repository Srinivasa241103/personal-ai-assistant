// backend/test/test-components.js

import { logger } from "./src/utils/logger.js";
import QueryProcessor from "./src/service/retrieval/queryProcessor.js";
import vectorSearch from "./src/service/retrieval/vectorSearch.js";
import resultRanker from "./src/service/retrieval/resultRanker.js";
import contextFormatter from "./src/service/retrieval/contextFormatter.js";
import geminiService from "./src/service/llm/geminiService.js";
import { pool } from "./src/config/dbConfig.js";

async function testComponents() {
  console.log("=== Testing Individual Components ===\n");

  try {
    // Test 1: Database Connection
    console.log("Test 1: Database Connection");
    const dbTest = await pool.query("SELECT NOW()");
    console.log("✅ Database connected:", dbTest.rows[0].now);
    console.log("---\n");

    // Test 2: Check if we have documents with embeddings
    console.log("Test 2: Check Documents with Embeddings");
    const docsCheck = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(embedding) as with_embeddings,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) * 100.0 / COUNT(*) as percentage
      FROM documents
    `);
    console.log("Total documents:", docsCheck.rows[0].total);
    console.log("With embeddings:", docsCheck.rows[0].with_embeddings);
    console.log(
      "Percentage:",
      parseFloat(docsCheck.rows[0].percentage).toFixed(2) + "%"
    );

    if (docsCheck.rows[0].with_embeddings === "0") {
      console.log("⚠️  WARNING: No documents have embeddings yet!");
      console.log("   You need to run embedding generation first.");
      console.log("   Check your embedding pipeline or sync some data.\n");
    }
    console.log("---\n");

    // Test 3: Query Processor
    console.log("Test 3: Query Processor");
    const queryProcessor = new QueryProcessor();
    const testQuery =
      "What was there in the mail that I recieved from ravi kumar last week";
    const processed = await queryProcessor.process(testQuery);

    console.log("Query:", testQuery);
    console.log("Intent:", processed.intent);
    console.log("Source:", processed.source);
    console.log("Keywords:", processed.keywords.join(", "));
    console.log("Time Range:", processed.timeRange?.label || "None");
    console.log("Filters:", JSON.stringify(processed.filters, null, 2));
    console.log("✅ Query processor working");
    console.log("---\n");

    // Test 4: Gemini Embedding (Query)
    console.log("Test 4: Gemini Query Embedding");
    const embedding = await vectorSearch.embedQuery("test query");
    console.log("Embedding dimensions:", embedding.length);
    console.log(
      "First 5 values:",
      embedding.slice(0, 5).map((v) => v.toFixed(4))
    );
    console.log("✅ Gemini embedding working");
    console.log("---\n");

    // Test 5: Vector Search (if we have embeddings)
    if (docsCheck.rows[0].with_embeddings > 0) {
      console.log("Test 5: Vector Search");
      const searchResults = await vectorSearch.search("meeting", {
        topK: 3,
        minSimilarity: 0.3,
      });

      console.log('Search query: "meeting"');
      console.log("Results found:", searchResults.length);

      if (searchResults.length > 0) {
        console.log("\nTop result:");
        console.log("  Document ID:", searchResults[0].documentId);
        console.log("  Similarity:", searchResults[0].similarity.toFixed(4));
        console.log("  Source:", searchResults[0].source);
        console.log(
          "  Title:",
          searchResults[0].title?.substring(0, 50) || "N/A"
        );
        console.log("✅ Vector search working");
      } else {
        console.log("⚠️  No results found (try lowering minSimilarity)");
      }
      console.log("---\n");

      // Test 6: Result Ranker
      if (searchResults.length > 0) {
        console.log("Test 6: Result Ranker");
        const ranked = resultRanker.rank(searchResults, "meeting");

        console.log(
          "Original top similarity:",
          searchResults[0].similarity.toFixed(4)
        );
        console.log(
          "After ranking - final score:",
          ranked[0].finalScore.toFixed(4)
        );
        console.log("Score breakdown:");
        console.log("  Vector:", ranked[0].scores.vector.toFixed(4));
        console.log("  Recency:", ranked[0].scores.recency.toFixed(4));
        console.log("  Keyword:", ranked[0].scores.keyword.toFixed(4));
        console.log("  Source:", ranked[0].scores.source.toFixed(4));
        console.log("  Length:", ranked[0].scores.length.toFixed(4));
        console.log("✅ Result ranker working");
        console.log("---\n");

        // Test 7: Context Formatter
        console.log("Test 7: Context Formatter");
        const formatted = contextFormatter.format(
          ranked.slice(0, 3),
          "test query"
        );

        console.log("Documents formatted:", formatted.documents.length);
        console.log("Context tokens:", formatted.metadata.contextTokens);
        console.log("Total tokens:", formatted.metadata.totalTokens);
        console.log(
          "Within limit:",
          formatted.metadata.withinLimit ? "✅" : "❌"
        );
        console.log("Context preview (first 200 chars):");
        console.log(formatted.contextString.substring(0, 200) + "...");
        console.log("✅ Context formatter working");
        console.log("---\n");
      }
    }

    // Test 8: Gemini LLM
    console.log("Test 8: Gemini LLM Response Generation");
    const llmResponse = await geminiService.generateResponse(
      "Say 'Hello, I am working!' in a friendly way."
    );

    console.log("Response:", llmResponse.text);
    console.log("Tokens used:", llmResponse.tokens.total);
    console.log("Duration:", llmResponse.duration + "ms");
    console.log("Model:", llmResponse.model);
    console.log("✅ Gemini LLM working");
    console.log("---\n");

    // Test 9: Health Check
    console.log("Test 9: Gemini Health Check");
    const health = await geminiService.healthCheck();
    console.log("Status:", health.status);
    console.log("Response time:", health.responseTime + "ms");
    console.log("✅ Health check passed");
    console.log("---\n");

    console.log("🎉 All component tests passed!\n");
  } catch (error) {
    console.error("❌ Component test failed:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

testComponents();
