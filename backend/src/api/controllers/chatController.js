import chatService from "../../service/llm/chatService.js";
import { logger } from "../../utils/logger.js";

class ChatController {
  async sendMessage(req, res) {
    try {
      const { message, conversationId } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: "Message is required",
        });
      }

      const result = await chatService.chat(message.trim(), conversationId);

      return res.json(result);
    } catch (error) {
      logger.error("Chat controller error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to process message",
      });
    }
  }

  async sendMessageStream(req, res) {
    try {
      const { message, conversationId } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: "Message is required",
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for await (const chunk of chatService.chatStream(
        message.trim(),
        conversationId
      )) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      logger.error("Chat stream controller error", { error: error.message });
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Failed to process message",
        });
      }
      res.end();
    }
  }

  async getHistory(req, res) {
    try {
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit) || 10;

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: "Conversation ID is required",
        });
      }

      const history = await chatService.getHistory(conversationId, limit);

      return res.json({
        success: true,
        data: { conversationId, history },
      });
    } catch (error) {
      logger.error("Get history error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to fetch history",
      });
    }
  }

  async createConversation(req, res) {
    try {
      const conversation = chatService.createConversation();
      return res.json({ success: true, data: conversation });
    } catch (error) {
      logger.error("Create conversation error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to create conversation",
      });
    }
  }
}

export default new ChatController();
