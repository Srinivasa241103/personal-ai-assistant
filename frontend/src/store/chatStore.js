import { create } from "zustand";

export const useChatStore = create((set) => ({
  messages: [],
  isTyping: false,

  sendUserMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { role: "user", text }],
      isTyping: true,
    })),

  receiveAIMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { role: "ai", text }],
      isTyping: false,
    })),

  resetChat: () =>
    set({
      messages: [],
      isTyping: false,
    }),
}));
