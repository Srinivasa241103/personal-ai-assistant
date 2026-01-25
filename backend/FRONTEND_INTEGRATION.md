# Frontend Integration Guide: Chat Flow with WebSocket Progress

## Overview

Your frontend needs to:
1. Connect to the backend WebSocket server
2. Send chat queries via REST API
3. Listen for RAG progress events via WebSocket
4. Display progress messages to the user

---

## Files to Create

### 1. `src/api/socket.js` (NEW FILE)

**Purpose:** Centralized WebSocket connection manager

**What it should do:**
- Initialize Socket.IO client connection to `http://localhost:9000`
- Export the socket instance for use across the app
- Handle connection/disconnection events
- Pass `userId` in the connection query for user identification

---

### 2. `src/api/chat.js` (NEW FILE)

**Purpose:** Chat API functions

**What it should do:**
- Create a `sendMessage(query, conversationId)` function
- Make POST request to `/api/chat` endpoint on backend
- Return the response (which includes `queryId`)
- Handle errors appropriately

---

### 3. `src/hooks/useSocket.js` (NEW FILE - Optional but Recommended)

**Purpose:** React hook for WebSocket events

**What it should do:**
- Import the socket from `socket.js`
- Set up event listeners for:
  - `rag:progress` - Progress updates
  - `rag:complete` - Query completion
  - `rag:error` - Query errors
  - `sync:gmail:progress` - Gmail sync progress
  - `sync:gmail:complete` - Gmail sync complete
  - `sync:gmail:error` - Gmail sync error
- Clean up listeners on unmount
- Return current status/progress state

---

## Files to Modify

### 4. `src/store/chatStore.js`

**Changes needed:**

| Current State | Add These New States |
|---------------|---------------------|
| `messages` | Keep as is |
| `isTyping` | Keep as is |
| | `ragStatus` - Current RAG stage message |
| | `ragProgress` - Progress percentage (0-100) |
| | `currentQueryId` - Track active query |
| | `isProcessing` - Is RAG pipeline running |

**New Actions to Add:**
- `setRAGProgress(status, progress, queryId)` - Update RAG status
- `clearRAGProgress()` - Reset progress state
- `setCurrentQueryId(queryId)` - Set active query ID

---

### 5. `src/components/chat/ChatWindow.jsx`

**Changes needed:**

1. **Import the socket hook** (if created) or socket directly
2. **Replace the `handleSend` function:**
   - Instead of `setTimeout` with placeholder, call the actual chat API
   - Store the returned `queryId` in state
3. **Add WebSocket event listeners:**
   - Listen for `rag:progress` events
   - Update the typing indicator with actual status messages
4. **Get RAG status from store** and pass to TypingIndicator

---

### 6. `src/components/chat/TypingIndicator.jsx`

**Changes needed:**

1. **Accept props for status message:**
   - `message` - The current stage message (e.g., "Searching database...")
   - `progress` - Optional progress percentage
2. **Display the status message** instead of just "typing..."
3. **Optionally show a progress bar** based on the progress value

---

### 7. `src/App.jsx` or `src/main.jsx`

**Changes needed:**

1. **Initialize socket connection** when app loads
2. **Connect socket after user authentication**
3. **Disconnect socket on logout**

---

## Backend Route Needed

You need to add a chat route in your backend. Create/update:

### `src/api/routes/chat.js` (Backend)

```
POST /api/chat
Body: { query, conversationId, userId }
Response: { success, queryId, response, context, metadata }
```

### `src/app.js` (Backend)

- Import and register the chat routes: `app.use("/api/chat", chatRoutes)`

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User types message → ChatInput → ChatWindow.handleSend()       │
│                              │                                   │
│                              ▼                                   │
│                     POST /api/chat ────────────────────┐        │
│                              │                          │        │
│                              ▼                          │        │
│                    Receive { queryId }                  │        │
│                              │                          │        │
│                              ▼                          │        │
│         ┌─────── WebSocket Connection ◄─────────────────┤        │
│         │                                               │        │
│         │  Events received:                             │        │
│         │  • rag:progress { stage, message, progress }  │        │
│         │  • rag:complete { ... }                       │        │
│         │  • rag:error { ... }                          │        │
│         │                                               │        │
│         ▼                                               │        │
│  Update chatStore → TypingIndicator shows message       │        │
│         │                                               │        │
│         ▼                                               │        │
│  On rag:complete → Add AI message to messages[]         │        │
│                                                          │        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST /api/chat → chatService.chat()                            │
│         │                                                        │
│         ├─► Emit rag:progress (processing_query)                │
│         ├─► Emit rag:progress (creating_embedding)              │
│         ├─► Emit rag:progress (search_complete)                 │
│         ├─► Emit rag:progress (generating_response)             │
│         ├─► Emit rag:complete                                   │
│         │                                                        │
│         ▼                                                        │
│  Return { queryId, response, context, metadata }                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## WebSocket Events Reference

### RAG Pipeline Events

| Event | Payload | When |
|-------|---------|------|
| `rag:progress` | `{ queryId, stage, message, progress, timestamp }` | During each RAG stage |
| `rag:complete` | `{ queryId, stage, message, progress: 100, duration, documentsUsed }` | Query finished |
| `rag:error` | `{ queryId, error: { message, stage }, timestamp }` | Query failed |

### Gmail Sync Events

| Event | Payload | When |
|-------|---------|------|
| `sync:gmail:progress` | `{ syncId, status, phase, message, progress, timestamp }` | During sync |
| `sync:gmail:complete` | `{ syncId, status, message, summary, timestamp }` | Sync finished |
| `sync:gmail:error` | `{ syncId, error: { message, code }, timestamp }` | Sync failed |

---

## Progress Messages to Display

| Stage | Message | Progress |
|-------|---------|----------|
| `processing_query` | "Understanding your question..." | 10% |
| `creating_embedding` | "Creating semantic embedding..." | 20% |
| `search_complete` | "Found X relevant documents" | 50% |
| `formatting_context` | "Preparing context for response..." | 60% |
| `generating_response` | "Generating AI response..." | 70% |
| `finalizing` | "Finalizing response..." | 90% |
| `complete` | "Response ready" | 100% |

---

## Dependencies to Install (Frontend)

```bash
npm install socket.io-client
```

---

## Environment Variables (Frontend)

Add to your `.env` file:

```
VITE_API_URL=http://localhost:9000
VITE_WS_URL=http://localhost:9000
```

---

## Summary Checklist

| Task | File | Type |
|------|------|------|
| ☐ Install socket.io-client | package.json | Dependency |
| ☐ Create socket connection | `src/api/socket.js` | New |
| ☐ Create chat API | `src/api/chat.js` | New |
| ☐ Create socket hook | `src/hooks/useSocket.js` | New (optional) |
| ☐ Add RAG state | `src/store/chatStore.js` | Modify |
| ☐ Connect to backend API | `src/components/chat/ChatWindow.jsx` | Modify |
| ☐ Show progress messages | `src/components/chat/TypingIndicator.jsx` | Modify |
| ☐ Initialize socket on app load | `src/App.jsx` | Modify |
| ☐ Add chat route | Backend: `src/api/routes/chat.js` | New |
| ☐ Register chat route | Backend: `src/app.js` | Modify |

---

## Example Socket Connection (Reference)

```javascript
// src/api/socket.js
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_WS_URL || "http://localhost:9000";

export const socket = io(SOCKET_URL, {
  autoConnect: false, // Connect manually after auth
  query: {
    userId: null, // Set after authentication
  },
});

export const connectSocket = (userId) => {
  socket.io.opts.query = { userId };
  socket.connect();
};

export const disconnectSocket = () => {
  socket.disconnect();
};
```

---

## Example Chat API (Reference)

```javascript
// src/api/chat.js
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:9000";

export const chatApi = {
  sendMessage: async (query, conversationId = null) => {
    const token = localStorage.getItem("myra_auth_token");

    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, conversationId }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    return response.json();
  },
};
```

---

## Example Socket Hook (Reference)

```javascript
// src/hooks/useSocket.js
import { useEffect, useState } from "react";
import { socket } from "../api/socket";

export const useRAGProgress = () => {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const handleProgress = (data) => {
      setStatus(data.message);
      setProgress(data.progress);
      setIsProcessing(true);
    };

    const handleComplete = (data) => {
      setStatus("Response ready");
      setProgress(100);
      setIsProcessing(false);
    };

    const handleError = (data) => {
      setStatus(`Error: ${data.error.message}`);
      setIsProcessing(false);
    };

    socket.on("rag:progress", handleProgress);
    socket.on("rag:complete", handleComplete);
    socket.on("rag:error", handleError);

    return () => {
      socket.off("rag:progress", handleProgress);
      socket.off("rag:complete", handleComplete);
      socket.off("rag:error", handleError);
    };
  }, []);

  return { status, progress, isProcessing };
};
```
