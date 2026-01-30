import { create } from "zustand";
import { chatApi } from "../api/chat";

export const useChatStore = create((set, get) => ({
  messages: [],
  isTyping: false,
  conversationId: null,
  error: null,

  sendMessage: async (text) => {
    const { conversationId } = get();

    // Add user message immediately
    set((state) => ({
      messages: [...state.messages, { role: "user", text }],
      isTyping: true,
      error: null,
    }));

    try {
      const result = await chatApi.sendMessage(text, conversationId);

      if (result.success) {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: "ai",
              text: result.response,
              context: result.context,
              metadata: result.metadata,
            },
          ],
          isTyping: false,
          conversationId: result.conversationId,
        }));
      } else {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: "ai",
              text: result.error || "Sorry, I couldn't process your request.",
              isError: true,
            },
          ],
          isTyping: false,
          error: result.error,
        }));
      }
    } catch (error) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: "ai",
            text: "Something went wrong. Please try again.",
            isError: true,
          },
        ],
        isTyping: false,
        error: error.message,
      }));
    }
  },

  resetChat: () =>
    set({
      messages: [],
      isTyping: false,
      conversationId: null,
      error: null,
    }),
}));
