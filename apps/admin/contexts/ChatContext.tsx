"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { EntityBreadcrumb, useEntityContext } from "./EntityContext";

export type ChatMode = "DATA" | "TUNING";
export type ChatLayout = "vertical" | "horizontal" | "popout";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  mode: ChatMode;
  metadata?: {
    command?: string;
    commandResult?: unknown;
    entityContext?: EntityBreadcrumb[];
    isStreaming?: boolean;
    error?: string;
    toolCalls?: number;
  };
}

interface ChatState {
  isOpen: boolean;
  mode: ChatMode;
  chatLayout: ChatLayout;
  messages: Record<ChatMode, ChatMessage[]>;
  isStreaming: boolean;
  streamingMessageId: string | null;
  error: string | null;
}

interface ChatActions {
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setMode: (mode: ChatMode) => void;
  setChatLayout: (layout: ChatLayout) => void;
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, content: string) => void;
  clearHistory: (mode?: ChatMode) => void;
  cancelStream: () => void;
  setError: (error: string | null) => void;
}

type ChatContextValue = ChatState & ChatActions;

const ChatContext = createContext<ChatContextValue | null>(null);

const STORAGE_KEY_PREFIX = "hf.chat.history";
const SETTINGS_KEY_PREFIX = "hf.chat.settings";
const MAX_MESSAGES_PER_MODE = 50;

function getStorageKey(userId: string | undefined): string {
  return userId ? `${STORAGE_KEY_PREFIX}.${userId}` : STORAGE_KEY_PREFIX;
}

function getSettingsKey(userId: string | undefined): string {
  return userId ? `${SETTINGS_KEY_PREFIX}.${userId}` : SETTINGS_KEY_PREFIX;
}

// Mode display configuration
export const MODE_CONFIG: Record<ChatMode, { label: string; icon: string; color: string; description: string }> = {
  DATA: {
    label: "Data",
    icon: "📊",
    color: "var(--status-success-text)",
    description: "Context-aware data exploration",
  },
  TUNING: {
    label: "Tuner",
    icon: "🔧",
    color: "var(--accent-primary)",
    description: "Course parameter guidance",
  },
};

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function createEmptyMessages(): Record<ChatMode, ChatMessage[]> {
  return {
    DATA: [],
    TUNING: [],
  };
}

function loadPersistedMessages(userId: string | undefined): Record<ChatMode, ChatMessage[]> {
  if (typeof window === "undefined") return createEmptyMessages();
  try {
    const stored = localStorage.getItem(getStorageKey(userId));
    if (!stored) return createEmptyMessages();
    const parsed = JSON.parse(stored);
    // Convert timestamp strings back to Date objects
    for (const mode of Object.keys(parsed) as ChatMode[]) {
      if (parsed[mode]) {
        parsed[mode] = parsed[mode].map((msg: ChatMessage) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
      }
    }
    // Ensure all modes exist (handle migration from old storage with CALL)
    const result = createEmptyMessages();
    for (const mode of Object.keys(result) as ChatMode[]) {
      if (parsed[mode]) {
        result[mode] = parsed[mode];
      }
    }
    return result;
  } catch {
    return createEmptyMessages();
  }
}

function persistMessages(messages: Record<ChatMode, ChatMessage[]>, userId: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    // Trim to max messages per mode
    const trimmed: Record<string, ChatMessage[]> = {};
    for (const [mode, msgs] of Object.entries(messages)) {
      trimmed[mode] = msgs.slice(-MAX_MESSAGES_PER_MODE);
    }
    localStorage.setItem(getStorageKey(userId), JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}

function loadSettings(userId: string | undefined): { isOpen: boolean; mode: ChatMode; chatLayout: ChatLayout } {
  if (typeof window === "undefined") return { isOpen: false, mode: "DATA", chatLayout: "vertical" };
  try {
    const stored = localStorage.getItem(getSettingsKey(userId));
    if (!stored) return { isOpen: false, mode: "DATA", chatLayout: "vertical" };
    const parsed = JSON.parse(stored);
    return { isOpen: false, mode: "DATA", chatLayout: parsed.chatLayout || "vertical" };
  } catch {
    return { isOpen: false, mode: "DATA", chatLayout: "vertical" };
  }
}

function persistSettings(isOpen: boolean, mode: ChatMode, chatLayout: ChatLayout, userId: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getSettingsKey(userId), JSON.stringify({ isOpen, mode, chatLayout }));
  } catch {
    // Ignore storage errors
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setModeState] = useState<ChatMode>("DATA");
  const [chatLayout, setChatLayoutState] = useState<ChatLayout>("vertical");
  const [messages, setMessages] = useState<Record<ChatMode, ChatMessage[]>>(createEmptyMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [lastUserId, setLastUserId] = useState<string | undefined>(undefined);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Get entity context for including in messages
  const entityContext = useEntityContext();

  // Load persisted state on mount or when user changes
  useEffect(() => {
    // Skip if userId hasn't been determined yet (session loading)
    if (session === undefined) return;

    // If user changed, reload their data
    if (userId !== lastUserId) {
      const persistedMessages = loadPersistedMessages(userId);
      const settings = loadSettings(userId);
      setMessages(persistedMessages);
      setIsOpen(settings.isOpen);
      setModeState(settings.mode);
      setChatLayoutState(settings.chatLayout);
      setLastUserId(userId);
      setInitialized(true);
    }
  }, [userId, lastUserId, session]);

  // Persist messages when they change
  useEffect(() => {
    if (initialized) {
      persistMessages(messages, userId);
    }
  }, [messages, initialized, userId]);

  // Persist settings when they change
  useEffect(() => {
    if (initialized) {
      persistSettings(isOpen, mode, chatLayout, userId);
    }
  }, [isOpen, mode, chatLayout, initialized, userId]);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const openPanel = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setMode = useCallback((newMode: ChatMode) => {
    setModeState(newMode);
    setError(null);
  }, []);

  const setChatLayout = useCallback((layout: ChatLayout) => {
    setChatLayoutState(layout);
  }, []);

  const addMessage = useCallback((message: Omit<ChatMessage, "id" | "timestamp">): string => {
    const id = generateId();
    const fullMessage: ChatMessage = {
      ...message,
      id,
      timestamp: new Date(),
    };
    setMessages((prev) => ({
      ...prev,
      [message.mode]: [...prev[message.mode], fullMessage],
    }));
    return id;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => {
      const newMessages = { ...prev };
      for (const m of Object.keys(newMessages) as ChatMode[]) {
        const index = newMessages[m].findIndex((msg) => msg.id === id);
        if (index >= 0) {
          newMessages[m] = [...newMessages[m]];
          newMessages[m][index] = { ...newMessages[m][index], ...updates };
          break;
        }
      }
      return newMessages;
    });
  }, []);

  const appendToMessage = useCallback((id: string, content: string) => {
    setMessages((prev) => {
      const newMessages = { ...prev };
      for (const m of Object.keys(newMessages) as ChatMode[]) {
        const index = newMessages[m].findIndex((msg) => msg.id === id);
        if (index >= 0) {
          newMessages[m] = [...newMessages[m]];
          newMessages[m][index] = {
            ...newMessages[m][index],
            content: newMessages[m][index].content + content,
          };
          break;
        }
      }
      return newMessages;
    });
  }, []);

  const clearHistory = useCallback((modeToDelete?: ChatMode) => {
    if (modeToDelete) {
      setMessages((prev) => ({
        ...prev,
        [modeToDelete]: [],
      }));
    } else {
      setMessages(createEmptyMessages());
    }
  }, []);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setStreamingMessageId(null);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      if (isStreaming) return;

      setError(null);

      // Add user message
      addMessage({
        role: "user",
        content: content.trim(),
        mode,
        metadata: {
          entityContext: entityContext.breadcrumbs,
        },
      });

      // Check if this is a command
      if (content.trim().startsWith("/")) {
        // Handle commands via server
        const assistantId = addMessage({
          role: "assistant",
          content: "",
          mode,
          metadata: { command: content.trim(), isStreaming: true },
        });

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: content.trim(),
              mode,
              entityContext: entityContext.breadcrumbs,
              isCommand: true,
            }),
          });

          const data = await response.json();
          updateMessage(assistantId, {
            content: data.message || data.error || "Command executed",
            metadata: { command: content.trim(), commandResult: data, isStreaming: false },
          });
        } catch (err) {
          updateMessage(assistantId, {
            content: `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`,
            metadata: { command: content.trim(), isStreaming: false, error: "command_error" },
          });
        }
        return;
      }

      // Create assistant message placeholder for streaming
      const assistantId = addMessage({
        role: "assistant",
        content: "",
        mode,
        metadata: { isStreaming: true },
      });

      setIsStreaming(true);
      setStreamingMessageId(assistantId);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        // Get conversation history for context
        const history = messages[mode].slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let response: Response;
        try {
          response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: content.trim(),
              mode,
              entityContext: entityContext.breadcrumbs,
              conversationHistory: history,
            }),
            signal: abortControllerRef.current.signal,
          });
        } catch (fetchErr) {
          // Network error (e.g., "Load failed" in Safari, "Failed to fetch" in Chrome)
          throw new Error(
            fetchErr instanceof Error && fetchErr.message === "Load failed"
              ? "Failed to connect to chat API. Please check that the server is running."
              : `Network error: ${fetchErr instanceof Error ? fetchErr.message : "Unknown"}`
          );
        }

        if (!response.ok) {
          // Try to parse JSON error response for better messaging
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        // Track accumulated content for guidance parsing
        let accumulatedContent = "";

        // Check if response is streaming
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("text/plain")) {
          // Streaming response
          const reader = response.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let done = false;

          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              accumulatedContent += chunk;
              appendToMessage(assistantId, chunk);
            }
          }
        } else {
          // JSON response (non-streaming fallback)
          const data = await response.json();
          accumulatedContent = data.content || data.message || "";
          updateMessage(assistantId, { content: accumulatedContent });
        }

        // Capture tool call count from response header
        const toolCallsHeader = response.headers.get("X-Tool-Calls");
        const toolCalls = toolCallsHeader ? parseInt(toolCallsHeader, 10) : undefined;

        updateMessage(assistantId, {
          metadata: { isStreaming: false, entityContext: entityContext.breadcrumbs, toolCalls },
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          updateMessage(assistantId, {
            content: messages[mode].find((m) => m.id === assistantId)?.content + "\n\n[Cancelled]",
            metadata: { isStreaming: false },
          });
        } else {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          setError(errorMessage);
          updateMessage(assistantId, {
            content: `⚠️ ${errorMessage}`,
            metadata: { isStreaming: false, error: errorMessage },
          });
        }
      } finally {
        setIsStreaming(false);
        setStreamingMessageId(null);
        abortControllerRef.current = null;
      }
    },
    [mode, isStreaming, entityContext.breadcrumbs, messages, addMessage, updateMessage, appendToMessage]
  );

  const value: ChatContextValue = {
    // State
    isOpen,
    mode,
    chatLayout,
    messages,
    isStreaming,
    streamingMessageId,
    error,
    // Actions
    togglePanel,
    openPanel,
    closePanel,
    setMode,
    setChatLayout,
    sendMessage,
    addMessage,
    updateMessage,
    appendToMessage,
    clearHistory,
    cancelStream,
    setError,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

// Hook for keyboard shortcut to toggle chat
export function useChatKeyboardShortcut() {
  const { togglePanel } = useChatContext();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to toggle chat
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        togglePanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePanel]);
}
