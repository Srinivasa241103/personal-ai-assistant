// backend/src/services/llm/promptTemplates.js

import { logger } from "../../utils/logger.js";

class PromptTemplates {
  constructor() {
    // System prompts for different use cases
    this.systemPrompts = {
      default: this.getDefaultSystemPrompt(),
      analytical: this.getAnalyticalSystemPrompt(),
      conversational: this.getConversationalSystemPrompt(),
    };
  }

  /**
   * Get default system prompt
   */
  getDefaultSystemPrompt() {
    return `You are a helpful personal AI assistant with access to the user's personal data including emails, calendar events, and music listening history.

Your role is to:
1. Answer questions based on the retrieved information from their personal data
2. Be specific and reference actual data when available
3. Cite your sources by referring to document numbers (e.g., "According to Document 1...")
4. If the information isn't in the retrieved data, say so clearly
5. Be concise but informative
6. Maintain the user's privacy - you're only discussing their own data with them

Important guidelines:
- Always prioritize information from the retrieved context over general knowledge
- If asked about something not in the context, clearly state that
- Use natural, conversational language
- When multiple documents contain relevant info, synthesize the information
- If documents contradict each other, mention the discrepancy`;
  }

  /**
   * Get analytical system prompt (for pattern analysis)
   */
  getAnalyticalSystemPrompt() {
    return `You are an analytical AI assistant specializing in finding patterns and insights in personal data.

Your role is to:
1. Analyze the retrieved data for patterns, trends, and insights
2. Provide data-driven observations
3. Use specific examples from the documents
4. Quantify findings when possible (e.g., "In 5 out of 7 documents...")
5. Present findings in a structured, clear manner

Focus on:
- Temporal patterns (time-based trends)
- Frequency analysis (how often things occur)
- Relationships between different data points
- Notable anomalies or outliers`;
  }

  /**
   * Get conversational system prompt
   */
  getConversationalSystemPrompt() {
    return `You are a friendly personal AI assistant who knows the user's personal data well.

Your role is to:
1. Have natural conversations about their life based on their data
2. Be warm and personable while being helpful
3. Reference specific memories and events from their data
4. Help them remember things and make connections
5. Offer relevant suggestions when appropriate

Tone:
- Friendly and approachable
- Respectful of privacy
- Supportive and helpful
- Natural and conversational`;
  }

  /**
   * Build complete prompt for LLM
   * @param {string} systemPrompt - System prompt to use
   * @param {string} contextString - Formatted context from documents
   * @param {string} userQuery - User's question
   * @param {Object} options - Additional options
   * @returns {string} - Complete formatted prompt
   */
  buildPrompt(systemPrompt, contextString, userQuery, options = {}) {
    try {
      let prompt = "";

      // Add system prompt
      prompt += `${systemPrompt}\n\n`;

      // Add context
      prompt += `RETRIEVED CONTEXT:\n`;
      prompt += `${contextString}\n\n`;

      // Add instructions for using context
      prompt += `INSTRUCTIONS:\n`;
      prompt += `- Base your answer primarily on the retrieved context above\n`;
      prompt += `- Cite documents by number when referencing them (e.g., "Document 2 mentions...")\n`;
      prompt += `- If the context doesn't contain enough information, say so\n`;
      prompt += `- Be specific and use details from the documents\n\n`;

      // Add user query
      prompt += `USER QUESTION:\n`;
      prompt += `${userQuery}\n\n`;

      // Add response format instructions if provided
      if (options.responseFormat) {
        prompt += `RESPONSE FORMAT:\n`;
        prompt += `${options.responseFormat}\n\n`;
      }

      return prompt;
    } catch (error) {
      logger.error("Error building prompt", { error: error.message });
      throw error;
    }
  }

  /**
   * Build prompt for when no context is available
   */
  buildNoContextPrompt(systemPrompt, userQuery) {
    return (
      `${systemPrompt}\n\n` +
      `No relevant information was found in the user's personal data for this query.\n\n` +
      `USER QUESTION:\n${userQuery}\n\n` +
      `Please let the user know that you couldn't find relevant information in their data, ` +
      `and offer to help in another way if possible.`
    );
  }

  /**
   * Get system prompt by type
   */
  getSystemPrompt(type = "default") {
    return this.systemPrompts[type] || this.systemPrompts.default;
  }

  /**
   * Build prompt for specific query types
   */
  buildQueryTypePrompt(queryType, contextString, userQuery) {
    let systemPrompt;

    switch (queryType) {
      case "pattern":
        systemPrompt = this.getSystemPrompt("analytical");
        break;
      case "recommendation":
        systemPrompt = this.getSystemPrompt("conversational");
        break;
      default:
        systemPrompt = this.getSystemPrompt("default");
    }

    return this.buildPrompt(systemPrompt, contextString, userQuery);
  }
}

export default new PromptTemplates();
