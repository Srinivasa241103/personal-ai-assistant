export const profileSettingsStyles = {
  container: "min-h-screen bg-slate-950 text-white",
  
  // Header
  header: "border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm",
  headerContent: "max-w-4xl mx-auto px-6 py-4 flex items-center justify-between",
  headerLeft: "flex items-center gap-4",
  backButton: "p-2 hover:bg-slate-800 rounded-lg transition",
  headerTitle: "text-xl font-semibold",
  
  // Content
  content: "max-w-4xl mx-auto px-6 py-8",
  
  // Tabs
  tabsContainer: "flex gap-6 border-b border-slate-800 mb-8",
  tab: "pb-3 px-1 font-medium transition",
  tabActive: "text-white border-b-2 border-indigo-500",
  tabInactive: "text-slate-400 hover:text-slate-300",
  
  // Sections
  section: "space-y-6",
  card: "bg-slate-900/50 rounded-xl p-6 border border-slate-800",
  cardTitle: "text-lg font-semibold mb-4",
  
  // Form elements
  formGroup: "space-y-4",
  label: "block text-sm font-medium text-slate-300 mb-2",
  input: "w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white",
  select: "w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white",
  
  // Buttons
  buttonPrimary: "px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition font-medium",
  buttonDanger: "px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition font-medium",
  buttonFull: "w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg transition font-medium flex items-center justify-center gap-2",
  buttonRefresh: "text-sm text-indigo-400 hover:text-indigo-300 transition",
  
  // Danger zone
  dangerZoneTitle: "text-lg font-semibold mb-2 text-red-400",
  dangerZoneText: "text-sm text-slate-400 mb-4",
  
  // Accounts
  selectGroup: "mb-6",
  
  // Sync history
  historyHeader: "flex items-center justify-between mb-4",
  historyEmpty: "text-center py-8 text-slate-400",
  historyLoading: "text-center py-8 text-slate-400",
  historyList: "space-y-3",
  
  // Sync item
  syncItem: "bg-slate-800/50 rounded-lg p-4 border border-slate-700",
  syncItemHeader: "flex items-center justify-between mb-2",
  syncItemLeft: "flex items-center gap-3",
  syncItemIcon: "text-2xl",
  syncItemInfo: "",
  syncItemName: "font-medium capitalize",
  syncItemDate: "text-xs text-slate-400",
  
  // Status badges
  statusBadge: "px-3 py-1 rounded-full text-xs font-medium",
  statusSuccess: "bg-green-500/20 text-green-400 border border-green-500/30",
  statusInProgress: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  statusFailed: "bg-red-500/20 text-red-400 border border-red-500/30",
  
  // Sync details
  syncDetails: "grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-slate-700",
  syncDetailItem: "",
  syncDetailLabel: "text-xs text-slate-400",
  syncDetailValue: "text-sm font-medium",
  
  // Error message
  errorMessage: "mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400",
  
  // Spinner
  spinner: "animate-spin h-5 w-5",
};