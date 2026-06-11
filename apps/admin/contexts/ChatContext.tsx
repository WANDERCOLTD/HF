"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { EntityBreadcrumb, useEntityContext } from "./EntityContext";

/**
 * #1504 Slice 3 — public ChatMode narrowed to the two tabs the operator
 * actually sees in the chat panel. Internal route-level execution modes
 * (CALL / BUG / WIZARD / COURSE_REF) are NOT in this union — they're
 * dispatched by route.ts based on entry point, not picked by a tab.
 *
 * Legacy persisted-history aliases:
 *   - "DATA"          → maps to ASSISTANT
 *   - "TUNING"        → already merged into DATA by the Slice 2 migration
 *   - "COURSE_MANAGE" → already merged into DATA by the Slice 2 migration
 *
 * The migration in `loadPersistedMessages` collapsed any TUNING /
 * COURSE_MANAGE arrays into the DATA bucket. Slice 3 then aliases the DATA
 * bucket → ASSISTANT on load, so the on-disk shape stays compatible with
 * the pre-Slice-3 storage written by older clients but the in-memory shape
 * is the new two-tab world.
 */
export type ChatMode = "ASSISTANT" | "DEMO";
export type ChatLayout = "vertical" | "horizontal" | "popout";
export type TuningScope = "LEARNER" | "PLAYBOOK";

/**
 * Legacy mode values that may appear in localStorage from pre-Slice-3
 * persisted writes. Exported so the route handler + commands layer can
 * accept both shapes during the transition window.
 */
export type LegacyChatMode = "DATA" | "TUNING" | "COURSE_MANAGE";

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
   *
   * #1504 Slice 3 — after the tab consolidation this toggle lives INSIDE
   * Assistant at all times (was previously only rendered when mode was
   * DATA or TUNING). It's the only way an operator can disambiguate
   * LEARNER vs PLAYBOOK scope for behaviour-target writes once the
   * Tuning tab is gone.
   */
  tuningScope: TuningScope | null;
  /**
   * #727 v1 — when set, every Assistant-mode message includes this ticket's
   * UUID so the API can inject the ticket + comment thread into the system
   * prompt. Set by the Feedback view's "Discuss with AI" button. Not
   * persisted — lives only as long as the user is actively discussing the
   * ticket.
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
// #1504 Slice 2 — per-user marker that the DATA/TUNING/COURSE_MANAGE histories
// have been merged into a single DATA stream (the runtime default tab).
// Idempotent: once set, subsequent loads short-circuit the merge logic and
// trust that the persisted shape is already collapsed.
const MIGRATION_FLAG_KEY_PREFIX = "hf.chat.history-migrated.v1504";
// #1504 Slice 2 — per-user marker that the one-time "history merged" banner
// has been shown + dismissed. Values: undefined (not yet eligible) | "pending"
// (set by the migration; ChatPanel renders the banner) | "shown" (user has
// dismissed; never shows again for this user).
const MERGED_BANNER_KEY_PREFIX = "hf.chat.history-merged-banner.v1504";
// #1504 Slice 3 — per-user marker for the "tabs simplified" one-time banner.
// Always shown once on first load after the consolidation, regardless of
// whether the user had legacy history (the change is operator-visible even
// for fresh installs because the 4-tab world is gone). Values: undefined
// (not yet seen) | "shown" (dismissed; never re-appears).
const TABS_COLLAPSED_BANNER_KEY_PREFIX = "hf.chat.tabs-collapsed-banner.v1504s3";
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

function getMigrationFlagKey(userId: string | undefined): string {
  return userId ? `${MIGRATION_FLAG_KEY_PREFIX}.${userId}` : MIGRATION_FLAG_KEY_PREFIX;
}

export function getMergedBannerKey(userId: string | undefined): string {
  return userId ? `${MERGED_BANNER_KEY_PREFIX}.${userId}` : MERGED_BANNER_KEY_PREFIX;
}

export function getTabsCollapsedBannerKey(userId: string | undefined): string {
  return userId
    ? `${TABS_COLLAPSED_BANNER_KEY_PREFIX}.${userId}`
    : TABS_COLLAPSED_BANNER_KEY_PREFIX;
}

// Mode display configuration. After Slice 3 only two visible tabs.
export const MODE_CONFIG: Record<ChatMode, { label: string; icon: string; color: string; description: string }> = {
  // #1504 Slice 3 — subsumes legacy DATA + TUNING + COURSE_MANAGE. The
  // unified-assistant builder routes intent based on entity context + the
  // sticky `tuningScope` toggle below the tabs. Backend prompts handled at
  // app/api/chat/route.ts via `buildUnifiedAssistantPrompt`.
  ASSISTANT: {
    label: "Assistant",
    icon: "✦",
    color: "var(--accent-primary)",
    description: "Context-aware assistant — tunes, edits, queries. Use the Scope toggle to target Learner or Course.",
  },
  // #1485 (Layer 3 Slice 4) — DEMO mode: scoped 5-tool palette for operators
  // driving a live demo. Wired in app/api/chat/route.ts:330 (DEMO branch +
  // DEMO_TOOLS filter + buildDemoSystemPrompt). Structurally distinct from
  // ASSISTANT — narrow palette, different conversational stance, safety
  // contracts (`fanoutScope:'none'`, `no-ai-fanout-all` ESLint).
  DEMO: {
    label: "Demo",
    icon: "▶",
    color: "var(--accent-primary)",
    description: "Remote control for live demos — narrow action palette (test voice, dry-run, apply preset)",
  },
};

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function createEmptyMessages(): Record<ChatMode, ChatMessage[]> {
  return {
    ASSISTANT: [],
    DEMO: [],
  };
}

/**
 * #1504 Slice 3 — public for routes / handlers that still emit legacy
 * mode strings. Maps the wide pre-Slice-3 union onto the narrowed two-tab
 * union. ASSISTANT round-trips identity.
 */
export function normalizeChatMode(input: string | undefined | null): ChatMode {
  if (input === "DEMO") return "DEMO";
  if (input === "ASSISTANT") return "ASSISTANT";
  // Pre-Slice-3 persisted aliases — all funnel into ASSISTANT because the
  // unified builder owns those intents post-Slice 2.
  if (input === "DATA" || input === "TUNING" || input === "COURSE_MANAGE") return "ASSISTANT";
  // Anything unrecognised — including CALL / BUG / WIZARD / COURSE_REF
  // which never land here from the panel — falls back to ASSISTANT so a
  // mis-typed setting can't strand the user on a nonexistent tab.
  return "ASSISTANT";
}

/**
 * #1504 Slice 2 — exported for unit tests so the migration shape can be
 * pinned without going through the full ChatProvider hydration cycle.
 *
 * #1504 Slice 3 — extended to alias legacy DATA / TUNING / COURSE_MANAGE
 * persisted keys onto the new ASSISTANT bucket. The Slice 2 migration
 * collapsed TUNING + COURSE_MANAGE → DATA; Slice 3 then reads DATA out as
 * ASSISTANT (and merges any straggler TUNING / COURSE_MANAGE entries from
 * pre-Slice-2 clients that wrote AFTER this user's last load).
 *
 * Idempotency: the v1504 sentinel from Slice 2 still gates the legacy
 * bucket re-merge; the Slice 3 alias-read is pure and always runs.
 *
 * Corrupt JSON / unparseable storage → returns empty state (graceful
 * fallback; never throws). Pre-existing CALL-key migration kept.
 */
export function loadPersistedMessages(userId: string | undefined): Record<ChatMode, ChatMessage[]> {
  if (typeof window === "undefined") return createEmptyMessages();
  // Helper — fired on any no-op return path (no storage / corrupt JSON / wrong
  // shape) so the per-user migration sentinel is set exactly once and we never
  // scan the same broken blob on every subsequent load.
  const markMigratedBestEffort = () => {
    try {
      localStorage.setItem(getMigrationFlagKey(userId), "1");
    } catch {
      // ignore
    }
  };
  try {
    const stored = localStorage.getItem(getStorageKey(userId));
    if (!stored) {
      markMigratedBestEffort();
      return createEmptyMessages();
    }
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") {
      markMigratedBestEffort();
      return createEmptyMessages();
    }
    // Convert timestamp strings back to Date objects (defensive on every key
    // we know about — both the canonical two-tab modes and the legacy ones
    // we still alias-read for backward compatibility).
    const knownKeys = ["ASSISTANT", "DATA", "TUNING", "COURSE_MANAGE", "DEMO"] as const;
    for (const key of knownKeys) {
      const bucket = parsed[key];
      if (Array.isArray(bucket)) {
        parsed[key] = bucket.map((msg: ChatMessage) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
      }
    }

    const alreadyMigrated = localStorage.getItem(getMigrationFlagKey(userId)) === "1";

    // #1504 Slice 3 — build the new two-tab in-memory shape. ASSISTANT
    // absorbs the post-Slice-2 DATA bucket plus any straggler legacy
    // buckets that might have been written by a client that bypassed the
    // Slice 2 migration (e.g. an offline tab opened before Slice 2 shipped
    // and saved after).
    const result = createEmptyMessages();

    const retagToAssistant = (m: ChatMessage): ChatMessage => ({ ...m, mode: "ASSISTANT" });

    const assistantBucket = Array.isArray(parsed.ASSISTANT) ? (parsed.ASSISTANT as ChatMessage[]) : [];
    const dataBucket = Array.isArray(parsed.DATA) ? (parsed.DATA as ChatMessage[]) : [];
    const tuningBucket = Array.isArray(parsed.TUNING) ? (parsed.TUNING as ChatMessage[]) : [];
    const courseManageBucket = Array.isArray(parsed.COURSE_MANAGE)
      ? (parsed.COURSE_MANAGE as ChatMessage[])
      : [];

    // Merge by timestamp so a chronological scroll-back stays coherent
    // even when legacy clients interleaved writes across two buckets.
    const mergedAssistant = [
      ...assistantBucket.map(retagToAssistant),
      ...dataBucket.map(retagToAssistant),
      ...tuningBucket.map(retagToAssistant),
      ...courseManageBucket.map(retagToAssistant),
    ].sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
      return ta - tb;
    });
    result.ASSISTANT = mergedAssistant.slice(-MAX_MESSAGES_PER_MODE);

    if (Array.isArray(parsed.DEMO)) {
      result.DEMO = parsed.DEMO as ChatMessage[];
    }

    // #1504 Slice 2 — one-time banner trigger for users whose legacy
    // TUNING / COURSE_MANAGE buckets contained at least one message. Slice
    // 3 inherits this banner unchanged because the user-visible message
    // ("Chat history merged across modes") still describes what happened.
    if (!alreadyMigrated) {
      const hadLegacy = tuningBucket.length + courseManageBucket.length > 0;
      if (hadLegacy) {
        try {
          localStorage.setItem(getMergedBannerKey(userId), "pending");
        } catch {
          // ignore — banner is a nice-to-have, not load-bearing
        }
      }
      try {
        localStorage.setItem(getMigrationFlagKey(userId), "1");
      } catch {
        // ignore — migration sentinel is best-effort; the merge already
        // happened in memory and will be re-persisted on the next save.
      }
    }

    return result;
  } catch {
    // Corrupt JSON / unparseable storage. Mark as migrated so we don't
    // re-attempt the merge against the same broken blob on every load.
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(getMigrationFlagKey(userId), "1");
      }
    } catch {
      // ignore
    }
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
  const defaults = { isOpen: false, mode: "ASSISTANT" as ChatMode, chatLayout: "vertical" as ChatLayout, tuningScope: "PLAYBOOK" as TuningScope | null };
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
    // #1504 Slice 3 — narrow persisted `mode` onto the two-tab union via
    // the canonical normaliser. Any legacy DATA / TUNING / COURSE_MANAGE
    // setting maps to ASSISTANT; anything unrecognised falls back the
    // same way (safer than stranding the user on a missing tab).
    const mode = normalizeChatMode(parsed.mode);
    return { isOpen: false, mode, chatLayout: parsed.chatLayout || "vertical", tuningScope: scope };
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
  const [mode, setModeState] = useState<ChatMode>("ASSISTANT");
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
    // Force ASSISTANT mode when starting a ticket discussion — DEMO doesn't
    // see the ticket block (it's only injected on the unified Assistant
    // prompt branch).
    if (id) setModeState("ASSISTANT");
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
              ...(mode === "ASSISTANT" && tuningScope ? { tuningScope } : {}),
              ...(mode === "ASSISTANT" && discussionTicketId ? { discussionTicketId } : {}),
              ...(pathname ? { pageHint: { route: pathname } } : {}),
              ...(entityContext.pageContext?.page ? { pageContext: entityContext.pageContext } : {}),
            }),
          });

          const data = await response.json();
          updateMessage(assistantId, {
            content: data.message || data.error || "Command executed",
            metadata: { command: content.trim(), commandResult: data, isStreaming: false },
          });
          if (data?.action === "execute" && data?.data?.clearHistory) {
            const targetMode = normalizeChatMode(data.data.clearHistory);
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
              ...(mode === "ASSISTANT" && tuningScope ? { tuningScope } : {}),
              ...(mode === "ASSISTANT" && discussionTicketId ? { discussionTicketId } : {}),
              ...(pathname ? { pageHint: { route: pathname } } : {}),
              ...(entityContext.pageContext?.page ? { pageContext: entityContext.pageContext } : {}),
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
