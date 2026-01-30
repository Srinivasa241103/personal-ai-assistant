import { useEffect, useRef } from "react";
import Message from "./Message";
import ChatInput from "./ChatInput";
import TypingIndicator from "./TypingIndicator";
import { chatStyles } from "../../styles/chat.styles";
import { useChatStore } from "../../store/chatStore";

function ChatWindow() {
  const { messages, isTyping, sendMessage } = useChatStore();

  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0 || isTyping) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [messages, isTyping]);

  const handleSend = (text) => {
    sendMessage(text);
  };

  if (messages.length === 0) {
    return (
      <div className={`${chatStyles.chatWindow} bg-transparent border-transparent shadow-none`}>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-medium text-white mb-3">
              What are you working on?
            </h2>
            <p className="text-slate-400">
              I am your personal AI assistant. Ask me anything.
            </p>
          </div>

          <div className="w-full">
            <ChatInput onSend={handleSend} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={chatStyles.chatWindow}>
      <div className={chatStyles.messages}>
        {messages.map((msg, idx) => (
          <Message key={idx} role={msg.role} text={msg.text} isError={msg.isError} context={msg.context} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput onSend={handleSend} />
    </div>
  );
}

export default ChatWindow;
