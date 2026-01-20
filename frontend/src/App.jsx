import { useState, useEffect } from "react";
import ChatPage from "./pages/ChatPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import Sidebar from "./components/layout/Sidebar";
import { useAuthStore } from "./store/authStore";
import { authApi } from "./api/auth";

function App() {
  const [currentPage, setCurrentPage] = useState(() => {
    if (window.location.pathname === "/auth/callback") {
      return "auth-callback";
    }
    return "chat";
  });
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    const checkAuth = async () => {
      if (currentPage === "auth-callback") {
        return;
      }

      setLoading(true);
      try {
        const user = await authApi.getCurrentUser();
        if (user) {
          setUser(user);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [setUser, setLoading, currentPage]);

  const handleNavigate = (page) => {
    if (page === "chat") {
      window.history.pushState({}, "", "/");
    }
    setCurrentPage(page);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "auth-callback":
        return <AuthCallbackPage onNavigate={handleNavigate} />;
      case "login":
        return <LoginPage onNavigate={handleNavigate} />;
      case "profile":
        return <ProfilePage onNavigate={handleNavigate} />;
      case "chat":
      default:
        return <ChatPage />;
    }
  };

  if (currentPage === "auth-callback" || currentPage === "login" || currentPage === "profile") {
    return renderPage();
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <Sidebar onNavigate={handleNavigate} currentPage={currentPage} />
      <div className="flex-1 overflow-hidden">
        {renderPage()}
      </div>
    </div>
  );
}

export default App;
