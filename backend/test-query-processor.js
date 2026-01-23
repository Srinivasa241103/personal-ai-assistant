import QueryProcessor from "./src/service/retrieval/queryProcessor.js";

const processor = new QueryProcessor();

async function testQueries() {
  const testCases = [
    "What emails did I get from Sarah about the project deadline last week?",
    "Show me my meetings today",
    "What music was I listening to in December?",
    "What did I discuss with John yesterday?",
    "Show me calendar events from last month",
    "What songs did I listen to last 7 days?",
    "Find emails about the budget",
    "What should I work on today?",
  ];

  console.log("=== Testing Query Processor ===\n");

  for (const query of testCases) {
    console.log(`Query: "${query}"`);
    const result = await processor.process(query);
    console.log("Result:", JSON.stringify(result, null, 2));
    console.log("---\n");
  }
}

testQueries().catch(console.error);
