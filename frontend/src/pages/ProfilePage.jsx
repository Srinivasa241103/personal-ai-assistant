import { authStyles } from "../styles/auth.styles";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/auth";

function ProfilePage({ onNavigate }) {
  const { user, logout } = useAuthStore();

  const getInitials = (name) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
    logout();
    onNavigate("chat");
  };

  if (!user) {
    onNavigate("login");
    return null;
  }

  return (
    <div className={authStyles.page}>
      <div className={authStyles.profileCard}>
        <div className={authStyles.profileHeader}>
          {user.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              className={authStyles.profileAvatarImage}
            />
          ) : (
            <div className={authStyles.profileAvatar}>
              {getInitials(user.name)}
            </div>
          )}
          <h1 className={authStyles.profileName}>{user.name}</h1>
          <p className={authStyles.profileEmail}>{user.email}</p>
        </div>

        <div className={authStyles.infoSection}>
          <div className={authStyles.infoItem}>
            <svg
              className={authStyles.infoIcon}
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
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <div>
              <p className={authStyles.infoLabel}>Email</p>
              <p className={authStyles.infoValue}>{user.email}</p>
            </div>
          </div>

          <div className={authStyles.infoItem}>
            <svg
              className={authStyles.infoIcon}
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
            <div>
              <p className={authStyles.infoLabel}>Account</p>
              <p className={authStyles.infoValue}>Google Account</p>
            </div>
          </div>
        </div>

        <button onClick={handleLogout} className={authStyles.logoutButton}>
          Sign Out
        </button>

        <button
          onClick={() => onNavigate("chat")}
          className={authStyles.backButton}
        >
          Back to Chat
        </button>
      </div>
    </div>
  );
}

export default ProfilePage;
