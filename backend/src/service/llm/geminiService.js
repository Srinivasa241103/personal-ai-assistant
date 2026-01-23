import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";

export default class GeminiService {
  constructor() {
    this.genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.embeddingModel = this.genAi.generativeModel({
      model: "embedding-001",
    });
  }
}
