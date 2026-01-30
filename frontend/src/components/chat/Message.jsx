import { chatStyles } from "../../styles/chat.styles";

function Message({ role, text, isError, context }) {
  const isUser = role === "user";

  return (
    <div
      className={`flex gap-2 items-start ${
        isUser ? "justify-end" : "justify-start"
      } animate-fade-in`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm shrink-0">
          AI
        </div>
      )}

      <div className="flex flex-col gap-1 max-w-[70%]">
        <div
          className={`${
            isUser ? chatStyles.userMessage : chatStyles.aiMessage
          } ${isError ? "border border-red-500/40 bg-red-500/10" : ""}`}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {text}
        </div>
        {!isUser && context && context.selectedDocuments > 0 && (
          <span className="text-xs text-slate-500 px-2">
            Based on {context.selectedDocuments} document
            {context.selectedDocuments !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm shrink-0">
          ME
        </div>
      )}
    </div>
  );
}

export default Message;
