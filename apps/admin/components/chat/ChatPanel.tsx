"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatContext, MODE_CONFIG, type ChatMode } from "@/contexts/ChatContext";
import { useEntityContext, ENTITY_COLORS, EntityBreadcrumb } from "@/contexts/EntityContext";
import { useEntityDetection } from "@/hooks/useEntityDetection";
import { AIModelBadge } from "@/components/shared/AIModelBadge";
import "./chat-panel.css";

// Sub-components
function ChatBreadcrumbStripe({ breadcrumbs }: { breadcrumbs: EntityBreadcrumb[] }) {
  const { clearToEntity } = useEntityContext();

  // Deduplicate breadcrumbs by ID (keep first occurrence)
  const uniqueBreadcrumbs = breadcrumbs.filter(
    (crumb, index, self) => self.findIndex((c) => c.id === crumb.id) === index
  );

  if (uniqueBreadcrumbs.length === 0) {
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
              {crumb.type}: {crumb.label}
            </button>
          </React.Fragment>
        );
      })}
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
              {!isUser && <AIModelBadge callPoint={`chat.${mode.toLowerCase()}`} variant="text" size="sm" />}
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
  const { isOpen, closePanel, mode, setMode, chatLayout, setChatLayout } = useChatContext();
  const { breadcrumbs } = useEntityContext();

  // Cmd+K shortcut is registered by GlobalAssistant (avoids double-toggle)

  // Auto-detect entities from URL
  useEntityDetection();

  const modeConfig = MODE_CONFIG[mode];
  const allModes = Object.keys(MODE_CONFIG) as ChatMode[];

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
            {/* Mode selector */}
            <div className="chat-mode-selector">
              {allModes.map((m) => {
                const mc = MODE_CONFIG[m];
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`chat-mode-btn${m === mode ? " chat-mode-btn--active" : ""}`}
                    title={mc.description}
                  >
                    <span className="chat-mode-btn-icon">{mc.icon}</span>
                    <span className="chat-mode-btn-label">{mc.label}</span>
                  </button>
                );
              })}
            </div>
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
          {/* Context Breadcrumbs */}
          <ChatBreadcrumbStripe breadcrumbs={breadcrumbs} />

          {/* Messages */}
          <ChatMessages />

          {/* Input */}
          <ChatInput />
        </>
      </div>
    </>
  );
}

export default ChatPanel;
