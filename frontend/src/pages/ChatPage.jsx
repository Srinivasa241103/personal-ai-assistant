import ChatWindow from "../components/chat/ChatWindow";

function ChatPage() {
  return (
    <div className="h-full overflow-hidden text-white flex justify-center">
      <div className="w-full max-w-5xl px-6 py-6 flex flex-col h-full overflow-hidden">
        <div className="flex-1 min-h-0">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
