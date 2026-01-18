import ChatWindow from "../components/chat/ChatWindow";
import { chatStyles } from "../styles/chat.styles";

function ChatPage() {
  return (
    <div className={chatStyles.page}>
      <div className={chatStyles.pageInner}>
        <header className={chatStyles.header}>
          Personal AI Assistant
        </header>

        <div className="flex-1 min-h-0">
          <ChatWindow />
          
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
