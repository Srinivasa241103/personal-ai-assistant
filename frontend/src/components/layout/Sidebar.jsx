import { useState } from "react";
import { sidebarStyles } from "../../styles/sidebar.styles";
import { useAuthStore } from "../../store/authStore";

function Sidebar({ onNavigate, currentPage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { user, isAuthenticated } = useAuthStore();

  const placeholderHistory = [
    { id: 1, title: "How to learn React" },
    { id: 2, title: "JavaScript best practices" },
    { id: 3, title: "Building a REST API" },
    { id: 4, title: "CSS Grid vs Flexbox" },
    { id: 5, title: "Database design tips" },
  ];

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
    if (isAuthenticated) {
      onNavigate("profile");
    } else {
      onNavigate("login");
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

  return (
    <div
      className={`${sidebarStyles.sidebar} ${isExpanded ? sidebarStyles.sidebarExpanded : sidebarStyles.sidebarCollapsed}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className={isExpanded ? sidebarStyles.header : sidebarStyles.headerCollapsed}>
        {isExpanded && <span className={sidebarStyles.logo}>Myra</span>}
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
        </button>
      </div>

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

      <div className={isExpanded ? sidebarStyles.footer : sidebarStyles.footerCollapsed}>
        <button
          className={isExpanded ? sidebarStyles.profileButton : sidebarStyles.profileButtonCollapsed}
          onClick={handleProfileClick}
          title={isAuthenticated && user ? user.name : "Sign in"}
        >
          {isAuthenticated && user?.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
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
      </div>
    </div>
  );
}

export default Sidebar;
