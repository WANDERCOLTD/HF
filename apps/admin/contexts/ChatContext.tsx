"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { EntityBreadcrumb, useEntityContext } from "./EntityContext";

export type ChatMode = "DATA" | "TUNING";
export type ChatLayout = "vertical" | "horizontal" | "popout";
export type TuningScope = "LEARNER" | "PLAYBOOK";

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
  /**
   * Tuning tab scope toggle. Persisted in settings.
   *
   * #911 — widened to `TuningScope | null`. `null` means "no active scope —
   * the AI should ask fresh on the next turn". Reset to null whenever the
   * active entity's *type* changes (caller ↔ playbook ↔ neither) so a stale
   * PLAYBOOK toggle from a previous course page never leaks onto a caller
   * page and causes the AI to mis-attribute writes.
   */
  tuningScope: TuningScope | null;
  /**
   * #727 v1 — when set, every DATA-mode message includes this ticket's UUID
   * so the API can inject the ticket + comment thread into the system prompt.
   * Set by the Feedback view's "Discuss with AI" button. Not persisted —
   * lives only as long as the user is actively discussing the ticket.
   */
  discussionTicketId: string | null;
  discussionTicketNumber: number | null;
}

interface ChatActions {
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setMode: (mode: ChatMode) => void;
  setChatLayout: (layout: ChatLayout) => void;
  /**
   * Set the tuning scope. Accepts `null` to clear the active toggle so the
   * AI re-asks on the next turn (#911 — closes the stale-toggle hole).
   */
  setTuningScope: (scope: TuningScope | null) => void;
  /**
   * Set / clear the active ticket the Assistant should be discussing.
   * Pass `null` to clear (e.g. when closing the ticket detail panel).
   */
  setDiscussionTicket: (id: string | null, ticketNumber?: number | null) => void;
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
// Rolling trim, not an expiry. No TTL on chat history — persists until the
// user clears it explicitly (Clear button in header or /clear command).
// Matches Slack / ChatGPT / Linear conventions; localStorage cap (~5MB) is
// three orders of magnitude away from being hit at 50 × 2 modes × ~2KB.
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
    label: "Assistant",
    icon: "✦",
    color: "var(--accent-primary)",
    description: "Context-aware assistant with tools and parameter knowledge",
  },
  TUNING: {
    label: "Tuning",
    icon: "⚙",
    color: "var(--accent-primary)",
    description: "Tune behaviour parameters for one learner or the whole course",
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

function loadSettings(userId: string | undefined): { isOpen: boolean; mode: ChatMode; chatLayout: ChatLayout; tuningScope: TuningScope | null } {
  const defaults = { isOpen: false, mode: "DATA" as ChatMode, chatLayout: "vertical" as ChatLayout, tuningScope: "PLAYBOOK" as TuningScope | null };
  if (typeof window === "undefined") return defaults;
  try {
    const stored = localStorage.getItem(getSettingsKey(userId));
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    // #911 — persisted value may now be `null` (entity-type-transition reset).
    const scope: TuningScope | null =
      parsed.tuningScope === "LEARNER" || parsed.tuningScope === "PLAYBOOK"
        ? parsed.tuningScope
        : parsed.tuningScope === null
          ? null
          : "PLAYBOOK";
    return { isOpen: false, mode: "DATA", chatLayout: parsed.chatLayout || "vertical", tuningScope: scope };
  } catch {
    return defaults;
  }
}

function persistSettings(isOpen: boolean, mode: ChatMode, chatLayout: ChatLayout, tuningScope: TuningScope | null, userId: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getSettingsKey(userId), JSON.stringify({ isOpen, mode, chatLayout, tuningScope }));
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
  const [tuningScope, setTuningScopeState] = useState<TuningScope | null>("PLAYBOOK");
  const [messages, setMessages] = useState<Record<ChatMode, ChatMessage[]>>(createEmptyMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [lastUserId, setLastUserId] = useState<string | undefined>(undefined);
  const [discussionTicketId, setDiscussionTicketIdState] = useState<string | null>(null);
  const [discussionTicketNumber, setDiscussionTicketNumberState] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // #873 follow-up — queue of bidirectional reflections from the
  // PendingChangesTray. Each tray Save & apply / Discard dispatches a
  // window CustomEvent (see `components/shared/PendingChangesTray.tsx`)
  // that this ref captures. The next sendMessage forwards the queue
  // contents to `/api/chat` as `trayReflections`, then clears it. We
  // use a ref instead of state to avoid re-render churn for an event
  // queue that's only read at chat-send time.
  const trayReflectionsRef = useRef<unknown[]>([]);

  // Get entity context for including in messages
  const entityContext = useEntityContext();
  // #733 — route hint lets the chat API inject a small "Feedback list mode"
  // digest when the user is on /x/feedback without a specific ticket open.
  const pathname = usePathname();

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
      setTuningScopeState(settings.tuningScope);
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
      persistSettings(isOpen, mode, chatLayout, tuningScope, userId);
    }
  }, [isOpen, mode, chatLayout, tuningScope, initialized, userId]);

  // #911 — reset the tuning scope toggle whenever the *type* of the active
  // entity changes (caller → playbook, playbook → caller, either → none, or
  // any other type transition). This closes the "stale PLAYBOOK toggle on a
  // caller page" hole flagged in #911: without the reset, the AI carries the
  // previous course's scope onto a learner page and can mis-attribute writes.
  //
  // Intentionally NOT triggered when the entity stays the same type but the
  // entity id changes (caller A → caller B). That's a routine drill-down and
  // shouldn't drop the educator's prior toggle choice.
  const currentEntityType = entityContext.currentEntity?.type ?? null;
  const previousEntityTypeRef = useRef<typeof currentEntityType>(currentEntityType);
  useEffect(() => {
    if (!initialized) {
      // Don't fire during the initial hydration — `setTuningScopeState` on
      // mount would reset the user's persisted choice before they ever
      // toggled this session. We only react to *transitions* after settings
      // load.
      previousEntityTypeRef.current = currentEntityType;
      return;
    }
    const prev = previousEntityTypeRef.current;
    if (prev !== currentEntityType) {
      previousEntityTypeRef.current = currentEntityType;
      // Reset to null so the AI re-asks. We deliberately do NOT replace with
      // "PLAYBOOK" — null is the honest signal that no toggle was made for
      // this entity yet.
      setTuningScopeState(null);
    }
  }, [currentEntityType, initialized]);

  // #873 follow-up — subscribe to tray decision events. Each event
  // is pushed into `trayReflectionsRef`; the next `sendMessage` flushes
  // the queue to `/api/chat` as `trayReflections` and clears it.
  useEffect(() => {
    function onApplied(ev: Event) {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      trayReflectionsRef.current.push({ action: "applied", ...(detail as Record<string, unknown>) });
    }
    function onDiscarded(ev: Event) {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      trayReflectionsRef.current.push({ action: "discarded", ...(detail as Record<string, unknown>) });
    }
    window.addEventListener("hf:tray-applied", onApplied);
    window.addEventListener("hf:tray-discarded", onDiscarded);
    return () => {
      window.removeEventListener("hf:tray-applied", onApplied);
      window.removeEventListener("hf:tray-discarded", onDiscarded);
    };
  }, []);

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

  const setTuningScope = useCallback((scope: TuningScope | null) => {
    setTuningScopeState(scope);
  }, []);

  const setDiscussionTicket = useCallback((id: string | null, ticketNumber: number | null = null) => {
    setDiscussionTicketIdState(id);
    setDiscussionTicketNumberState(id ? ticketNumber : null);
    // Force DATA mode when starting a ticket discussion — TUNING wouldn't see
    // the ticket block (it's only injected on the DATA-mode prompt branch).
    if (id) setModeState("DATA");
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
              ...((mode === "DATA" || mode === "TUNING") && tuningScope ? { tuningScope } : {}),
              ...(mode === "DATA" && discussionTicketId ? { discussionTicketId } : {}),
              ...(pathname && (mode === "DATA" || mode === "TUNING") ? { pageHint: { route: pathname } } : {}),
              ...(mode === "DATA" && entityContext.pageContext?.page
                ? { pageContext: entityContext.pageContext }
                : {}),
            }),
          });

          const data = await response.json();
          updateMessage(assistantId, {
            content: data.message || data.error || "Command executed",
            metadata: { command: content.trim(), commandResult: data, isStreaming: false },
          });
          if (data?.action === "execute" && data?.data?.clearHistory) {
            const targetMode = data.data.clearHistory as ChatMode;
            setMessages((prev) => ({ ...prev, [targetMode]: [] }));
          }
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

        // #873 follow-up — flush + clear the tray reflection queue.
        // Drained per-send so each batch is delivered exactly once.
        const trayReflections = trayReflectionsRef.current;
        trayReflectionsRef.current = [];

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
              ...((mode === "DATA" || mode === "TUNING") && tuningScope ? { tuningScope } : {}),
              ...(mode === "DATA" && discussionTicketId ? { discussionTicketId } : {}),
              ...(pathname && (mode === "DATA" || mode === "TUNING") ? { pageHint: { route: pathname } } : {}),
              ...(mode === "DATA" && entityContext.pageContext?.page
                ? { pageContext: entityContext.pageContext }
                : {}),
              ...(trayReflections.length > 0 ? { trayReflections } : {}),
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

        // #873 — propagate AI-emitted pendingChange payloads to the
        // PendingChangesTray. ChatProvider lives outside the tray
        // Provider in the layout tree (tray reads chat state for its
        // position-aware right/bottom), so we dispatch a CustomEvent
        // here and let the tray Provider listen for it. Decoupling
        // avoids the circular Provider-ordering problem.
        const pendingChangesHeader = response.headers.get("X-Pending-Changes");
        if (pendingChangesHeader) {
          try {
            const parsed = JSON.parse(decodeURIComponent(pendingChangesHeader));
            if (Array.isArray(parsed)) {
              for (const payload of parsed) {
                window.dispatchEvent(
                  new CustomEvent("hf:pending-change", { detail: payload }),
                );
              }
            }
          } catch (err) {
            console.warn(
              "[chat] failed to parse X-Pending-Changes header:",
              err,
            );
          }
        }

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
    [mode, tuningScope, discussionTicketId, pathname, isStreaming, entityContext.breadcrumbs, entityContext.pageContext, messages, addMessage, updateMessage, appendToMessage]
  );

  const value: ChatContextValue = {
    // State
    isOpen,
    mode,
    chatLayout,
    tuningScope,
    discussionTicketId,
    discussionTicketNumber,
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
    setTuningScope,
    setDiscussionTicket,
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
