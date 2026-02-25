"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Bug, Send, X, Loader2, Trash2, ChevronDown, ChevronUp, AlertCircle, Copy, Check } from "lucide-react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useErrorCapture } from "@/contexts/ErrorCaptureContext";
import { useEntityContext } from "@/contexts";
import ReactMarkdown from "react-markdown";
import { registerBugReportOpener, unregisterBugReportOpener, STATUS_BAR_HEIGHT } from "./StatusBar";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

const BUG_REPORTER_KEY = "ui.bugReporter";

export function BugReportButton() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { getRecentErrors, clearErrors, errorCount } = useErrorCapture();
  const entityContext = useEntityContext();

  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [response, setResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<
    { role: string; content: string }[]
  >([]);
  const [showContext, setShowContext] = useState(false);
  const { copied, copy: copyToClipboard } = useCopyToClipboard();
  const [disabledByUser, setDisabledByUser] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Read localStorage toggle + listen for changes from settings page
  useEffect(() => {
    const stored = localStorage.getItem(BUG_REPORTER_KEY);
    if (stored === "false") setDisabledByUser(true);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === BUG_REPORTER_KEY) {
        setDisabledByUser(e.newValue === "false");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const userRole = session?.user?.role;
  const isHidden =
    disabledByUser ||
    !userRole ||
    !["OPERATOR", "ADMIN", "SUPERADMIN"].includes(userRole as string) ||
    pathname?.startsWith("/x/sim") ||
    pathname?.startsWith("/login");

  const handleSubmit = async () => {
    if (!description.trim() || isStreaming) return;

    setIsStreaming(true);
    setResponse("");
    abortRef.current = new AbortController();

    const bugContext = {
      url: pathname || window.location.pathname,
      errors: getRecentErrors(),
      browser: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: Date.now(),
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: description.trim(),
          mode: "BUG",
          entityContext: entityContext.breadcrumbs || [],
          conversationHistory: conversationHistory.slice(-10),
          bugContext,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setResponse(`**Error:** ${errData?.error || res.statusText}`);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setResponse(accumulated);
        }
      }

      setConversationHistory((prev) => [
        ...prev,
        { role: "user", content: description.trim() },
        { role: "assistant", content: accumulated },
      ]);
      setDescription("");
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setResponse(`**Error:** ${err.message}`);
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleReset = () => {
    setResponse("");
    setDescription("");
    setConversationHistory([]);
    setShowContext(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-scroll response area
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  // Focus textarea when expanded
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  // Dismiss with Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded]);

  const recentErrors = getRecentErrors();

  // Build full context markdown for Claude Code
  const buildFullContext = useCallback(() => {
    const lines: string[] = [
      `## Bug Report — ${pathname || window.location.pathname}`,
      `**Time:** ${new Date().toLocaleString()}`,
      `**Viewport:** ${typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "N/A"}`,
      `**Browser:** ${typeof navigator !== "undefined" ? navigator.userAgent : "N/A"}`,
    ];

    // Entity breadcrumbs
    const crumbs = entityContext.breadcrumbs;
    if (crumbs && crumbs.length > 0) {
      lines.push(`**Entity context:** ${crumbs.map((b: { type?: string; label?: string }) => `${b.type || "?"}:${b.label || "?"}`).join(" → ")}`);
    }

    // JS errors
    const errors = getRecentErrors();
    if (errors.length > 0) {
      lines.push("", "### Captured JS Errors");
      for (const err of errors) {
        lines.push(`- \`${err.message}\`${err.source ? ` (${err.source})` : ""}`);
      }
    }

    // Conversation
    if (conversationHistory.length > 0 || description.trim()) {
      lines.push("", "### Conversation");
      for (const msg of conversationHistory) {
        lines.push(`**${msg.role === "user" ? "User" : "AI"}:** ${msg.content}`);
      }
      if (description.trim()) {
        lines.push(`**User (draft):** ${description.trim()}`);
      }
    }

    // Latest AI response (if not already in history)
    if (response && conversationHistory.length === 0) {
      lines.push("", "### AI Diagnosis", response);
    }

    return lines.join("\n");
  }, [pathname, entityContext.breadcrumbs, getRecentErrors, conversationHistory, description, response]);

  // Register opener so StatusBar can trigger expansion
  useEffect(() => {
    registerBugReportOpener(() => setExpanded(true));
    return () => unregisterBugReportOpener();
  }, []);

  if (isHidden) return null;

  // Only render when expanded — StatusBar provides the trigger
  if (!expanded) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: STATUS_BAR_HEIGHT + 8,
        right: 16,
        zIndex: 9998,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      {/* Expanded panel */}
      {expanded && (
        <div
          style={{
            width: 400,
            maxHeight: "80vh",
            borderRadius: 12,
            border: "1px solid var(--border-default)",
            background: "var(--surface-primary)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-default)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bug size={16} style={{ color: "var(--status-error-text)" }} />
              <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                Bug Report
              </span>
              {conversationHistory.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  ({conversationHistory.length / 2} exchanges)
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {/* Copy full context (always available once expanded) */}
              <button
                onClick={() => copyToClipboard(buildFullContext())}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  color: copied ? "var(--status-success-text)" : "var(--accent-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 11,
                  fontWeight: 500,
                  transition: "color 0.15s",
                }}
                title={copied ? "Copied!" : "Copy full context (URL, errors, conversation) for Claude Code"}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? "Copied" : "Copy Context"}</span>
              </button>
              {(response || conversationHistory.length > 0) && (
                <button
                  onClick={handleReset}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    borderRadius: 6,
                    color: "var(--text-tertiary)",
                    display: "flex",
                  }}
                  title="Clear conversation"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                onClick={() => setExpanded(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  color: "var(--text-tertiary)",
                  display: "flex",
                }}
                title="Minimize"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Context summary (collapsible) */}
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--border-default)",
              fontSize: 12,
              color: "var(--text-secondary)",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setShowContext(!showContext)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-secondary)",
                padding: 0,
                width: "100%",
              }}
            >
              {showContext ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <span style={{ fontWeight: 500 }}>Context</span>
              <span style={{ color: "var(--text-tertiary)" }}>
                {pathname}
                {recentErrors.length > 0 && (
                  <span style={{ color: "var(--status-error-text)", marginLeft: 8 }}>
                    {recentErrors.length} error{recentErrors.length !== 1 ? "s" : ""}
                  </span>
                )}
              </span>
            </button>
            {showContext && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <div><strong>URL:</strong> {pathname}</div>
                <div><strong>Viewport:</strong> {typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "N/A"}</div>
                {recentErrors.length > 0 && (
                  <div>
                    <strong>Recent errors:</strong>
                    {recentErrors.map((err, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "4px 8px",
                          marginTop: 4,
                          background: "color-mix(in srgb, var(--status-error-text) 8%, transparent)",
                          borderRadius: 6,
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 4,
                        }}
                      >
                        <AlertCircle size={12} style={{ color: "var(--status-error-text)", flexShrink: 0, marginTop: 1 }} />
                        <span>
                          {err.message}
                          {err.source && <span style={{ color: "var(--text-tertiary)" }}> ({err.source})</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Response area */}
          {response && (
            <div
              ref={responseRef}
              style={{
                flex: 1,
                overflow: "auto",
                padding: "12px 16px",
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text-primary)",
                minHeight: 100,
                maxHeight: 400,
              }}
              className="bug-report-markdown"
            >
              <ReactMarkdown
                components={{
                  code: ({ children, className, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code
                          style={{
                            background: "var(--surface-tertiary, rgba(0,0,0,0.06))",
                            padding: "2px 5px",
                            borderRadius: 4,
                            fontSize: "0.9em",
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className={className}
                        style={{
                          display: "block",
                          background: "var(--surface-tertiary, rgba(0,0,0,0.06))",
                          padding: "8px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          overflow: "auto",
                          whiteSpace: "pre",
                        }}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  h3: ({ children }) => (
                    <h3
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        margin: "12px 0 4px",
                        color: "var(--text-primary)",
                      }}
                    >
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p style={{ margin: "4px 0" }}>{children}</p>
                  ),
                  li: ({ children }) => (
                    <li style={{ margin: "2px 0" }}>{children}</li>
                  ),
                }}
              >
                {response}
              </ReactMarkdown>
            </div>
          )}

          {/* Input area */}
          <div
            style={{
              padding: "12px 16px",
              borderTop: response ? "1px solid var(--border-default)" : "none",
              flexShrink: 0,
            }}
          >
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                conversationHistory.length > 0
                  ? "Ask a follow-up..."
                  : "Describe the bug you're seeing..."
              }
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-default)",
                background: "var(--surface-secondary, var(--surface-primary))",
                color: "var(--text-primary)",
                fontSize: 13,
                lineHeight: 1.5,
                outline: "none",
                boxSizing: "border-box",
              }}
              disabled={isStreaming}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                Enter to send, Shift+Enter for newline
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {isStreaming && (
                  <button
                    onClick={handleStop}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border-default)",
                      background: "var(--surface-primary)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!description.trim() || isStreaming}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      description.trim() && !isStreaming
                        ? "var(--status-error-text)"
                        : "var(--surface-tertiary, rgba(0,0,0,0.06))",
                    color:
                      description.trim() && !isStreaming
                        ? "var(--surface-primary)"
                        : "var(--text-tertiary)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor:
                      description.trim() && !isStreaming
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  {isStreaming ? (
                    <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Send size={14} />
                  )}
                  {isStreaming ? "Diagnosing..." : "Send"}
                </button>
              </div>
            </div>
          </div>

          <style>{`
            @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
            .bug-report-markdown pre { margin: 4px 0; }
            .bug-report-markdown ul, .bug-report-markdown ol { padding-left: 20px; margin: 4px 0; }
          `}</style>
        </div>
      )}
    </div>
  );
}
