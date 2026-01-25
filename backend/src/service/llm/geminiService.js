// backend/src/services/llm/geminiService.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { estimateTokens } from "../../utils/tokenCounter.js";

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Try models in order: env var > gemini-1.5-flash > gemini-2.0-flash
    // Note: Model availability depends on API key permissions
    this.modelName = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";

    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
        topK: parseInt(process.env.GEMINI_TOP_K || "40"),
        topP: parseFloat(process.env.GEMINI_TOP_P || "0.95"),
        maxOutputTokens: parseInt(
          process.env.GEMINI_MAX_OUTPUT_TOKENS || "2048"
        ),
      },
    });
  }

  /**
   * Generate a response using Gemini Pro
   * @param {string} prompt - Complete prompt with context
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} - Generated response
   */
  async generateResponse(prompt, options = {}) {
    try {
      logger.info("Generating response with Gemini", {
        promptLength: prompt.length,
        promptTokens: estimateTokens(prompt),
      });

      const startTime = Date.now();

      // Generate content
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const duration = Date.now() - startTime;

      logger.info("Response generated", {
        duration: `${duration}ms`,
        responseLength: text.length,
        responseTokens: estimateTokens(text),
      });

      return {
        text,
        tokens: {
          prompt: estimateTokens(prompt),
          response: estimateTokens(text),
          total: estimateTokens(prompt) + estimateTokens(text),
        },
        duration,
        model: this.modelName,
      };
    } catch (error) {
      logger.error("Error generating response", {
        error: error.message,
        promptPreview: prompt.substring(0, 200),
      });
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  /**
   * Generate streaming response
   * @param {string} prompt - Complete prompt with context
   * @returns {AsyncGenerator} - Streaming response
   */
  async *generateStreamingResponse(prompt) {
    try {
      logger.info("Generating streaming response", {
        promptLength: prompt.length,
      });

      const result = await this.model.generateContentStream(prompt);

      let totalText = "";

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        totalText += chunkText;

        yield {
          text: chunkText,
          done: false,
        };
      }

      logger.info("Streaming response completed", {
        totalLength: totalText.length,
        totalTokens: estimateTokens(totalText),
      });

      yield {
        text: "",
        done: true,
        totalText,
        tokens: estimateTokens(totalText),
      };
    } catch (error) {
      logger.error("Error in streaming response", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generate response with conversation history
   * @param {Array} messages - Array of {role, content} messages
   * @returns {Promise<Object>} - Generated response
   */
  async chat(messages) {
    try {
      logger.info("Chat with history", {
        messageCount: messages.length,
      });

      // Start a chat session
      const chat = this.model.startChat({
        history: messages.slice(0, -1).map((msg) => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        })),
        generationConfig: {
          temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
          maxOutputTokens: parseInt(
            process.env.GEMINI_MAX_OUTPUT_TOKENS || "2048"
          ),
        },
      });

      // Get the last user message
      const lastMessage = messages[messages.length - 1];

      const result = await chat.sendMessage(lastMessage.content);
      const response = await result.response;
      const text = response.text();

      return {
        text,
        tokens: {
          response: estimateTokens(text),
        },
        model: this.modelName,
      };
    } catch (error) {
      logger.error("Error in chat", { error: error.message });
      throw error;
    }
  }

  /**
   * Health check for Gemini API
   */
  async healthCheck() {
    try {
      const response = await this.generateResponse(
        'Say "OK" if you can read this.'
      );
      return {
        status: "healthy",
        model: response.model,
        responseTime: response.duration,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
      };
    }
  }

  /**
   * Count tokens in text (estimation)
   */
  countTokens(text) {
    return estimateTokens(text);
  }
}

export default new GeminiService();
