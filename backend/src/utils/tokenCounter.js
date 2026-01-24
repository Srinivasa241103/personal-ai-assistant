/**
 * Estimate token count for text
 * @param {string} text - Input text
 * @returns {number} - Estimated token count
 */
export function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Check if text fits within token limit
 * @param {string} text - Input text
 * @param {number} maxTokens - Maximum allowed tokens
 * @returns {boolean}
 */
export function fitsWithinLimit(text, maxTokens = 2048) {
  const tokens = estimateTokens(text);
  return tokens <= maxTokens;
}

/**
 * Truncate text to fit token limit
 * @param {string} text - Input text
 * @param {number} maxTokens - Maximum tokens
 * @returns {string} - Truncated text
 */
export function truncateToTokenLimit(text, maxTokens = 2048) {
  if (fitsWithinLimit(text, maxTokens)) {
    return text;
  }

  const maxChars = maxTokens * 4; // Conservative estimate
  return text.substring(0, maxChars) + "...";
}

/**
 * Count total tokens in multiple texts
 * @param {string[]} texts - Array of texts
 * @returns {number} - Total token count
 */
export function countTotalTokens(texts) {
  return texts.reduce((total, text) => total + estimateTokens(text), 0);
}

/**
 * Fit multiple texts within token budget
 * @param {Array<{text: string, priority: number}>} items - Items with priority
 * @param {number} maxTokens - Maximum total tokens
 * @returns {string[]} - Texts that fit within budget
 */
export function fitWithinBudget(items, maxTokens = 30000) {
  // Sort by priority (higher first)
  const sorted = [...items].sort((a, b) => b.priority - a.priority);

  const result = [];
  let totalTokens = 0;

  for (const item of sorted) {
    const tokens = estimateTokens(item.text);
    if (totalTokens + tokens <= maxTokens) {
      result.push(item.text);
      totalTokens += tokens;
    }
  }

  return result;
}
