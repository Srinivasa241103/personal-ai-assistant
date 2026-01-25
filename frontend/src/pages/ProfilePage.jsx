import { useState, useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/auth";
import { profileSettingsStyles } from "../styles/profileSettings.styles";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

function ProfilePage({ onNavigate }) {
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState("general");
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [selectedSource, setSelectedSource] = useState("gmail");
  const [syncHistory, setSyncHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const sources = [
    { id: "gmail", name: "Gmail", icon: "📧", enabled: true },
    { id: "calendar", name: "Calendar", icon: "📅", enabled: false },
    { id: "spotify", name: "Spotify", icon: "🎵", enabled: false },
  ];

  useEffect(() => {
    if (activeTab === "accounts") {
      fetchSyncHistory();
    }
  }, [activeTab]);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const fetchSyncHistory = async () => {
    setIsLoading(true);
    try {
      const userId = user?.id || user?.sub || user?.email;

      const response = await fetch(
        `${API_BASE_URL}/sync/history?userId=${userId}`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        setSyncHistory(data.data.history);
      }
    } catch (error) {
      console.error("Failed to fetch sync history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const userId = user?.id || user?.sub || user?.email;

      const response = await fetch(
        `${API_BASE_URL}/sync/${selectedSource}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            syncType: "incremental",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        setTimeout(fetchSyncHistory, 1000);
      }
    } catch (error) {
      console.error("Failed to start sync:", error);
      alert("Failed to start sync. Check console for details.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      onNavigate("login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleSaveProfile = async () => {
    console.log("Saving profile:", { name, email });
  };

  const formatDate = (dateString) =>
    dateString ? new Date(dateString).toLocaleString() : "N/A";

  const getStatusBadge = (status) => {
    const styles = {
      success: profileSettingsStyles.statusSuccess,
      in_progress: profileSettingsStyles.statusInProgress,
      failed: profileSettingsStyles.statusFailed,
    };
    return styles[status] || styles.failed;
  };

  if (!user) {
    onNavigate("login");
    return null;
  }

  return (
    <div className={profileSettingsStyles.container}>
      {/* Header */}
      <div className={profileSettingsStyles.header}>
        <div className={profileSettingsStyles.headerContent}>
          <div className={profileSettingsStyles.headerLeft}>
            <button
              onClick={() => onNavigate("chat")}
              className={profileSettingsStyles.backButton}
            >
              ←
            </button>
            <h1 className={profileSettingsStyles.headerTitle}>Settings</h1>
          </div>
        </div>
      </div>

      <div className={profileSettingsStyles.content}>
        {/* Tabs */}
        <div className={profileSettingsStyles.tabsContainer}>
          <button
            onClick={() => setActiveTab("general")}
            className={
              activeTab === "general"
                ? profileSettingsStyles.tabActive
                : profileSettingsStyles.tabInactive
            }
          >
            General
          </button>
          <button
            onClick={() => setActiveTab("accounts")}
            className={
              activeTab === "accounts"
                ? profileSettingsStyles.tabActive
                : profileSettingsStyles.tabInactive
            }
          >
            Accounts
          </button>
        </div>

        {/* Accounts Tab */}
        {activeTab === "accounts" && (
          <div className={profileSettingsStyles.section}>
            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className={profileSettingsStyles.buttonFull}
            >
              {isSyncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
