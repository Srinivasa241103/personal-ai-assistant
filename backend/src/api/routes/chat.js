import { Router } from "express";
import chatController from "../controllers/chatController.js";

const router = Router();

router.post("/message", (req, res) => chatController.sendMessage(req, res));
router.post("/message/stream", (req, res) => chatController.sendMessageStream(req, res));
router.post("/conversation", (req, res) => chatController.createConversation(req, res));
router.get("/history/:conversationId", (req, res) => chatController.getHistory(req, res));

export default router;
