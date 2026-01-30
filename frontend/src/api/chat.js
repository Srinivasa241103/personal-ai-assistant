const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

export const chatApi = {
  sendMessage: async (message, conversationId = null) => {
    const response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message, conversationId }),
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    return response.json();
  },

  createConversation: async () => {
    const response = await fetch(`${API_BASE_URL}/chat/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status}`);
    }

    return response.json();
  },

  getHistory: async (conversationId, limit = 10) => {
    const response = await fetch(
      `${API_BASE_URL}/chat/history/${conversationId}?limit=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`);
    }

    return response.json();
  },
};
