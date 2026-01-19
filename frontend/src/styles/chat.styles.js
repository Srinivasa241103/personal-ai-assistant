export const chatStyles = {
  page:
    "h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex justify-center",

  pageInner:
    "w-full max-w-5xl px-6 py-6 flex flex-col h-full overflow-hidden",

  header:
    "shrink-0 mb-4 px-6 py-4 text-xl font-semibold rounded-xl border border-indigo-500/30 bg-slate-900/70 backdrop-blur shadow-lg text-center",

  chatWindow:
    "flex flex-col flex-1 min-h-0 rounded-2xl border border-indigo-500/20 bg-slate-900/60 shadow-xl overflow-hidden",

  messages:
    "flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col gap-4",

  inputWrapper:
    "shrink-0 border-t border-indigo-500/20 px-6 py-4 bg-slate-900/80 backdrop-blur flex items-center gap-3",

  userMessage:
    "self-end bg-cyan-500/90 text-slate-900 px-4 py-2 rounded-2xl max-w-[70%]",

  aiMessage:
    "self-start bg-indigo-600/90 px-4 py-2 rounded-2xl max-w-[70%]",

  input:
    "flex-1 bg-slate-800 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400",

  sendButton:
    "bg-emerald-400 text-slate-900 px-5 py-3 rounded-xl hover:bg-emerald-300 transition font-medium disabled:opacity-40 disabled:cursor-not-allowed",
};
