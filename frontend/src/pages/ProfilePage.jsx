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

      <div className="max-w-6xl mx-auto px-6 py-8 flex gap-8">
        {/* Sidebar Navigation */}
        <nav className="w-48 shrink-0">
          <ul className="space-y-1">
            {[
              { id: "general", label: "General" },
              { id: "accounts", label: "Accounts" },
            ].map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* General Tab */}
          {activeTab === "general" && (
            <div className={profileSettingsStyles.section}>
              <div className={profileSettingsStyles.card}>
                <h2 className={profileSettingsStyles.cardTitle}>Profile</h2>
                <div className="flex items-center gap-5 mb-6">
                  {user.picture ? (
                    <img
                      src={user.picture}
                      alt={user.name}
                      className="w-16 h-16 rounded-full border-2 border-slate-700"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-xl font-bold border-2 border-slate-700">
                      {(user.name || user.email || "?")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-lg font-semibold">
                      {user.name || "—"}
                    </p>
                    <p className="text-sm text-slate-400">
                      {user.email || "—"}
                    </p>
                  </div>
                </div>

                <div className={profileSettingsStyles.formGroup}>
                  <div>
                    <label className={profileSettingsStyles.label}>Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={profileSettingsStyles.input}
                    />
                  </div>
                  <div>
                    <label className={profileSettingsStyles.label}>Email</label>
                    <input
                      type="email"
                      value={email}
                      disabled
                      className={`${profileSettingsStyles.input} opacity-60 cursor-not-allowed`}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Email is managed by your Google account
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={handleSaveProfile}
                      className={profileSettingsStyles.buttonPrimary}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>

              <div className={profileSettingsStyles.card}>
                <h2 className={profileSettingsStyles.dangerZoneTitle}>
                  Danger Zone
                </h2>
                <p className={profileSettingsStyles.dangerZoneText}>
                  Logging out will clear your session. You can log back in
                  anytime with your Google account.
                </p>
                <button
                  onClick={handleLogout}
                  className={profileSettingsStyles.buttonDanger}
                >
                  Log Out
                </button>
              </div>
            </div>
          )}

          {/* Accounts Tab */}
          {activeTab === "accounts" && (
            <div className={profileSettingsStyles.section}>
              {/* Source Icons Row */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => source.enabled && setSelectedSource(source.id)}
                    className={`relative flex flex-col items-center gap-2 p-5 rounded-xl border transition ${
                      !source.enabled
                        ? "border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed"
                        : selectedSource === source.id
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-slate-700 bg-slate-900/50 hover:border-slate-600 cursor-pointer"
                    }`}
                  >
                    <span className="text-3xl">{source.icon}</span>
                    <span
                      className={`text-sm font-medium ${
                        selectedSource === source.id && source.enabled
                          ? "text-indigo-400"
                          : "text-slate-300"
                      }`}
                    >
                      {source.name}
                    </span>
                    {!source.enabled && (
                      <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                        Coming Soon
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Selected Source Details */}
              <div className={profileSettingsStyles.card}>
                <h2 className={profileSettingsStyles.cardTitle}>
                  {sources.find((s) => s.id === selectedSource)?.icon}{" "}
                  {sources.find((s) => s.id === selectedSource)?.name} Sync
                </h2>

                <button
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className={profileSettingsStyles.buttonFull}
                >
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>

              {/* Sync History */}
              <div className={profileSettingsStyles.card}>
                <div className={profileSettingsStyles.historyHeader}>
                  <h2 className={profileSettingsStyles.cardTitle + " !mb-0"}>
                    Sync History
                  </h2>
                  <button
                    onClick={fetchSyncHistory}
                    className={profileSettingsStyles.buttonRefresh}
                  >
                    Refresh
                  </button>
                </div>

                {isLoading ? (
                  <p className={profileSettingsStyles.historyLoading}>
                    Loading history...
                  </p>
                ) : syncHistory.length === 0 ? (
                  <p className={profileSettingsStyles.historyEmpty}>
                    No sync history yet. Hit "Sync Now" to get started.
                  </p>
                ) : (
                  <div className={profileSettingsStyles.historyList}>
                    {syncHistory.map((item, index) => (
                      <div key={index} className={profileSettingsStyles.syncItem}>
                        <div className={profileSettingsStyles.syncItemHeader}>
                          <div className={profileSettingsStyles.syncItemLeft}>
                            <span className={profileSettingsStyles.syncItemIcon}>
                              {sources.find((s) => s.id === item.source)
                                ?.icon || "📄"}
                            </span>
                            <div className={profileSettingsStyles.syncItemInfo}>
                              <p className={profileSettingsStyles.syncItemName}>
                                {item.source}
                              </p>
                              <p className={profileSettingsStyles.syncItemDate}>
                                {formatDate(item.started_at || item.created_at)}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`${profileSettingsStyles.statusBadge} ${getStatusBadge(item.status)}`}
                          >
                            {item.status}
                          </span>
                        </div>
                        {item.stats && (
                          <div className={profileSettingsStyles.syncDetails}>
                            <div>
                              <p className={profileSettingsStyles.syncDetailLabel}>
                                Messages
                              </p>
                              <p className={profileSettingsStyles.syncDetailValue}>
                                {item.stats.total_fetched ?? "—"}
                              </p>
                            </div>
                            <div>
                              <p className={profileSettingsStyles.syncDetailLabel}>
                                New
                              </p>
                              <p className={profileSettingsStyles.syncDetailValue}>
                                {item.stats.new_documents ?? "—"}
                              </p>
                            </div>
                          </div>
                        )}
                        {item.error_message && (
                          <p className={profileSettingsStyles.errorMessage}>
                            {item.error_message}
                          </p>
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
    </div>
  );
}

export default ProfilePage;
