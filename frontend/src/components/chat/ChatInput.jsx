import { useState } from "react";
import { chatStyles } from "../../styles/chat.styles";

function ChatInput({ onSend }) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className={chatStyles.inputWrapper}>
      <textarea
        rows={1}
        className={`${chatStyles.input} resize-none`}
        placeholder="Ask something..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        onClick={handleSend}
        disabled={!input.trim()}
        className={chatStyles.sendButton}
      >
        Send
      </button>
    </div>
  );
}

export default ChatInput;
