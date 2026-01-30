import { pool } from "../../config/dbConfig.js";
import { logger } from "../../utils/logger.js";
import { estimateTokens } from "../../utils/tokenCounter.js";

class ConversationMemory {
  constructor() {
    this.maxTokenPerConversation = 9000;
    this.maxMessagesPerConversation = 20;
  }

  async saveConversation(
    conversationId,
    userMessage,
    assistantMessage,
    metadata = {}
  ) {
    try {
      const query = `
            INSERT INTO conversations 
            (conversation_id, user_message, assistant_message, metadata, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, created_at
          `;

      const values = [
        conversationId,
        userMessage,
        assistantMessage,
        JSON.stringify(metadata),
      ];

      const result = await pool.query(query, values);

      logger.info("Conversation saved", {
        conversationId,
        messageId: result.rows[0].id,
      });

      return result.rows[0];
    } catch (error) {
      logger.error("Error saving conversation", {
        error: error.message,
        conversationId,
      });
      throw error;
    }
  }

  async getConversationHistory(conversationId, limit = 10) {
    try {
      const query = `
            SELECT 
              id,
              user_message,
              assistant_message,
              metadata,
              created_at
            FROM conversations
            WHERE conversation_id = $1
            ORDER BY created_at DESC
            LIMIT $2
          `;

      const result = await pool.query(query, [conversationId, limit]);

      // Reverse to get chronological order
      return result.rows.reverse();
    } catch (error) {
      logger.error("Error getting conversation history", {
        error: error.message,
        conversationId,
      });
      throw error;
    }
  }

  async formatForGemini(conversationId, currentUserMessage) {
    const history = await this.getConversationHistory(
      conversationId,
      this.maxMessagesPerConversation
    );

    const messages = [];
    let totalTokens = 0;

    // Add historical messages
    for (const turn of history) {
      const userTokens = estimateTokens(turn.user_message);
      const assistantTokens = estimateTokens(turn.assistant_message);

      // Stop if adding would exceed token limit
      if (
        totalTokens + userTokens + assistantTokens >
        this.maxTokenPerConversation
      ) {
        logger.info("Token limit reached, truncating history", {
          totalTokens,
          limit: this.maxTokenPerConversation,
        });
        break;
      }

      messages.push({
        role: "user",
        content: turn.user_message,
      });

      messages.push({
        role: "assistant",
        content: turn.assistant_message,
      });

      totalTokens += userTokens + assistantTokens;
    }

    // Add current user message
    messages.push({
      role: "user",
      content: currentUserMessage,
    });

    logger.debug("Formatted conversation for Gemini", {
      messageCount: messages.length,
      totalTokens,
    });

    return messages;
  }

  createConversationId() {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async deleteOldConversations(daysOld = 30) {
    try {
      const query = `
            DELETE FROM conversations
            WHERE created_at < NOW() - INTERVAL $1
            RETURNING conversation_id
          `;

      const result = await pool.query(query, [`${daysOld} days`]);

      logger.info("Old conversations deleted", {
        count: result.rowCount,
        daysOld,
      });

      return result.rowCount;
    } catch (error) {
      logger.error("Error deleting old conversations", {
        error: error.message,
      });
      throw error;
    }
  }

  async getConversationSummary(conversationId) {
    try {
      const query = `
            SELECT 
              COUNT(*) as message_count,
              MIN(created_at) as first_message,
              MAX(created_at) as last_message
            FROM conversations
            WHERE conversation_id = $1
          `;

      const result = await pool.query(query, [conversationId]);
      return result.rows[0];
    } catch (error) {
      logger.error("Error getting conversation summary", {
        error: error.message,
      });
      throw error;
    }
  }
}

export default new ConversationMemory();
