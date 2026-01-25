export const sidebarStyles = {
  sidebar:
    "h-screen bg-slate-900/90 border-r border-indigo-500/20 flex flex-col transition-all duration-300 ease-in-out",

  sidebarExpanded: "w-64",

  sidebarCollapsed: "w-16",

  header:
    "px-4 py-5 border-b border-indigo-500/20 flex items-center justify-between",

  headerCollapsed: "px-4 py-5 border-b border-indigo-500/20 flex items-center justify-center",

  logo: "text-xl font-semibold text-white transition-opacity duration-200",

  logoHidden: "opacity-0 w-0 overflow-hidden",

  newChatButton:
    "p-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 transition text-white flex items-center justify-center gap-2 w-full",

  historySection: "flex-1 overflow-y-auto px-3 py-4",

  historySectionCollapsed: "flex-1 overflow-y-auto px-2 py-4",

  historyTitle: "text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 px-2 transition-opacity duration-200",

  historyTitleHidden: "opacity-0 h-0 overflow-hidden mb-0",

  historyItem:
    "w-full text-left px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800/80 transition mb-1 truncate text-sm",

  historyItemCollapsed:
    "w-full flex items-center justify-center py-2.5 rounded-lg text-slate-300 hover:bg-slate-800/80 transition mb-1",

  historyItemActive:
    "w-full text-left px-3 py-2.5 rounded-lg bg-indigo-600/30 text-white border border-indigo-500/30 mb-1 truncate text-sm",

  emptyHistory: "text-slate-500 text-sm px-2 py-4 text-center",

  loginPrompt:
    "text-slate-400 text-sm px-4 py-6 text-center border-t border-indigo-500/20",

  loginPromptCollapsed:
    "text-slate-400 text-sm px-2 py-4 text-center",

  footer:
    "px-4 py-4 border-t border-indigo-500/20",

  footerCollapsed:
    "px-2 py-4 border-t border-indigo-500/20 flex justify-center",

  profileButton:
    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/80 transition",

  profileButtonCollapsed:
    "flex items-center justify-center p-2 rounded-lg hover:bg-slate-800/80 transition",

  profileAvatar:
    "w-9 h-9 rounded-full bg-indigo-600/80 flex items-center justify-center text-white font-medium flex-shrink-0",

  profileInfo: "flex-1 min-w-0 transition-opacity duration-200",

  profileInfoHidden: "opacity-0 w-0 overflow-hidden",

  profileName: "text-sm font-medium text-white truncate",

  profileEmail: "text-xs text-slate-400 truncate",

  chatIcon: "w-5 h-5 text-slate-400",

  toggleButton: "p-2 rounded-lg hover:bg-slate-800 transition text-white",

  newChatSection: "px-4 mb-4",

  // Profile Menu Dropdown
  profileMenu: "absolute bottom-full left-0 mb-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50",
  
  profileMenuItem: "w-full px-4 py-3 flex items-center gap-3 text-left text-white hover:bg-slate-700 transition text-sm",
  
  profileMenuItemDanger: "text-red-400 hover:bg-red-500/10 hover:text-red-300",
};