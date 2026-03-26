"use client";

/**
 * CourseRefBuilder — Split-panel chat + live preview for building a COURSE_REFERENCE.
 *
 * Left panel: Chat (sends mode: "COURSE_REF" to /api/chat)
 * Right panel: Live preview of the document being built, section-by-section
 *
 * Uses the cv4-* CSS system from wizard.css for visual parity with GS V5.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Loader2, Check, Download, ExternalLink, Upload, BookMarked } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { CourseRefData } from "@/lib/content-trust/course-ref-to-assertions";
import { RefPreviewPanel } from "./RefPreviewPanel";
import "../wizard/wizard.css";

// ── Types ────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  suggestions?: { question: string; suggestions: string[] };
}

interface FinalizeResult {
  courseId: string;
  playbookId: string;
  contentSourceId: string;
  assertionCount: number;
}

interface CourseRefBuilderProps {
  courseId?: string;
}

// ── Component ────────────────────────────────────────────

export function CourseRefBuilder({ courseId }: CourseRefBuilderProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [refData, setRefData] = useState<CourseRefData>({});
  const [finalized, setFinalized] = useState<FinalizeResult | null>(null);
  const [institutionName, setInstitutionName] = useState("");
  const [courseName, setCourseName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build conversation history for API
  const getConversationHistory = useCallback(() => {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // Process tool calls from AI response
  const processToolCalls = useCallback(
    (toolCalls: Array<{ name: string; input: Record<string, unknown> }>) => {
      let suggestions: { question: string; suggestions: string[] } | undefined;

      for (const tc of toolCalls) {
        switch (tc.name) {
          case "update_ref": {
            const section = tc.input.section as string;
            const data = tc.input.data as Record<string, unknown>;
            setRefData((prev) => {
              // For top-level sections, merge the data
              if (section === "teachingApproach" && prev.teachingApproach) {
                return { ...prev, [section]: { ...prev.teachingApproach, ...data } };
              }
              return { ...prev, [section]: data };
            });
            break;
          }
          case "show_suggestions": {
            suggestions = {
              question: tc.input.question as string,
              suggestions: tc.input.suggestions as string[],
            };
            break;
          }
          case "finalize_ref": {
            // The result is in the tool response content, parsed by the API
            // We'll catch it from the response JSON
            break;
          }
        }
      }

      return suggestions;
    },
    [],
  );

  // Send message to API
  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim() || isLoading) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userMessage.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage.trim(),
            mode: "COURSE_REF",
            entityContext: [],
            conversationHistory: getConversationHistory(),
            setupData: {
              courseRef: refData,
              courseId,
              institutionName,
              courseName,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        // Process tool calls
        let suggestions: { question: string; suggestions: string[] } | undefined;
        if (data.toolCalls?.length) {
          suggestions = processToolCalls(data.toolCalls);

          // Check for finalize result
          for (const tc of data.toolCalls) {
            if (tc.name === "finalize_ref") {
              // The finalize result comes back in the tool response
              // Parse it from the AI's continuation text or the tool result
              try {
                const input = tc.input as Record<string, unknown>;
                // Extract institution/course names for the finalize call
                if (input.institutionName) setInstitutionName(input.institutionName as string);
                if (input.courseName) setCourseName(input.courseName as string);
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Check if the response contains a finalize success
        if (data.content?.includes('"ok":true') && data.content?.includes("assertionCount")) {
          try {
            // Try to extract finalize result from the response
            const match = data.content.match(/\{[^}]*"ok"\s*:\s*true[^}]*"assertionCount"\s*:\s*\d+[^}]*\}/);
            if (match) {
              const result = JSON.parse(match[0]);
              if (result.ok && result.assertionCount) {
                setFinalized(result);
              }
            }
          } catch {
            // Not a finalize response
          }
        }

        // Add assistant message
        if (data.content) {
          const assistantMsg: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: data.content,
            suggestions,
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }

        // Extract names from update_ref courseOverview
        if (data.toolCalls?.length) {
          for (const tc of data.toolCalls) {
            if (tc.name === "update_ref" && tc.input.section === "courseOverview") {
              const ov = tc.input.data as Record<string, string>;
              if (ov.subject) setCourseName(ov.subject);
            }
          }
        }
      } catch (err) {
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: "system",
          content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, getConversationHistory, refData, courseId, institutionName, courseName, processToolCalls],
  );

  // Handle suggestion chip click
  const handleSuggestion = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  // Handle Enter key (submit on Enter, newline on Shift+Enter)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  // Send initial greeting on mount
  useEffect(() => {
    if (messages.length === 0) {
      sendMessage("Hello, I'd like to build a course reference.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Finalized state ────────────────────────────────────
  if (finalized) {
    return (
      <div className="cv4-layout" style={{ justifyContent: "center", alignItems: "center" }}>
        <div className="cv4-chat-column" style={{ maxWidth: 480 }}>
          <div className="cv4-container" style={{ justifyContent: "center", alignItems: "center", padding: "40px 0" }}>
            <div className="cv4-success-card">
              <div className="cv4-success-title">Course Reference Created</div>
              <div className="cv4-success-sub">
                {courseName && <strong>{courseName}</strong>}
                {courseName && <br />}
                {finalized.assertionCount} teaching assertions in prompt pipeline
              </div>
              <div className="cv4-success-actions">
                <a
                  href={`/x/get-started-v5?courseId=${finalized.playbookId}`}
                  className="hf-btn hf-btn-primary cv4-success-primary"
                >
                  <Upload size={16} /> Upload Content &amp; Configure
                </a>
                <div className="cv4-success-row">
                  <a
                    href={`/x/courses/${finalized.playbookId}`}
                    className="hf-btn hf-btn-secondary cv4-success-btn-half"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={14} /> View Course
                  </a>
                  <button
                    className="hf-btn hf-btn-secondary cv4-success-btn-half"
                    onClick={() => {
                      // TODO: Download markdown
                    }}
                  >
                    <Download size={14} /> Download Reference
                  </button>
                </div>
                <a href="/x" className="cv4-success-link">
                  Go to Dashboard &rarr;
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────
  return (
    <div className="cv4-layout">
      {/* Chat column */}
      <div className="cv4-chat-column">
        <div className="cv4-container">
          {/* Messages */}
          <div className="cv4-messages" aria-live="polite">
            <div className="cv4-messages-spacer" />
            {messages.map((msg) => {
              if (msg.role === "system") {
                return (
                  <div key={msg.id} className="cv4-row cv4-row--system">
                    <div className="cv4-bubble cv4-bubble--error">{msg.content}</div>
                  </div>
                );
              }

              if (msg.role === "assistant") {
                return (
                  <div key={msg.id} className="cv4-row cv4-row--assistant">
                    <div className="cv4-bubble cv4-bubble--assistant">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="cv4-row cv4-row--user">
                  <div className="cv4-bubble cv4-bubble--user">{msg.content}</div>
                </div>
              );
            })}

            {/* Suggestion chips */}
            {messages.length > 0 && messages[messages.length - 1]?.suggestions && !isLoading && (
              <div className="cv4-row cv4-row--assistant">
                <div className="cv4-suggestions">
                  {messages[messages.length - 1].suggestions!.question && (
                    <div className="cv4-suggestions-label">
                      {messages[messages.length - 1].suggestions!.question}
                    </div>
                  )}
                  <div className="cv4-suggestions-chips">
                    {messages[messages.length - 1].suggestions!.suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="cv4-suggestion-chip"
                        onClick={() => handleSuggestion(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Typing indicator */}
            {isLoading && (
              <div className="cv4-row cv4-row--assistant">
                <div className="cv4-typing">
                  <div className="cv4-typing-dot" />
                  <div className="cv4-typing-dot" />
                  <div className="cv4-typing-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="cv4-input-area">
            <div className="cv4-input-row">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your course..."
                rows={1}
                className="cv4-textarea"
              />
              {isLoading ? (
                <div className="cv4-send-btn cv4-send-btn--loading">
                  <Loader2 size={16} className="hf-spinner" />
                </div>
              ) : (
                <button
                  type="button"
                  className="cv4-send-btn"
                  disabled={!input.trim()}
                  onClick={() => sendMessage(input)}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — preview */}
      <div className="cv4-panel-column">
        <RefPreviewPanel refData={refData} />
      </div>
    </div>
  );
}
