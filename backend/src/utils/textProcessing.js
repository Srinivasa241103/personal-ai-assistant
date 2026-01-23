import stopword from "stopword";
import natural from "natural";

const tokenizer = new natural.WordTokenizer();

export const removeStopWords = (text) => {
  const tokens = tokenizer.tokenize(text.toLowerCase());
  return stopword.removeStopwords(tokens);
};

export const extractKeywords = (text, maxKeywords = 10) => {
  const cleanWords = removeStopWords(text);

  // Filter out very short words and common query words
  const queryWords = ["what", "when", "where", "who", "how", "did", "does", "was", "were"];
  const filtered = cleanWords.filter(
    (word) => word.length >= 3 && !queryWords.includes(word)
  );

  const frequency = {};
  filtered.forEach((word) => {
    frequency[word] = (frequency[word] || 0) + 1;
  });

  const sorted = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);

  return sorted;
};

export const matchesAnyPattern = (text, patterns) => {
  if (!patterns || !Array.isArray(patterns)) {
    return false;
  }

  const lowerText = text.toLowerCase();
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return lowerText.includes(pattern.toLowerCase());
    }
    // If it's a RegExp
    if (pattern instanceof RegExp) {
      return pattern.test(lowerText);
    }
    return false;
  });
};

export const extractEntities = (text) => {
  // Match capitalized words (potential names/entities)
  // Also handle names at the start of sentences and after punctuation
  const words = text.split(/\s+/);
  const entities = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Clean word of punctuation for checking
    const cleanWord = word.replace(/[.,!?'"]/g, "");

    // Check if word starts with capital letter
    if (/^[A-Z][a-z]+/.test(cleanWord)) {
      // Skip common sentence starters and words
      const skipWords = [
        "I",
        "The",
        "A",
        "An",
        "This",
        "That",
        "What",
        "When",
        "Where",
        "Who",
        "How",
        "My",
        "Your",
        "Show",
        "Find",
        "Get",
        "Search",
      ];

      if (!skipWords.includes(cleanWord)) {
        entities.push(cleanWord);
      }
    }
  }

  return [...new Set(entities)];
};

export const normalizeText = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};
