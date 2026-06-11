"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "next-auth/react";
import { useChatContext, MODE_CONFIG, getMergedBannerKey, type ChatMode, type TuningScope } from "@/contexts/ChatContext";
import { useEntityContext, ENTITY_COLORS, EntityBreadcrumb } from "@/contexts/EntityContext";
import { useEntityDetection } from "@/hooks/useEntityDetection";
import { AIModelBadge } from "@/components/shared/AIModelBadge";
import { CollapsedTabsBanner } from "./CollapsedTabsBanner";
import "./chat-panel.css";

// User-facing labels for entity types (internal names → educator language)
const ENTITY_LABELS: Record<string, string> = {
  playbook: "Course",
  domain: "Institution",
  caller: "Learner",
  spec: "Spec",
  call: "Session",
};

// Sub-components
function ChatBreadcrumbStripe({
  breadcrumbs,
  hideTypes,
}: {
  breadcrumbs: EntityBreadcrumb[];
  /**
   * Types to hide from the stripe. Used by DATA + TUNING modes to suppress
   * caller + playbook chips that the Scope toggle already shows above,
   * while still surfacing drill-down chips like Call / Memory / Spec.
   */
  hideTypes?: ReadonlyArray<EntityBreadcrumb["type"]>;
}) {
  const { clearToEntity } = useEntityContext();

  // Deduplicate breadcrumbs by ID (keep first occurrence), then filter out
  // types the parent doesn't want re-displayed.
  const uniqueBreadcrumbs = breadcrumbs
    .filter((crumb, index, self) => self.findIndex((c) => c.id === crumb.id) === index)
    .filter((crumb) => !hideTypes?.includes(crumb.type));

  if (uniqueBreadcrumbs.length === 0) {
    // When hideTypes is set (DATA/TUNING modes), absence of drill-down
    // chips is normal — the Scope toggle already shows context. Render
    // nothing instead of the "No context selected" empty state.
    if (hideTypes && hideTypes.length > 0) return null;
    return (
      <div className="chat-breadcrumb-empty">
        No context selected - navigate to a caller or call to add context
      </div>
    );
  }

  return (
    <div className="chat-breadcrumb-stripe">
      {uniqueBreadcrumbs.map((crumb, i) => {
        const colors = ENTITY_COLORS[crumb.type];
        return (
          <React.Fragment key={crumb.id}>
            {i > 0 && <span className="chat-breadcrumb-sep">›</span>}
            <button
              onClick={() => clearToEntity(crumb.id)}
              className="chat-breadcrumb-btn"
              style={{
                background: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
              title={`Click to clear context after ${crumb.label}`}
            >
              {ENTITY_LABELS[crumb.type] || crumb.type}: {crumb.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}


function ChatModeTabs() {
  const { mode, setMode } = useChatContext();
  const modes = Object.keys(MODE_CONFIG) as ChatMode[];
  // #1504 Slice 3 — explicit two-tab modifier so the CSS can give each tab
  // a balanced share of the strip width (default flex layout left them
  // bunched on the left of a 400px panel). If MODE_CONFIG ever grows back
  // to 3+ tabs the modifier auto-disappears.
  const tabsClass =
    modes.length === 2 ? "chat-mode-tabs chat-mode-tabs--two-tab" : "chat-mode-tabs";
  return (
    <div className={tabsClass} role="tablist">
      {modes.map((m) => {
        const cfg = MODE_CONFIG[m];
        const isActive = m === mode;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={isActive}
            className={`chat-mode-tab${isActive ? " chat-mode-tab--active" : ""}`}
            onClick={() => setMode(m)}
            title={cfg.description}
          >
            <span className="chat-mode-tab-icon">{cfg.icon}</span>
            <span className="chat-mode-tab-label">{cfg.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TuningScopeToggle() {
  const { tuningScope, setTuningScope } = useChatContext();
  const { breadcrumbs } = useEntityContext();
  const caller = breadcrumbs.find((b) => b.type === "caller");
  const playbook = breadcrumbs.find((b) => b.type === "playbook");
  const learnerDisabled = !caller;
  const courseDisabled = !playbook;
  const hasAutoPicked = React.useRef(false);

  // Auto-pick on entry: prefer LEARNER when a caller is in context,
  // otherwise PLAYBOOK. Only fires once per session — after that the
  // user owns the toggle.
  React.useEffect(() => {
    if (hasAutoPicked.current) return;
    if (caller && tuningScope !== "LEARNER") {
      setTuningScope("LEARNER");
      hasAutoPicked.current = true;
    } else if (!caller && tuningScope !== "PLAYBOOK") {
      setTuningScope("PLAYBOOK");
      hasAutoPicked.current = true;
    }
  }, [caller, tuningScope, setTuningScope]);

  // Safety: if scope=LEARNER but no caller available, fall back to PLAYBOOK
  React.useEffect(() => {
    if (tuningScope === "LEARNER" && learnerDisabled) {
      setTuningScope("PLAYBOOK");
    }
  }, [tuningScope, learnerDisabled, setTuningScope]);

  const handlePick = (scope: TuningScope) => {
    if (scope === "LEARNER" && learnerDisabled) return;
    if (scope === "PLAYBOOK" && courseDisabled) return;
    setTuningScope(scope);
  };

  return (
    <div className="chat-tuning-scope" role="radiogroup" aria-label="Tuning scope">
      <span className="chat-tuning-scope-label">Scope:</span>
      <button
        type="button"
        role="radio"
        aria-checked={tuningScope === "LEARNER"}
        disabled={learnerDisabled}
        className={`chat-tuning-scope-btn${tuningScope === "LEARNER" ? " chat-tuning-scope-btn--active" : ""}`}
        title={learnerDisabled ? "Navigate to a learner to enable Learner scope" : `Apply to ${caller?.label}`}
        onClick={() => handlePick("LEARNER")}
      >
        Learner{caller ? `: ${caller.label}` : ""}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={tuningScope === "PLAYBOOK"}
        disabled={courseDisabled}
        className={`chat-tuning-scope-btn${tuningScope === "PLAYBOOK" ? " chat-tuning-scope-btn--active" : ""}`}
        title={courseDisabled ? "Navigate to a course to enable Course scope" : `Apply to ${playbook?.label}`}
        onClick={() => handlePick("PLAYBOOK")}
      >
        Course{playbook ? `: ${playbook.label}` : ""}
      </button>
    </div>
  );
}

/**
 * #1504 Slice 2 — one-time information banner shown after the
 * `loadPersistedMessages` migration collapsed legacy TUNING + COURSE_MANAGE
 * histories into the DATA stream. Rendered only when localStorage carries
 * the "pending" sentinel; dismissing flips the sentinel to "shown" so the
 * banner never reappears for this user.
 *
 * Uses `hf-banner hf-banner-info` design-system tokens — no inline colours.
 */
function HistoryMergedBanner() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const state = window.localStorage.getItem(getMergedBannerKey(userId));
      setVisible(state === "pending");
    } catch {
      // ignore — banner is non-essential
    }
  }, [userId]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(getMergedBannerKey(userId), "shown");
      }
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div className="hf-banner hf-banner-info chat-merge-banner" role="status">
      <span>
        Chat history merged across modes — let us know if anything looks off.
      </span>
      <button
        type="button"
        className="chat-merge-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss merge notice"
      >
        Got it
      </button>
    </div>
  );
}

/**
 * #727 v1 — when the user clicks "Discuss with AI" on a feedback ticket,
 * show a thin stripe inside the Assistant tab so they remember the assistant
 * is loaded with that ticket as context. Click "clear" to drop the ticket.
 */
function DiscussingTicketStripe() {
  const { discussionTicketId, discussionTicketNumber, setDiscussionTicket } = useChatContext();
  if (!discussionTicketId) return null;
  return (
    <div className="chat-ticket-stripe" role="status" aria-label="Discussing ticket">
      <span className="chat-ticket-stripe-label">
        ✦ Discussing ticket{discussionTicketNumber ? ` #${discussionTicketNumber}` : ""}
      </span>
      <button
        type="button"
        className="chat-ticket-stripe-clear"
        onClick={() => setDiscussionTicket(null)}
        title="Stop discussing this ticket"
        aria-label="Stop discussing this ticket"
      >
        clear
      </button>
    </div>
  );
}

function ChatMessages() {
  const { messages, mode, isStreaming, streamingMessageId } = useChatContext();
  const currentMessages = messages[mode];
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  if (currentMessages.length === 0) {
    const config = MODE_CONFIG[mode];
    return (
      <div className="chat-empty">
        <span className="chat-empty-icon">{config.icon}</span>
        <p className="chat-empty-title">
          {config.label} Mode
        </p>
        <p className="chat-empty-desc">{config.description}</p>
        <p className="chat-empty-hint">
          Type a message or use /help for commands
        </p>
      </div>
    );
  }

  return (
    <div className="chat-messages">
      {currentMessages.map((msg) => {
        const isUser = msg.role === "user";
        const isCurrentStreaming = isStreaming && msg.id === streamingMessageId;
        const hasError = msg.metadata?.error;
        const toolCalls = msg.metadata?.toolCalls;

        const bubbleClass = isUser
          ? "chat-bubble chat-bubble--user"
          : hasError
            ? "chat-bubble chat-bubble--error"
            : "chat-bubble chat-bubble--assistant";

        return (
          <div
            key={msg.id}
            className={`chat-msg ${isUser ? "chat-msg--user" : "chat-msg--assistant"}`}
          >
            {/* Tool usage indicator */}
            {!isUser && toolCalls && toolCalls > 0 && (
              <div className="chat-tool-indicator">
                <span className="chat-tool-indicator-icon">&#x1F527;</span>
                <span>Used {toolCalls} tool{toolCalls > 1 ? "s" : ""}</span>
              </div>
            )}
            <div className={bubbleClass}>
              {isUser ? (
                msg.content || ""
              ) : (
                <div className="chat-markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: ({ children }) => <div>{children}</div>,
                      code: ({ children, className }) => {
                        const isBlock = className?.includes("language-");
                        return (
                          <code className={isBlock ? "chat-code-block" : "chat-code-inline"}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {msg.content || (isCurrentStreaming ? "..." : "")}
                  </ReactMarkdown>
                </div>
              )}
              {isCurrentStreaming && (
                <span className="chat-cursor" />
              )}
            </div>
            <div className={`chat-timestamp ${isUser ? "chat-timestamp--user" : "chat-timestamp--assistant"}`}>
              {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {msg.metadata?.command && (
                <span className="chat-timestamp-command">{msg.metadata.command}</span>
              )}
              {/* #1504 Slice 3 — ASSISTANT routes through the unified
                  Assistant builder server-side, which registers under the
                  `chat.unified_assistant` call-point. DEMO keeps its own
                  call-point. The pre-Slice-3 mode→callpoint string
                  (`chat.data` / `chat.tuning` / `chat.course_manage`) no
                  longer matches any registered AI config because route.ts
                  collapsed those branches in Slice 2. */}
              {!isUser && (
                <AIModelBadge
                  callPoint={mode === "DEMO" ? "chat.demo" : "chat.unified_assistant"}
                  variant="text"
                  size="sm"
                />
              )}
            </div>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatInput() {
  const { sendMessage, isStreaming, cancelStream, mode } = useChatContext();
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;
    const message = input;
    setInput("");
    await sendMessage(message);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const config = MODE_CONFIG[mode];

  return (
    <form onSubmit={handleSubmit} className="chat-input-form">
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${config.label}... (or /help)`}
          disabled={isStreaming}
          className="chat-textarea"
          rows={1}
        />
        {isStreaming ? (
          <button type="button" onClick={cancelStream} className="chat-stop-btn">
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="chat-send-btn"
            style={input.trim() ? { background: config.color } : undefined}
          >
            Send
          </button>
        )}
      </div>
      <div className="chat-input-hint">
        Press Enter to send, Shift+Enter for new line
      </div>
    </form>
  );
}

export function ChatPanel() {
  const { isOpen, closePanel, mode, chatLayout, setChatLayout, messages, clearHistory } = useChatContext();
  const { breadcrumbs } = useEntityContext();
  const { data: session } = useSession();

  // Cmd+K shortcut is registered by GlobalAssistant (avoids double-toggle)

  // Esc key closes the panel
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, closePanel]);

  // Auto-detect entities from URL
  useEntityDetection();

  const modeConfig = MODE_CONFIG[mode];

  const layoutLabels: Record<string, { icon: string; title: string }> = {
    vertical: { icon: "│", title: "Vertical (sidebar)" },
    horizontal: { icon: "─", title: "Horizontal (bottom)" },
    popout: { icon: "⧉", title: "Popout (floating)" },
  };

  const cycleLayout = () => {
    const layouts: Array<"vertical" | "horizontal" | "popout"> = ["vertical", "horizontal", "popout"];
    const idx = layouts.indexOf(chatLayout);
    setChatLayout(layouts[(idx + 1) % layouts.length]);
  };

  const handleClearClick = () => {
    const userId = session?.user?.id;
    // Source of truth is localStorage["hf.chat.history.${userId}"] — read it
    // here so the confirm dialog reflects what's persisted, not in-memory
    // staging that may differ during a stream.
    let count = messages[mode]?.length ?? 0;
    let earliestIso: string | null = null;
    if (typeof window !== "undefined") {
      try {
        const key = userId ? `hf.chat.history.${userId}` : "hf.chat.history";
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed?.[mode]) ? parsed[mode] : [];
          count = arr.length;
          if (arr.length > 0 && arr[0]?.timestamp) {
            earliestIso = arr[0].timestamp;
          }
        }
      } catch {
        // Fall back to in-memory counts; non-fatal.
      }
    }
    if (count === 0) {
      // Nothing to clear — no-op rather than a confusing dialog.
      return;
    }
    const since = earliestIso ? new Date(earliestIso).toLocaleString() : "the start";
    const ok = window.confirm(
      `Clear ${count} message${count === 1 ? "" : "s"} from ${mode} mode (since ${since})?`
    );
    if (!ok) return;
    clearHistory(mode);
  };

  const panelClass = `chat-panel chat-panel--${chatLayout}${isOpen ? " chat-panel--open" : ""}`;
  const headerClass = `chat-header${chatLayout === "popout" ? " chat-header--popout" : ""}`;

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div onClick={closePanel} className="chat-backdrop" />
      )}

      {/* Panel */}
      <div className={panelClass}>
        {/* Header */}
        <div className={headerClass}>
          <div className="chat-header-left">
            <span className="chat-header-icon">{modeConfig.icon}</span>
            <div>
              <div className="chat-header-title">AI Assistant</div>
              <div className="chat-header-subtitle">{modeConfig.description}</div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button
              onClick={handleClearClick}
              className="chat-header-btn chat-header-btn--clear"
              title={`Clear ${mode} chat history`}
              aria-label={`Clear ${mode} chat history`}
              disabled={(messages[mode]?.length ?? 0) === 0}
            >
              ⌫
            </button>
            <button
              onClick={cycleLayout}
              className="chat-header-btn chat-header-btn--layout"
              title={`Layout: ${layoutLabels[chatLayout].title} (click to change)`}
            >
              {layoutLabels[chatLayout].icon}
            </button>
            <button
              onClick={closePanel}
              className="chat-header-btn chat-header-btn--close"
              title="Close (Cmd+K)"
            >
              ×
            </button>
          </div>
        </div>

        {/* AI Chat Interface */}
        <>
          {/* #1504 Slice 2 — one-time history-merged banner (legacy bucket merge) */}
          <HistoryMergedBanner />

          {/* #1504 Slice 3 — one-time tabs-simplified banner. Independent of
              the Slice 2 banner because the visible tab change is operator-
              relevant for fresh installs too (the 4-tab world is gone). */}
          <CollapsedTabsBanner />

          {/* Mode tabs — post-Slice-3: Assistant + Demo only */}
          <ChatModeTabs />

          {/* #1504 Slice 3 — Scope toggle now lives inline inside the
              Assistant tab at all times. Pre-Slice-3 it was gated on
              `mode === DATA || mode === TUNING`; with the Tuning tab gone,
              gating it on "DATA-or-TUNING" would hide it entirely and
              strand the operator with no way to disambiguate LEARNER vs
              PLAYBOOK scope before a behaviour-target write. Hidden on
              the DEMO tab — DEMO has its own write-safety contract
              (narrow palette, `fanoutScope:'none'`) and tuning scope is
              not relevant there. */}
          {mode === "ASSISTANT" && <TuningScopeToggle />}

          {/* Active ticket stripe (only in ASSISTANT mode when a discussion
              is active — DEMO doesn't see the ticket block). */}
          {mode === "ASSISTANT" && <DiscussingTicketStripe />}

          {/* Context Breadcrumbs — in ASSISTANT mode the Scope toggle above
              already shows caller + playbook, so hide those types to avoid
              duplicate display. Drill-down chips (Call, Memory, Spec, etc.)
              still render here. */}
          <ChatBreadcrumbStripe
            breadcrumbs={breadcrumbs}
            hideTypes={mode === "ASSISTANT" ? ["caller", "playbook"] : undefined}
          />

          {/* Messages */}
          <ChatMessages />

          {/* Input */}
          <ChatInput />
        </>
      </div>
    </>
  );
}
