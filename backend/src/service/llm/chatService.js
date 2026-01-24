// backend/src/services/llm/chatService.js

import ragPipeline from "../retrieval/ragPipeline.js";
import geminiService from "./geminiService.js";
import conversationMemory from "./conversationMemory.js";
import { logger } from "../../utils/logger.js";

class ChatService {
  /**
   * Complete chat flow: RAG retrieval + LLM generation
   * @param {string} userQuery - User's question
   * @param {string} conversationId - Conversation ID for history
   * @param {Object} options - Chat options
   * @returns {Promise<Object>} - Complete response
   */
  async chat(userQuery, conversationId = null, options = {}) {
    try {
      logger.info("Starting chat", {
        query: userQuery,
        conversationId,
      });

      const startTime = Date.now();

      // Step 1: RAG Pipeline - Retrieve and format context
      const ragResult = await ragPipeline.process(userQuery, {
        topN: options.topN || 10,
        minSimilarity: options.minSimilarity || 0.5,
        promptType: options.promptType || "default",
      });

      logger.info("RAG pipeline completed", {
        documentsRetrieved: ragResult.context.metadata.selectedDocuments,
      });

      // Step 2: Generate response with Gemini
      let response;

      if (conversationId && options.useHistory !== false) {
        // Use conversation history
        const messages = await conversationMemory.formatForGemini(
          conversationId,
          ragResult.prompt
        );
        response = await geminiService.chat(messages);
      } else {
        // Single-turn response
        response = await geminiService.generateResponse(ragResult.prompt);
      }

      logger.info("Response generated", {
        responseLength: response.text.length,
      });

      // Step 3: Save conversation if ID provided
      if (conversationId) {
        await conversationMemory.saveConversation(
          conversationId,
          userQuery,
          response.text,
          {
            documentsUsed: ragResult.context.metadata.selectedDocuments,
            retrievalIntent: ragResult.processedQuery.intent,
            tokens: response.tokens,
          }
        );
      }

      const totalDuration = Date.now() - startTime;

      // Step 4: Return complete response
      return {
        success: true,
        conversationId:
          conversationId || conversationMemory.createConversationId(),
        query: userQuery,
        response: response.text,
        context: {
          documentsUsed: ragResult.citations,
          totalDocuments: ragResult.context.metadata.totalDocuments,
          selectedDocuments: ragResult.context.metadata.selectedDocuments,
        },
        metadata: {
          intent: ragResult.processedQuery.intent,
          filters: ragResult.processedQuery.filters,
          tokens: response.tokens,
          duration: totalDuration,
          model: response.model,
        },
      };
    } catch (error) {
      logger.error("Chat failed", {
        error: error.message,
        query: userQuery,
      });

      return {
        success: false,
        error: error.message,
        query: userQuery,
      };
    }
  }

  /**
   * Chat with streaming response
   */
  async *chatStream(userQuery, conversationId = null, options = {}) {
    try {
      logger.info("Starting streaming chat", {
        query: userQuery,
      });

      // Step 1: RAG Pipeline
      const ragResult = await ragPipeline.process(userQuery, {
        topN: options.topN || 10,
        minSimilarity: options.minSimilarity || 0.5,
        promptType: options.promptType || "default",
      });

      // Yield context info first
      yield {
        type: "context",
        data: {
          documentsUsed: ragResult.citations,
          totalDocuments: ragResult.context.metadata.totalDocuments,
        },
      };

      // Step 2: Stream response
      let fullResponse = "";

      for await (const chunk of geminiService.generateStreamingResponse(
        ragResult.prompt
      )) {
        if (!chunk.done) {
          fullResponse += chunk.text;
          yield {
            type: "text",
            data: chunk.text,
          };
        } else {
          // Final chunk
          yield {
            type: "done",
            data: {
              totalTokens: chunk.tokens,
              fullResponse,
            },
          };

          // Save conversation
          if (conversationId) {
            await conversationMemory.saveConversation(
              conversationId,
              userQuery,
              fullResponse,
              {
                documentsUsed: ragResult.context.metadata.selectedDocuments,
                retrievalIntent: ragResult.processedQuery.intent,
              }
            );
          }
        }
      }
    } catch (error) {
      logger.error("Streaming chat failed", { error: error.message });
      yield {
        type: "error",
        data: { error: error.message },
      };
    }
  }

  /**
   * Get conversation history
   */
  async getHistory(conversationId, limit = 10) {
    return await conversationMemory.getConversationHistory(
      conversationId,
      limit
    );
  }

  /**
   * Create new conversation
   */
  createConversation() {
    return {
      conversationId: conversationMemory.createConversationId(),
      createdAt: new Date().toISOString(),
    };
  }
}

export default new ChatService();
