const API_BASE_URL = "http://localhost:2020";

const TOKEN_KEY = "myra_auth_token";

export const authApi = {
  loginWithGoogle: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/google/login`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Google login");
      }

      const data = await response.json();

      if (data.success && data.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (error) {
      console.error("Google login error:", error);
      throw error;
    }
  },

  getToken: () => {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken: (token) => {
    localStorage.setItem(TOKEN_KEY, token);
  },

  removeToken: () => {
    localStorage.removeItem(TOKEN_KEY);
  },

  getCurrentUser: async () => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          return null;
        }
        throw new Error("Failed to get user");
      }

      const data = await response.json();

      if (data.success && data.data?.user) {
        return data.data.user;
      }

      return null;
    } catch (error) {
      console.error("Get current user error:", error);
      return null;
    }
  },

  logout: async () => {
    const token = localStorage.getItem(TOKEN_KEY);

    try {
      if (token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
    }
  },
};
