"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Bug, Send, X, Loader2, Trash2, ChevronDown, ChevronUp, AlertCircle, Copy, Check, Camera } from "lucide-react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useErrorCapture } from "@/contexts/ErrorCaptureContext";
import { useEntityContext } from "@/contexts";
import ReactMarkdown from "react-markdown";
import { registerBugReportOpener, unregisterBugReportOpener, STATUS_BAR_HEIGHT } from "./StatusBar";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { buildBugContext, bugContextToMarkdown } from "@/lib/buildBugContext";

const BUG_REPORTER_KEY = "ui.bugReporter";

export function BugReportButton() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { getRecentErrors } = useErrorCapture();
  const entityContext = useEntityContext();

  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [response, setResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<
    { role: string; content: string }[]
  >([]);
  const [showContext, setShowContext] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
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

    const ctx = buildBugContext({
      pathname: pathname || "",
      breadcrumbs: entityContext.breadcrumbs || [],
      getRecentErrors,
      userRole: userRole as string | undefined,
      screenshotDataUrl: screenshot,
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: description.trim(),
          mode: "BUG",
          entityContext: entityContext.breadcrumbs || [],
          conversationHistory: conversationHistory.slice(-10),
          bugContext: ctx,
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
    setScreenshot(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Screenshot capture: hide panel → snap → reopen with thumbnail
  const handleScreenshot = useCallback(async () => {
    setCapturingScreenshot(true);
    setExpanded(false);
    // Wait for panel to collapse
    await new Promise((r) => setTimeout(r, 350));
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        scale: 1,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el.classList.contains("hf-status-bar"),
      });
      // Use JPEG for smaller size
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setScreenshot(dataUrl);
    } catch {
      // Screenshot failed — not critical, just skip
    } finally {
      setExpanded(true);
      setCapturingScreenshot(false);
    }
  }, []);

  // Build full context markdown for clipboard
  const buildFullContext = useCallback(() => {
    const ctx = buildBugContext({
      pathname: pathname || "",
      breadcrumbs: entityContext.breadcrumbs || [],
      getRecentErrors,
      userRole: userRole as string | undefined,
      screenshotDataUrl: screenshot,
    });
    return bugContextToMarkdown(ctx, conversationHistory, description, response);
  }, [pathname, entityContext.breadcrumbs, getRecentErrors, userRole, screenshot, conversationHistory, description, response]);

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

  // Register opener so StatusBar can trigger expansion
  useEffect(() => {
    registerBugReportOpener(() => setExpanded(true));
    return () => unregisterBugReportOpener();
  }, []);

  const recentErrors = getRecentErrors();

  if (isHidden) return null;

  // Only render when expanded — StatusBar provides the trigger
  if (!expanded) return null;

  const canSend = description.trim() && !isStreaming;

  return (
    <div className="hf-bug-anchor" style={{ bottom: STATUS_BAR_HEIGHT + 8 }}>
      <div className="hf-bug-panel">
        {/* Header */}
        <div className="hf-bug-header">
          <div className="hf-bug-header-left">
            <Bug size={16} className="hf-bug-icon" />
            <span className="hf-bug-title">Bug Report</span>
            {conversationHistory.length > 0 && (
              <span className="hf-bug-exchange-count">
                ({conversationHistory.length / 2} exchanges)
              </span>
            )}
          </div>
          <div className="hf-bug-header-actions">
            <button
              onClick={handleScreenshot}
              className="hf-bug-action-btn"
              title="Capture screenshot"
              disabled={capturingScreenshot}
            >
              <Camera size={13} />
            </button>
            <button
              onClick={() => copyToClipboard(buildFullContext())}
              className={`hf-bug-action-btn ${copied ? "hf-bug-action-success" : "hf-bug-action-accent"}`}
              title={copied ? "Copied!" : "Copy full context for Claude Code"}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy Context"}</span>
            </button>
            {(response || conversationHistory.length > 0) && (
              <button
                onClick={handleReset}
                className="hf-bug-action-btn"
                title="Clear conversation"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={() => setExpanded(false)}
              className="hf-bug-action-btn"
              title="Minimize"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Context summary (collapsible) */}
        <div className="hf-bug-context-bar">
          <button
            onClick={() => setShowContext(!showContext)}
            className="hf-bug-context-toggle"
          >
            {showContext ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span className="hf-bug-context-label">Context</span>
            <span className="hf-bug-context-url">
              {typeof window !== "undefined" ? window.location.href : pathname}
              {recentErrors.length > 0 && (
                <span className="hf-bug-error-count">
                  {recentErrors.length} error{recentErrors.length !== 1 ? "s" : ""}
                </span>
              )}
            </span>
          </button>
          {showContext && (
            <div className="hf-bug-context-detail">
              <div><strong>URL:</strong> {typeof window !== "undefined" ? window.location.href : pathname}</div>
              <div><strong>Viewport:</strong> {typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "N/A"}</div>
              {userRole && <div><strong>Role:</strong> {userRole}</div>}
              {recentErrors.length > 0 && (
                <div>
                  <strong>Recent errors:</strong>
                  {recentErrors.map((err, i) => (
                    <div key={i} className="hf-bug-error-row">
                      <AlertCircle size={12} className="hf-bug-error-icon" />
                      <span>
                        {err.message}
                        {err.source && <span className="hf-bug-error-source"> ({err.source})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Screenshot preview */}
        {screenshot && (
          <div className="hf-bug-screenshot">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL screenshot, next/image doesn't apply */}
            <img
              src={screenshot}
              alt="Bug report screenshot"
              className="hf-bug-screenshot-img"
            />
            <button
              onClick={() => setScreenshot(null)}
              className="hf-bug-screenshot-remove"
              title="Remove screenshot"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Response area */}
        {response && (
          <div ref={responseRef} className="hf-bug-response bug-report-markdown">
            <ReactMarkdown
              components={{
                code: ({ children, className, ...props }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code className="hf-bug-code-inline" {...props}>{children}</code>
                  ) : (
                    <code className={`hf-bug-code-block ${className || ""}`} {...props}>{children}</code>
                  );
                },
                h3: ({ children }) => <h3 className="hf-bug-response-h3">{children}</h3>,
                p: ({ children }) => <p className="hf-bug-response-p">{children}</p>,
                li: ({ children }) => <li className="hf-bug-response-li">{children}</li>,
              }}
            >
              {response}
            </ReactMarkdown>
          </div>
        )}

        {/* Input area */}
        <div className={`hf-bug-input-area ${response ? "hf-bug-input-bordered" : ""}`}>
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
            className="hf-bug-textarea"
            disabled={isStreaming}
          />
          <div className="hf-bug-footer">
            <span className="hf-bug-footer-hint">
              Enter to send, Shift+Enter for newline
            </span>
            <div className="hf-bug-footer-actions">
              {isStreaming && (
                <button onClick={handleStop} className="hf-bug-stop-btn">
                  Stop
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className={`hf-bug-send-btn ${canSend ? "hf-bug-send-active" : ""}`}
              >
                {isStreaming ? (
                  <Loader2 size={14} className="hf-spinner" />
                ) : (
                  <Send size={14} />
                )}
                {isStreaming ? "Diagnosing..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
