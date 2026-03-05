"use client";

/**
 * ConversationalWizard V4 — Conversation-first course setup.
 *
 * Key differences from V3:
 * - Single centered column, no sidebar scaffold panel
 * - No show_options / show_sliders / show_actions — all choices in natural language
 * - Personality as preset chip (not sliders)
 * - FileCard inline in conversation after uploads
 * - LessonPlanAccordion shown after create_course returns lessonPlanPreview
 * - suggest_welcome_message handled as a suggested message chip
 * - _wizardVersion: "v4" sent to API
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUp, Loader2, Paperclip } from "lucide-react";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { PackUploadStep } from "@/components/wizards/PackUploadStep";
import type { PackUploadResult } from "@/components/wizards/PackUploadStep";
import { FileCard } from "./FileCard";
import type { FileCardData } from "./FileCard";
import { LessonPlanAccordion } from "./LessonPlanAccordion";
import type { LessonEntry } from "./LessonPlanAccordion";
import "../get-started-v4.css";

// ── Types ────────────────────────────────────────────────

export interface WizardInitialContext {
  institutionName: string;
  institutionId: string;
  domainId: string;
  domainKind: "INSTITUTION" | "COMMUNITY";
  typeSlug: string | null;
  userRole: string;
}

interface ConversationalWizardProps {
  initialContext?: WizardInitialContext;
}

type MessageRole = "assistant" | "user" | "system";
type SystemType = "timeline" | "success" | "error" | "upload-result" | "lesson-plan";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  systemType?: SystemType;
  /** Populated for upload-result system messages */
  fileCards?: FileCardData[];
  /** Populated for lesson-plan system messages */
  lessonEntries?: LessonEntry[];
  lessonCourseName?: string;
}

interface WizardToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface WizardResponse {
  content: string;
  toolCalls: WizardToolCall[];
}

// ── Step definitions ─────────────────────────────────────

const WIZARD_STEPS: StepDefinition[] = [
  { id: "open", label: "Tell me about your course", activeLabel: "Gathering course details" },
  { id: "personality", label: "Teaching style", activeLabel: "Choosing teaching style" },
  { id: "content", label: "Materials", activeLabel: "Adding materials" },
  { id: "launch", label: "Launch", activeLabel: "Launching course" },
];

// ── Storage ──────────────────────────────────────────────

const HISTORY_KEY = "gs-v4-history";

function loadHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: Message[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
  } catch { /* quota */ }
}

// ── ID helper ────────────────────────────────────────────

let idCounter = 0;
function uid(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

// ── Context → setup data ─────────────────────────────────

function contextToInitialData(ctx: WizardInitialContext): Record<string, unknown> {
  return {
    institutionName: ctx.institutionName,
    existingInstitutionId: ctx.institutionId,
    existingDomainId: ctx.domainId,
    defaultDomainKind: ctx.domainKind,
    ...(ctx.typeSlug ? { typeSlug: ctx.typeSlug } : {}),
  };
}

// ── Component ────────────────────────────────────────────

export function ConversationalWizard({ initialContext }: ConversationalWizardProps) {
  const { getData, setData, isActive, startFlow } = useStepFlow();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [welcomeSuggestion, setWelcomeSuggestion] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialised = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Scroll ───────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }, 50);
  }, []);

  // ── Setup data ────────────────────────────────────────

  const getSetupData = useCallback((): Record<string, unknown> => {
    const keys = [
      "institutionName", "existingInstitutionId", "existingDomainId",
      "typeSlug", "defaultDomainKind", "websiteUrl",
      "courseName", "subjectDiscipline", "interactionPattern", "teachingMode",
      "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
      "behaviorTargets", "lessonPlanModel", "personalityPreset", "physicalMaterials",
      "draftDomainId", "draftInstitutionId", "draftPlaybookId", "draftCallerId",
      "launched", "sourceId", "packSubjectIds", "extractionTotals", "contentSkipped",
    ];
    const data: Record<string, unknown> = {};
    for (const k of keys) {
      const v = getData(k);
      if (v !== undefined && v !== null && v !== "") data[k] = v;
    }
    return data;
  }, [getData]);

  // ── API call ──────────────────────────────────────────

  const sendToAPI = useCallback(
    async (userMessage: string, history: Message[], overrides?: Record<string, unknown>): Promise<WizardResponse | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const conversationHistory = history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));

        const setupData = {
          ...getSetupData(),
          ...(overrides || {}),
          _wizardVersion: "v4",
        };

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: userMessage,
            mode: "WIZARD",
            entityContext: [],
            conversationHistory,
            setupData,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        return await res.json();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.error("[wizard-v4] API error:", err);
        return null;
      }
    },
    [getSetupData],
  );

  // ── Tool call processing ──────────────────────────────

  const processToolCalls = useCallback(
    (toolCalls: WizardToolCall[]): Message[] => {
      const extras: Message[] = [];
      setSuggestions([]);

      for (const tc of toolCalls) {
        switch (tc.name) {
          case "update_setup": {
            const fields = tc.input.fields as Record<string, unknown>;
            for (const [k, v] of Object.entries(fields)) {
              setData(k, v);
            }
            break;
          }

          case "show_suggestions": {
            const items = tc.input.suggestions as string[];
            if (items?.length) setSuggestions(items);
            break;
          }

          case "show_upload": {
            setShowUpload(true);
            break;
          }

          case "create_course":
          case "create_institution": {
            // No UI action needed — server executes, result arrives in next message
            break;
          }

          case "update_course_config": {
            // Config update — no UI change needed
            break;
          }

          case "suggest_welcome_message": {
            // Show as a "Use this?" chip the user can accept or ignore
            const suggestion = tc.input.suggestion as string | undefined;
            if (suggestion) setWelcomeSuggestion(suggestion);
            break;
          }

          case "mark_complete": {
            setData("launched", true);
            break;
          }
        }
      }

      return extras;
    },
    [setData],
  );

  // ── Post-process AI response for tool results ─────────

  const processResponseContent = useCallback(
    (content: string, toolCalls: WizardToolCall[]): Message[] => {
      const extra: Message[] = [];

      for (const tc of toolCalls) {
        if (tc.name === "create_course") {
          // create_course returns lessonPlanPreview and draftCallerId/playbookId
          // The AI response will contain these — we also parse the tool result
          // stored in setupData after server-side execution.
          // Check if AI response mentioned lesson plan — handled via lessonPlanPreview in setupData
        }
      }

      // Check if create_course just completed — lessonPlanPreview in setupData
      const preview = getData<LessonEntry[]>("lessonPlanPreview");
      const courseName = getData<string>("courseName");
      if (preview?.length && !getData<boolean>("lessonPlanShown")) {
        setData("lessonPlanShown", true);
        extra.push({
          id: uid(),
          role: "system",
          content: "",
          systemType: "lesson-plan",
          lessonEntries: preview,
          lessonCourseName: courseName || undefined,
        });
      }

      return extra;
    },
    [getData, setData],
  );

  // ── Handle send ───────────────────────────────────────

  const handleSend = useCallback(
    async (text?: string, overrides?: Record<string, unknown>) => {
      const msg = (text || inputValue).trim();
      if (!msg || isLoading) return;

      setInputValue("");
      setShowUpload(false);
      setSuggestions([]);
      setWelcomeSuggestion(null);

      const userMsg: Message = { id: uid(), role: "user", content: msg };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      saveHistory(newMessages);
      scrollToBottom();

      setIsLoading(true);
      const response = await sendToAPI(msg, newMessages, overrides);
      setIsLoading(false);

      if (!response) {
        if (abortRef.current?.signal.aborted) return;
        const errMsg: Message = {
          id: uid(),
          role: "system",
          content: "Something went wrong. Please try again.",
          systemType: "error",
        };
        const withErr = [...newMessages, errMsg];
        setMessages(withErr);
        saveHistory(withErr);
        scrollToBottom();
        return;
      }

      const toolExtras = response.toolCalls?.length ? processToolCalls(response.toolCalls) : [];
      const contentExtras = processResponseContent(response.content, response.toolCalls || []);

      let finalMessages = [...newMessages, ...toolExtras];
      if (response.content) {
        finalMessages = [...finalMessages, { id: uid(), role: "assistant", content: response.content }];
      }
      finalMessages = [...finalMessages, ...contentExtras];

      setMessages(finalMessages);
      saveHistory(finalMessages);
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);
    },
    [inputValue, isLoading, messages, sendToAPI, processToolCalls, processResponseContent, scrollToBottom],
  );

  // ── Upload complete ────────────────────────────────────

  const handleUploadComplete = useCallback(
    (result: PackUploadResult) => {
      if (result.subjects) setData("packSubjectIds", result.subjects.map((s) => s.id));
      if (result.extractionTotals) setData("extractionTotals", result.extractionTotals);
      if (result.taskId) setData("uploadTaskId", result.taskId);

      const fileCards: FileCardData[] = (result.classifications || []).map((c) => ({
        fileName: c.fileName,
        classification: c.documentType,
        subject: result.subjects?.[0]?.name,
      }));

      setShowUpload(false);

      // Inline file cards as a system message
      const uploadMsg: Message = {
        id: uid(),
        role: "system",
        content: `${result.classifications?.length ?? 1} file(s) uploaded`,
        systemType: "upload-result",
        fileCards: fileCards.length ? fileCards : undefined,
      };
      setMessages((prev) => {
        const updated = [...prev, uploadMsg];
        saveHistory(updated);
        return updated;
      });

      handleSend("Teaching materials uploaded");
    },
    [setData, handleSend],
  );

  // ── Keyboard ──────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Flow setup ────────────────────────────────────────

  useEffect(() => {
    if (!isActive) {
      startFlow({
        flowId: "get-started-v4",
        steps: WIZARD_STEPS,
        returnPath: "/x/get-started-v4",
        initialData: initialContext ? contextToInitialData(initialContext) : undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, startFlow]);

  // ── Init ──────────────────────────────────────────────

  useEffect(() => {
    if (!isActive || initialised.current) return;
    initialised.current = true;

    const saved = loadHistory();
    if (saved.length > 0) {
      setMessages(saved);
      scrollToBottom();
      return;
    }

    const hasContext = !!initialContext;
    const greeting: Message = {
      id: uid(),
      role: "assistant",
      content: hasContext
        ? `Hi! I can see you're at **${initialContext!.institutionName}**. Tell me about the course you want to set up — subject, level, and how many sessions you're thinking.`
        : "Hi! I'll help you set up your AI tutor. Tell me about the course you want to create — what subject, who it's for, and roughly how many sessions.",
    };
    setMessages([greeting]);
    saveHistory([greeting]);
    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, scrollToBottom]);

  // ── Render ────────────────────────────────────────────

  if (!isActive) return null;

  const draftCallerId = getData<string>("draftCallerId");
  const draftPlaybookId = getData<string>("draftPlaybookId");
  const draftDomainId = getData<string>("draftDomainId") || getData<string>("existingDomainId");
  const resolvedDomainId = draftDomainId || "";
  const launched = getData<boolean>("launched");

  return (
    <div className="cv4-layout">
      <div className="cv4-container">
        {/* Messages */}
        <div className="cv4-messages" aria-live="polite">
          {messages.map((msg) => {
            if (msg.systemType === "error") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <div className="cv4-bubble cv4-bubble--error">{msg.content}</div>
                </div>
              );
            }

            if (msg.systemType === "upload-result") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  {msg.fileCards?.map((fc, i) => (
                    <FileCard key={i} file={fc} />
                  ))}
                  {!msg.fileCards && (
                    <div className="cv4-bubble cv4-bubble--system">{msg.content}</div>
                  )}
                </div>
              );
            }

            if (msg.systemType === "lesson-plan" && msg.lessonEntries) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <LessonPlanAccordion
                    entries={msg.lessonEntries}
                    courseName={msg.lessonCourseName}
                  />
                </div>
              );
            }

            return (
              <div key={msg.id} className={`cv4-row cv4-row--${msg.role}`}>
                <div className={`cv4-bubble cv4-bubble--${msg.role}`}>
                  {msg.content}
                </div>
              </div>
            );
          })}

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

          {/* Course ready card */}
          {launched && draftCallerId && (
            <div className="cv4-row cv4-row--system">
              <div className="cv4-success-card">
                <div className="cv4-success-title">Your AI tutor is ready</div>
                <div className="cv4-success-sub">Try a sim call to hear it in action.</div>
                <div className="cv4-success-actions">
                  <a
                    href={`/x/sim/${draftCallerId}?${new URLSearchParams({
                      ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                      ...(draftDomainId ? { domainId: draftDomainId } : {}),
                    }).toString()}`}
                    className="hf-btn hf-btn-primary"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Try a Sim Call
                  </a>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="cv4-input-area">
          {/* Upload panel */}
          {showUpload && resolvedDomainId && (
            <div className="cv4-upload-panel">
              <PackUploadStep
                domainId={resolvedDomainId}
                courseName={getData<string>("courseName") || "Course"}
                interactionPattern={getData<string>("interactionPattern") || undefined}
                teachingMode={getData<string>("teachingMode") || undefined}
                subjectDiscipline={getData<string>("subjectDiscipline") || undefined}
                institutionName={getData<string>("institutionName") || undefined}
                onResult={handleUploadComplete}
              />
            </div>
          )}

          {/* Welcome suggestion accept chip */}
          {welcomeSuggestion && !showUpload && (
            <div className="cv4-welcome-suggestion">
              <div className="cv4-welcome-suggestion-label">Suggested welcome message:</div>
              <div className="cv4-welcome-suggestion-text">{welcomeSuggestion}</div>
              <div className="cv4-welcome-suggestion-actions">
                <button
                  type="button"
                  className="hf-btn hf-btn-primary"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  onClick={() => {
                    setData("welcomeMessage", welcomeSuggestion);
                    setWelcomeSuggestion(null);
                    handleSend(`Use this welcome message: ${welcomeSuggestion}`, { welcomeMessage: welcomeSuggestion });
                  }}
                >
                  Use this
                </button>
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  onClick={() => {
                    setWelcomeSuggestion(null);
                    handleSend("I'll write my own welcome message");
                  }}
                >
                  Write my own
                </button>
              </div>
            </div>
          )}

          {/* Suggestion chips */}
          {suggestions.length > 0 && !showUpload && !welcomeSuggestion && (
            <div className="cv4-suggestions">
              {suggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="cv4-suggestion-chip"
                  onClick={() => handleSend(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Text input */}
          <div className="cv4-input-row">
            <button
              type="button"
              className={`cv4-attach-btn${showUpload ? " cv4-attach-btn--active" : ""}`}
              onClick={() => setShowUpload((v) => !v)}
              disabled={!resolvedDomainId}
              title={resolvedDomainId ? "Upload teaching materials" : "Set up your course first"}
            >
              <Paperclip size={16} />
            </button>

            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
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
                disabled={!inputValue.trim()}
                onClick={() => handleSend()}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
