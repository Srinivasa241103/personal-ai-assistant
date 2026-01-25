import { useState, useRef, useEffect } from "react";
import { sidebarStyles } from "../../styles/sidebar.styles";
import { useAuthStore } from "../../store/authStore";
import { authApi } from "../../api/auth";

function Sidebar({ onNavigate, currentPage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuthStore();
  const profileMenuRef = useRef(null);

  const placeholderHistory = [
    { id: 1, title: "How to learn React" },
    { id: 2, title: "JavaScript best practices" },
    { id: 3, title: "Building a REST API" },
    { id: 4, title: "CSS Grid vs Flexbox" },
    { id: 5, title: "Database design tips" },
  ];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showProfileMenu]);

  const getInitials = (name) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleProfileClick = () => {
    // Debug logs
    console.log("=== Profile Debug ===");
    console.log("isAuthenticated:", isAuthenticated);
    console.log("user:", user);
    console.log("user.picture:", user?.picture);
    console.log("user.name:", user?.name);
    console.log("==================");
    
    if (isAuthenticated) {
      setShowProfileMenu(!showProfileMenu);
    } else {
      onNavigate("login");
    }
  };

  const handleSettingsClick = () => {
    setShowProfileMenu(false);
    onNavigate("profile");
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      setShowProfileMenu(false);
      onNavigate("login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const ChatIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={sidebarStyles.chatIcon}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

  const SidebarIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );

  return (
    <div
      className={`${sidebarStyles.sidebar} ${isExpanded ? sidebarStyles.sidebarExpanded : sidebarStyles.sidebarCollapsed}`}
    >
      {/* Header with toggle button */}
      <div className={isExpanded ? sidebarStyles.header : sidebarStyles.headerCollapsed}>
        {isExpanded && <span className={sidebarStyles.logo}>Myra</span>}
        <button
          className={sidebarStyles.toggleButton}
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? "Close sidebar" : "Open sidebar"}
        >
          <SidebarIcon />
        </button>
      </div>

      {/* New Chat button - only shown when expanded */}
      {isExpanded && (
        <div className={sidebarStyles.newChatSection}>
          <button
            className={sidebarStyles.newChatButton}
            onClick={() => onNavigate("chat")}
            title="New Chat"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>New Chat</span>
          </button>
        </div>
      )}

      {/* Chat History Section */}
      <div className={isExpanded ? sidebarStyles.historySection : sidebarStyles.historySectionCollapsed}>
        {isExpanded && (
          <h3 className={sidebarStyles.historyTitle}>Chat History</h3>
        )}

        {isAuthenticated ? (
          placeholderHistory.length > 0 ? (
            placeholderHistory.map((chat) => (
              <button
                key={chat.id}
                className={isExpanded ? sidebarStyles.historyItem : sidebarStyles.historyItemCollapsed}
                onClick={() => {}}
                title={chat.title}
              >
                {isExpanded ? chat.title : <ChatIcon />}
              </button>
            ))
          ) : (
            isExpanded && <p className={sidebarStyles.emptyHistory}>No chat history yet</p>
          )
        ) : (
          isExpanded ? (
            <div className={sidebarStyles.loginPrompt}>
              <p className="mb-3">Sign in to save your chat history</p>
              <button
                onClick={() => onNavigate("login")}
                className="text-cyan-400 hover:text-cyan-300 transition font-medium"
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className={sidebarStyles.loginPromptCollapsed}>
              <button
                onClick={() => onNavigate("login")}
                className="p-2 rounded-lg hover:bg-slate-800/80 transition"
                title="Sign in"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-slate-400"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" x2="3" y1="12" y2="12" />
                </svg>
              </button>
            </div>
          )
        )}
      </div>

      {/* Footer with profile */}
      <div className={isExpanded ? sidebarStyles.footer : sidebarStyles.footerCollapsed}>
        <div ref={profileMenuRef} className="relative">
          <button
            className={isExpanded ? sidebarStyles.profileButton : sidebarStyles.profileButtonCollapsed}
            onClick={handleProfileClick}
            title={isAuthenticated && user ? user.name : "Sign in"}
          >
            {isAuthenticated && user?.picture ? (
              <img
                src={user.picture}
                alt={user.name || "Profile"}
                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                onError={(e) => {
                  console.error("Image failed to load:", user.picture);
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <div className={sidebarStyles.profileAvatar}>
                {isAuthenticated && user ? getInitials(user.name) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
            )}
            {isExpanded && (
              <div className={sidebarStyles.profileInfo}>
                {isAuthenticated && user ? (
                  <>
                    <p className={sidebarStyles.profileName}>{user.name}</p>
                    <p className={sidebarStyles.profileEmail}>{user.email}</p>
                  </>
                ) : (
                  <p className={sidebarStyles.profileName}>Sign in</p>
                )}
              </div>
            )}
          </button>

          {/* Profile Dropdown Menu */}
          {showProfileMenu && isAuthenticated && (
            <div className={sidebarStyles.profileMenu}>
              <button
                onClick={handleSettingsClick}
                className={sidebarStyles.profileMenuItem}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Settings
              </button>
              <button
                onClick={handleLogout}
                className={`${sidebarStyles.profileMenuItem} ${sidebarStyles.profileMenuItemDanger}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" x2="9" y1="12" y2="12" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Sidebar;