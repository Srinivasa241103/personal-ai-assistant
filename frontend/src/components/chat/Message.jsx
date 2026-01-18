import { chatStyles } from "../../styles/chat.styles";

function Message({ role, text }) {
  const isUser = role === "user";

  return (
    <div
      className={`flex gap-2 items-start ${
        isUser ? "justify-end" : "justify-start"
      } animate-fade-in`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm">
          AI
        </div>
      )}

      <div
        className={
          isUser ? chatStyles.userMessage : chatStyles.aiMessage
        }
      >
        {text}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm">
          ME
        </div>
      )}
    </div>
  );
}

export default Message;
