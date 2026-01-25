import { useState, useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/auth";
import { profileSettingsStyles } from "../styles/profileSettings.styles";

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
      const userId = user?.id || user?.sub || user?.email; // Get userId from user object
      
      const response = await fetch(`http://localhost:2020/sync/history?userId=${userId}`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Sync history response:", data);
      
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
      const userId = user?.id || user?.sub || user?.email; // Get userId from user object
      
      const response = await fetch(`http://localhost:2020/sync/${selectedSource}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: userId,
          syncType: "incremental",
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Sync response:", data);
      
      if (data.success) {
        // Refresh history after starting sync
        setTimeout(() => {
          fetchSyncHistory();
        }, 1000);
      }
    } catch (error) {
      console.error("Failed to start sync:", error);
      alert("Failed to start sync. Please check console for details.");
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
    // Add your profile update API call here
    console.log("Saving profile:", { name, email });
    // You can add a toast notification here for success/error
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  };

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
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
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
            className={`${profileSettingsStyles.tab} ${
              activeTab === "general"
                ? profileSettingsStyles.tabActive
                : profileSettingsStyles.tabInactive
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab("accounts")}
            className={`${profileSettingsStyles.tab} ${
              activeTab === "accounts"
                ? profileSettingsStyles.tabActive
                : profileSettingsStyles.tabInactive
            }`}
          >
            Accounts
          </button>
        </div>

        {/* General Tab */}
        {activeTab === "general" && (
          <div className={profileSettingsStyles.section}>
            <div className={profileSettingsStyles.card}>
              <h2 className={profileSettingsStyles.cardTitle}>Profile Information</h2>
              
              <div className={profileSettingsStyles.formGroup}>
                <div>
                  <label className={profileSettingsStyles.label}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={profileSettingsStyles.input}
                  />
                </div>

                <div>
                  <label className={profileSettingsStyles.label}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={profileSettingsStyles.input}
                    disabled
                  />
                  <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
                </div>

                <button
                  onClick={handleSaveProfile}
                  className={profileSettingsStyles.buttonPrimary}
                >
                  Save Changes
                </button>
              </div>
            </div>

            <div className={profileSettingsStyles.card}>
              <h2 className={profileSettingsStyles.dangerZoneTitle}>Danger Zone</h2>
              <p className={profileSettingsStyles.dangerZoneText}>
                Sign out of your account
              </p>
              <button
                onClick={handleLogout}
                className={profileSettingsStyles.buttonDanger}
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Accounts Tab */}
        {activeTab === "accounts" && (
          <div className={profileSettingsStyles.section}>
            <div className={profileSettingsStyles.card}>
              <h2 className={profileSettingsStyles.cardTitle}>Connected Services</h2>
              
              <div className={profileSettingsStyles.selectGroup}>
                <label className={profileSettingsStyles.label}>
                  Select Service
                </label>
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className={profileSettingsStyles.select}
                >
                  {sources.map((source) => (
                    <option
                      key={source.id}
                      value={source.id}
                      disabled={!source.enabled}
                    >
                      {source.icon} {source.name}
                      {!source.enabled && " (Coming Soon)"}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSyncNow}
                disabled={isSyncing || !sources.find(s => s.id === selectedSource)?.enabled}
                className={profileSettingsStyles.buttonFull}
              >
                {isSyncing ? (
                  <>
                    <svg
                      className={profileSettingsStyles.spinner}
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Syncing...
                  </>
                ) : (
                  <>
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
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                    </svg>
                    Sync Now
                  </>
                )}
              </button>
            </div>

            {/* Recent Syncs */}
            <div className={profileSettingsStyles.card}>
              <div className={profileSettingsStyles.historyHeader}>
                <h2 className={profileSettingsStyles.cardTitle}>Recent Syncs</h2>
                <button
                  onClick={fetchSyncHistory}
                  className={profileSettingsStyles.buttonRefresh}
                >
                  Refresh
                </button>
              </div>

              {isLoading ? (
                <div className={profileSettingsStyles.historyLoading}>Loading...</div>
              ) : syncHistory.length === 0 ? (
                <div className={profileSettingsStyles.historyEmpty}>No sync history yet</div>
              ) : (
                <div className={profileSettingsStyles.historyList}>
                  {syncHistory.map((sync) => (
                    <div
                      key={sync.id}
                      className={profileSettingsStyles.syncItem}
                    >
                      <div className={profileSettingsStyles.syncItemHeader}>
                        <div className={profileSettingsStyles.syncItemLeft}>
                          <span className={profileSettingsStyles.syncItemIcon}>
                            {sources.find(s => s.id === sync.source)?.icon || "📧"}
                          </span>
                          <div className={profileSettingsStyles.syncItemInfo}>
                            <p className={profileSettingsStyles.syncItemName}>{sync.source}</p>
                            <p className={profileSettingsStyles.syncItemDate}>
                              {formatDate(sync.sync_started_at)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`${profileSettingsStyles.statusBadge} ${getStatusBadge(
                            sync.status
                          )}`}
                        >
                          {sync.status.replace("_", " ")}
                        </span>
                      </div>

                      {sync.status === "success" && (
                        <div className={profileSettingsStyles.syncDetails}>
                          <div className={profileSettingsStyles.syncDetailItem}>
                            <p className={profileSettingsStyles.syncDetailLabel}>Fetched</p>
                            <p className={profileSettingsStyles.syncDetailValue}>
                              {sync.documents_fetched} documents
                            </p>
                          </div>
                          <div className={profileSettingsStyles.syncDetailItem}>
                            <p className={profileSettingsStyles.syncDetailLabel}>Stored</p>
                            <p className={profileSettingsStyles.syncDetailValue}>
                              {sync.documents_stored} documents
                            </p>
                          </div>
                        </div>
                      )}

                      {sync.error_message && (
                        <div className={profileSettingsStyles.errorMessage}>
                          {sync.error_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;