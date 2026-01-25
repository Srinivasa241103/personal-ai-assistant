// backend/src/services/llm/chatService.js

import crypto from "crypto";
import ragPipeline from "../retrieval/ragPipeline.js";
import geminiService from "./geminiService.js";
import conversationMemory from "./conversationMemory.js";
import { logger } from "../../utils/logger.js";
import socketServer from "../websocket/sockeService.js";

class ChatService {
  /**
   * Generate a unique query ID for tracking
   */
  generateQueryId() {
    return `query_${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * Complete chat flow: RAG retrieval + LLM generation
   * @param {string} userQuery - User's question
   * @param {string} conversationId - Conversation ID for history
   * @param {Object} options - Chat options
   * @returns {Promise<Object>} - Complete response
   */
  async chat(userQuery, conversationId = null, options = {}) {
    const queryId = options.queryId || this.generateQueryId();

    try {
      logger.info("Starting chat", {
        query: userQuery,
        conversationId,
        queryId,
      });

      const startTime = Date.now();

      // Emit: Starting RAG pipeline
      socketServer.emitRAGProgress(queryId, {
        stage: "processing_query",
        message: "Understanding your question...",
        progress: 10,
      });

      // Step 1: RAG Pipeline - Retrieve and format context
      // We'll emit progress within the pipeline stages
      socketServer.emitRAGProgress(queryId, {
        stage: "creating_embedding",
        message: "Creating semantic embedding...",
        progress: 20,
      });

      const ragResult = await ragPipeline.process(userQuery, {
        topN: options.topN || 10,
        minSimilarity: options.minSimilarity || 0.5,
        promptType: options.promptType || "default",
      });

      // Emit: Searching complete
      socketServer.emitRAGProgress(queryId, {
        stage: "search_complete",
        message: `Found ${ragResult.context.metadata.totalDocuments} relevant documents`,
        progress: 50,
        documentsFound: ragResult.context.metadata.totalDocuments,
        documentsSelected: ragResult.context.metadata.selectedDocuments,
      });

      logger.info("RAG pipeline completed", {
        documentsRetrieved: ragResult.context.metadata.selectedDocuments,
      });

      // Emit: Formatting context
      socketServer.emitRAGProgress(queryId, {
        stage: "formatting_context",
        message: "Preparing context for response...",
        progress: 60,
      });

      // Emit: Generating response
      socketServer.emitRAGProgress(queryId, {
        stage: "generating_response",
        message: "Generating AI response...",
        progress: 70,
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

      // Emit: Finalizing
      socketServer.emitRAGProgress(queryId, {
        stage: "finalizing",
        message: "Finalizing response...",
        progress: 90,
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

      // Emit: Complete
      socketServer.emitRAGComplete(queryId, {
        stage: "complete",
        message: "Response ready",
        progress: 100,
        duration: totalDuration,
        documentsUsed: ragResult.context.metadata.selectedDocuments,
      });

      // Step 4: Return complete response
      return {
        success: true,
        queryId,
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

      // Emit: Error
      socketServer.emitRAGError(queryId, {
        message: error.message,
        stage: "chat_failed",
      });

      return {
        success: false,
        queryId,
        error: error.message,
        query: userQuery,
      };
    }
  }

  /**
   * Chat with streaming response
   */
  async *chatStream(userQuery, conversationId = null, options = {}) {
    const queryId = options.queryId || this.generateQueryId();

    try {
      logger.info("Starting streaming chat", {
        query: userQuery,
        queryId,
      });

      // Emit: Starting
      socketServer.emitRAGProgress(queryId, {
        stage: "processing_query",
        message: "Understanding your question...",
        progress: 10,
      });

      // Emit: Creating embedding
      socketServer.emitRAGProgress(queryId, {
        stage: "creating_embedding",
        message: "Creating semantic embedding...",
        progress: 20,
      });

      // Step 1: RAG Pipeline
      const ragResult = await ragPipeline.process(userQuery, {
        topN: options.topN || 10,
        minSimilarity: options.minSimilarity || 0.5,
        promptType: options.promptType || "default",
      });

      // Emit: Search complete
      socketServer.emitRAGProgress(queryId, {
        stage: "search_complete",
        message: `Found ${ragResult.context.metadata.totalDocuments} relevant documents`,
        progress: 50,
        documentsFound: ragResult.context.metadata.totalDocuments,
      });

      // Yield context info first
      yield {
        type: "context",
        queryId,
        data: {
          documentsUsed: ragResult.citations,
          totalDocuments: ragResult.context.metadata.totalDocuments,
        },
      };

      // Emit: Generating response
      socketServer.emitRAGProgress(queryId, {
        stage: "generating_response",
        message: "Generating AI response...",
        progress: 70,
      });

      // Step 2: Stream response
      let fullResponse = "";

      for await (const chunk of geminiService.generateStreamingResponse(
        ragResult.prompt
      )) {
        if (!chunk.done) {
          fullResponse += chunk.text;
          yield {
            type: "text",
            queryId,
            data: chunk.text,
          };
        } else {
          // Final chunk
          yield {
            type: "done",
            queryId,
            data: {
              totalTokens: chunk.tokens,
              fullResponse,
            },
          };

          // Emit: Complete
          socketServer.emitRAGComplete(queryId, {
            stage: "complete",
            message: "Response ready",
            progress: 100,
          });

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

      // Emit: Error
      socketServer.emitRAGError(queryId, {
        message: error.message,
        stage: "streaming_failed",
      });

      yield {
        type: "error",
        queryId,
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
