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
import { ArrowUp, Loader2, MoreHorizontal, AlertCircle, HelpCircle, ChevronsRight, Copy, Quote, Check, Upload } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { FileCard } from "./FileCard";
import type { FileCardData } from "./FileCard";
import { LessonPlanAccordion } from "./LessonPlanAccordion";
import type { LessonEntry } from "./LessonPlanAccordion";
import { OptionsCard } from "./OptionsCard";
import type { OptionsPanel } from "./OptionsCard";
import { SourcesPanel } from "./SourcesPanel";
import type { SourcesReadyData, SourcesPanelHandle } from "./SourcesPanel";
import { FirstCallPreviewCard } from "./FirstCallPreviewCard";
import type { FirstCallPreviewData } from "./FirstCallPreviewCard";
import { ScaffoldPanel } from "../../get-started/components/ScaffoldPanel";
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
type SystemType = "timeline" | "success" | "error" | "upload-result" | "upload-zone" | "lesson-plan" | "first-call-preview" | "options" | "progress";

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
  lessonCourseId?: string;
  /** Populated for first-call-preview system messages */
  firstCallPreview?: FirstCallPreviewData;
  /** Populated for options system messages */
  optionsPanel?: OptionsPanel;
  /** True after the user has resolved an options card — hides it from render */
  resolved?: boolean;
  /** Extended thinking text from Claude, shown as collapsible block */
  thinking?: string;
}

/** Map scaffold item keys to human-readable review phrases */
const REVIEW_LABELS: Record<string, string> = {
  institution: "organisation",
  subject: "subject",
  course: "course details",
  content: "teaching materials",
  welcome: "welcome message",
  lessons: "session settings",
  personality: "AI personality",
};

interface WizardToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface WizardResponse {
  content: string;
  toolCalls: WizardToolCall[];
  thinkingContent?: string;
}

// ── Thinking ─────────────────────────────────────────────

const WIZARD_THINKING_KEY = "wizard.thinking-enabled";

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cv4-thinking">
      <button className="cv4-thinking-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="cv4-thinking-icon">{open ? "▼" : "▶"}</span>
        Reasoning
      </button>
      {open && <div className="cv4-thinking-body">{content}</div>}
    </div>
  );
}

// ── Message actions (hover menu on assistant bubbles) ─────

function firstTwoLines(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  return lines.slice(0, 2).map((l) => l.length > 100 ? l.slice(0, 100) + "…" : l).join("\n");
}

interface MessageActionsProps {
  message: Message;
  onSend: (text: string) => void;
  onPrefill: (text: string) => void;
  onFocusInput: () => void;
}

function MessageActions({ message, onSend, onPrefill, onFocusInput }: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const actions = [
    { id: "correct", label: "That's not right", icon: AlertCircle },
    { id: "more", label: "Tell me more", icon: HelpCircle },
    { id: "skip", label: "Move on", icon: ChevronsRight },
    { id: "divider" },
    { id: "copy", label: "Copy", icon: Copy },
    { id: "quote", label: "Quote & reply", icon: Quote },
  ] as const;

  const actionItems = actions.filter((a) => a.id !== "divider") as Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;

  const handleOpen = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 200;
    const menuHeight = 220;
    // Prefer opening upward from the trigger (menu above the ···)
    // Fall back to downward only if not enough space above
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceAbove >= menuHeight + 4
      ? rect.top - menuHeight - 4
      : spaceBelow >= menuHeight + 4
        ? rect.bottom + 4
        : Math.max(8, window.innerHeight - menuHeight - 8);
    const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
    setPos({ top, left: Math.max(8, left) });
    setOpen(true);
    setFocusedIndex(-1);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPos(null);
    setFocusedIndex(-1);
  }, []);

  const handleAction = useCallback((id: string) => {
    handleClose();
    switch (id) {
      case "correct":
        onPrefill(`That's not right:\n\n> ${firstTwoLines(message.content)}\n\n`);
        onFocusInput();
        break;
      case "more":
        onSend("Tell me more about that");
        break;
      case "skip":
        onSend("Move on");
        break;
      case "copy":
        navigator.clipboard.writeText(message.content).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = message.content;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
        break;
      case "quote":
        onPrefill(`> ${firstTwoLines(message.content)}\n\n`);
        onFocusInput();
        break;
    }
  }, [handleClose, message.content, onSend, onPrefill, onFocusInput]);

  // Click outside + Escape
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, handleClose]);

  // Focus first item when menu opens
  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLButtonElement>("[role=menuitem]");
      first?.focus();
      setFocusedIndex(0);
    }
  }, [open]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => {
        const next = Math.min(i + 1, actionItems.length - 1);
        menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[next]?.focus();
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => {
        const prev = Math.max(i - 1, 0);
        menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[prev]?.focus();
        return prev;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < actionItems.length) {
        handleAction(actionItems[focusedIndex].id);
      }
    }
  }, [focusedIndex, actionItems, handleAction]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cv4-msg-actions-trigger"
        onClick={handleOpen}
        aria-label={copied ? "Copied" : "Message actions"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions for this message"
      >
        {copied ? <Check size={16} /> : <MoreHorizontal size={16} />}
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="cv4-msg-actions-menu"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          onKeyDown={handleMenuKeyDown}
        >
          {actions.map((action, i) =>
            action.id === "divider" ? (
              <div key={i} className="cv4-msg-actions-divider" role="separator" />
            ) : (
              <button
                key={action.id}
                type="button"
                className="cv4-msg-actions-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => handleAction(action.id)}
              >
                {action.icon && <action.icon size={15} />}
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
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
  const [suggestions, setSuggestions] = useState<{ question?: string; items: string[] }>({ items: [] });
  const [welcomeSuggestion, setWelcomeSuggestion] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialised = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Upload discoverability — peek+glow + page-level drag
  const sourcesPanelRef = useRef<SourcesPanelHandle>(null);
  const sourcesPanelElRef = useRef<HTMLDivElement>(null);
  const [sourcesGlow, setSourcesGlow] = useState(false);
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // ── Scroll ───────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }, 50);
  }, []);

  // ── Start over ───────────────────────────────────────

  const SETUP_KEYS = [
    "institutionName", "existingInstitutionId", "existingDomainId",
    "typeSlug", "defaultDomainKind", "websiteUrl",
    "courseName", "subjectDiscipline", "interactionPattern", "teachingMode",
    "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
    "behaviorTargets", "lessonPlanModel", "personalityPreset", "physicalMaterials",
    "draftDomainId", "draftInstitutionId", "draftPlaybookId", "draftCallerId",
    "launched", "sourceId", "packSubjectIds", "extractionTotals", "contentSkipped",
    "uploadSourceIds", "sourceCount",
    "communityMode", "draftCohortGroupId", "communityJoinToken", "communityHubUrl",
  ];

  const handleStartOver = useCallback(() => {
    abortRef.current?.abort();
    sessionStorage.removeItem(HISTORY_KEY);
    for (const k of SETUP_KEYS) setData(k, undefined);
    setMessages([]);
    setInputValue("");
    setIsLoading(false);
    setSuggestions({ items: [] });
    setWelcomeSuggestion(null);
    setConfirmReset(false);
    initialised.current = false;
    setResetKey((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setData]);

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
      "communityMode", "draftCohortGroupId", "communityJoinToken", "communityHubUrl",
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

        const thinkingEnabled =
          typeof window !== "undefined"
            ? localStorage.getItem(WIZARD_THINKING_KEY) !== "false"
            : true;

        const setupData = {
          ...getSetupData(),
          ...(overrides || {}),
          _wizardVersion: "v4",
          _wizardThinkingEnabled: thinkingEnabled,
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
      setSuggestions({ items: [] });

      for (const tc of toolCalls) {
        switch (tc.name) {
          case "update_setup": {
            const fields = tc.input.fields as Record<string, unknown>;
            for (const [k, v] of Object.entries(fields)) {
              setData(k, v);
            }
            // Progress panel is now always-visible in the right column — no inline injection needed
            break;
          }

          case "show_suggestions": {
            const items = tc.input.suggestions as string[];
            const question = tc.input.question as string | undefined;
            if (items?.length) setSuggestions({ question, items });
            break;
          }

          case "show_upload": {
            // Peek + glow: scroll SourcesPanel into view and pulse
            sourcesPanelElRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            setSourcesGlow(true);
            setTimeout(() => setSourcesGlow(false), 5000);

            // Inject inline drop zone into chat (only once)
            extras.push({
              id: uid(),
              role: "system",
              content: "",
              systemType: "upload-zone",
            });
            break;
          }

          case "create_course":
          case "create_institution":
          case "create_community": {
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

          case "show_options": {
            extras.push({
              id: uid(),
              role: "system",
              systemType: "options",
              content: tc.input.question as string,
              optionsPanel: tc.input as unknown as OptionsPanel,
            });
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
      const playbookId = getData<string>("draftPlaybookId");
      if (preview?.length && !getData<boolean>("lessonPlanShown")) {
        setData("lessonPlanShown", true);
        extra.push({
          id: uid(),
          role: "system",
          content: "",
          systemType: "lesson-plan",
          lessonEntries: preview,
          lessonCourseName: courseName || undefined,
          lessonCourseId: playbookId || undefined,
        });
      }

      // Check if create_course just completed — firstCallPreview in setupData
      const fcPreview = getData<FirstCallPreviewData>("firstCallPreview");
      if (fcPreview?.phases?.length && !getData<boolean>("firstCallPreviewShown")) {
        setData("firstCallPreviewShown", true);
        extra.push({
          id: uid(),
          role: "system",
          content: "",
          systemType: "first-call-preview",
          firstCallPreview: fcPreview,
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
      setSuggestions({ items: [] });
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
        // Restore the user's message so they can retry without retyping
        setInputValue(msg);
        const errMsg: Message = {
          id: uid(),
          role: "system",
          content: "That didn't go through — your message is still in the box. Try again.",
          systemType: "error",
        };
        const withErr = [...newMessages, errMsg];
        setMessages(withErr);
        saveHistory(withErr);
        scrollToBottom();
        setTimeout(() => inputRef.current?.focus(), 150);
        return;
      }

      const toolExtras = response.toolCalls?.length ? processToolCalls(response.toolCalls) : [];
      const contentExtras = processResponseContent(response.content, response.toolCalls || []);

      // Upsert progress card (stable id "progress-card" — add once, never duplicate)
      const hasProgressCard = newMessages.some((m) => m.id === "progress-card");
      const filteredExtras = hasProgressCard
        ? toolExtras.filter((m) => m.id !== "progress-card")
        : toolExtras;

      let finalMessages = [...newMessages, ...filteredExtras];
      if (response.content) {
        finalMessages = [...finalMessages, {
          id: uid(),
          role: "assistant" as const,
          content: response.content,
          ...(response.thinkingContent ? { thinking: response.thinkingContent } : {}),
        }];
      }
      finalMessages = [...finalMessages, ...contentExtras];

      setMessages(finalMessages);
      saveHistory(finalMessages);
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);
    },
    [inputValue, isLoading, messages, sendToAPI, processToolCalls, processResponseContent, scrollToBottom],
  );

  // ── Sources ready (from SourcesPanel in right column) ──

  const handleSourcesReady = useCallback(
    (data: SourcesReadyData) => {
      if (data.subjects) setData("packSubjectIds", data.subjects.map((s) => s.id));
      if (data.sourceIds) setData("uploadSourceIds", data.sourceIds);

      const fileCards: FileCardData[] = data.classifications.map((c) => ({
        fileName: c.fileName,
        classification: c.documentType,
        subject: data.subjects?.[0]?.name,
        confidence: c.confidence,
        reasoning: c.reasoning,
      }));

      // Add a compact hint in chat (not the full upload UI)
      const uploadMsg: Message = {
        id: uid(),
        role: "system",
        content: `${data.classifications.length} file(s) uploaded — extracting in background`,
        systemType: "upload-result",
        fileCards: fileCards.length ? fileCards : undefined,
      };
      setMessages((prev) => {
        const updated = [...prev, uploadMsg];
        saveHistory(updated);
        return updated;
      });

      // Tell the AI about the uploaded files so it can continue the conversation
      setData("lastUploadClassifications", data.classifications);
      handleSend("Teaching materials uploaded", { lastUploadClassifications: data.classifications });
    },
    [setData, handleSend],
  );

  // ── Extraction done (from SourcesPanel) ─────────────

  const handleExtractionDone = useCallback(
    (totals: { assertions: number; questions: number; vocabulary: number }) => {
      setData("extractionTotals", { ...totals, images: 0 });
    },
    [setData],
  );

  // ── Page-level drag (full-page drop overlay) ─────────

  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setPageDragOver(true);
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setPageDragOver(false);
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setPageDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      sourcesPanelRef.current?.addFiles(e.dataTransfer.files);
      // Peek + glow to show where the files went
      sourcesPanelElRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setSourcesGlow(true);
      setTimeout(() => setSourcesGlow(false), 3000);
    }
  }, []);

  // ── Keyboard ──────────────────────────────────────────

  const hasActiveOptions = messages.some((m) => m.systemType === "options" && !m.resolved);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let the OptionsCard handle keys when it's active
      if (hasActiveOptions) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, hasActiveOptions],
  );

  // Global Esc to dismiss active options card
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasActiveOptions) {
        setMessages((prev) =>
          prev.map((m) =>
            m.systemType === "options" && !m.resolved ? { ...m, resolved: true } : m,
          ),
        );
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasActiveOptions]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, scrollToBottom, resetKey]);

  // ── Render ────────────────────────────────────────────

  if (!isActive) return null;

  const draftCallerId = getData<string>("draftCallerId");
  const draftPlaybookId = getData<string>("draftPlaybookId");
  const draftDomainId = getData<string>("draftDomainId") || getData<string>("existingDomainId");
  const resolvedDomainId = draftDomainId || "";
  const launched = getData<boolean>("launched");

  return (
    <div
      className="cv4-layout"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Full-page drop overlay */}
      {pageDragOver && (
        <div className="hf-drop-overlay">
          <div className="hf-drop-card">
            <Upload size={24} />
            <span>Drop files anywhere to upload</span>
          </div>
        </div>
      )}

      {/* Chat column */}
      <div className="cv4-chat-column">
        <div className="cv4-container">
        {/* Messages */}
        <div className="cv4-messages" aria-live="polite">
          <div className="cv4-messages-spacer" />
          {messages.map((msg) => {
            // Options card — skip if resolved (user already made a selection)
            if (msg.systemType === "options" && !msg.resolved && msg.optionsPanel) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <OptionsCard
                    panel={msg.optionsPanel}
                    onSelect={(_value, displayText) => {
                      setMessages((prev) =>
                        prev.map((m) => m.id === msg.id ? { ...m, resolved: true } : m),
                      );
                      handleSend(displayText);
                    }}
                    onSkip={() => {
                      setMessages((prev) =>
                        prev.map((m) => m.id === msg.id ? { ...m, resolved: true } : m),
                      );
                      handleSend("Skip");
                    }}
                    onSomethingElse={() => {
                      setMessages((prev) =>
                        prev.map((m) => m.id === msg.id ? { ...m, resolved: true } : m),
                      );
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                  />
                </div>
              );
            }
            if (msg.systemType === "options") return null; // resolved — hide

            // Progress panel (legacy inline — skip, now in right column)
            if (msg.systemType === "progress") return null;

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

            if (msg.systemType === "upload-zone") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <div
                    className="cv4-inline-upload-zone"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("cv4-inline-upload-zone--active"); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove("cv4-inline-upload-zone--active"); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.remove("cv4-inline-upload-zone--active");
                      if (e.dataTransfer.files.length > 0) {
                        sourcesPanelRef.current?.addFiles(e.dataTransfer.files);
                        sourcesPanelElRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        setSourcesGlow(true);
                        setTimeout(() => setSourcesGlow(false), 3000);
                      }
                    }}
                    onClick={() => {
                      // Trigger SourcesPanel's file input via its own click handler
                      sourcesPanelElRef.current?.querySelector<HTMLInputElement>("input[type=file]")?.click();
                    }}
                  >
                    <Upload size={20} />
                    <div className="cv4-inline-upload-text">Drop files here or click to browse</div>
                    <div className="cv4-inline-upload-hint">PDF, Word, or text files</div>
                  </div>
                </div>
              );
            }

            if (msg.systemType === "lesson-plan" && msg.lessonEntries) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <LessonPlanAccordion
                    entries={msg.lessonEntries}
                    courseName={msg.lessonCourseName}
                    courseId={msg.lessonCourseId}
                    onTestLesson={draftCallerId ? (session) => {
                      const params = new URLSearchParams({
                        ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                        ...(draftDomainId ? { domainId: draftDomainId } : {}),
                        session: String(session),
                      });
                      window.open(`/x/sim/${draftCallerId}?${params.toString()}`, "_blank", "noopener,noreferrer");
                    } : undefined}
                  />
                </div>
              );
            }

            if (msg.systemType === "first-call-preview" && msg.firstCallPreview) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <FirstCallPreviewCard
                    preview={msg.firstCallPreview}
                    onUpdated={(updated) => {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === msg.id ? { ...m, firstCallPreview: updated } : m,
                        ),
                      );
                      setData("firstCallPreview", updated);
                    }}
                  />
                </div>
              );
            }

            if (msg.role === "assistant") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--assistant">
                  {msg.thinking && <ThinkingBlock content={msg.thinking} />}
                  <div className="cv4-msg-actions-wrap">
                    <div className="cv4-bubble cv4-bubble--assistant">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <MessageActions
                      message={msg}
                      onSend={(text) => handleSend(text)}
                      onPrefill={setInputValue}
                      onFocusInput={() => setTimeout(() => inputRef.current?.focus(), 50)}
                    />
                  </div>
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

          {/* Suggestion chips — inline after last message, not buried at page bottom */}
          {suggestions.items.length > 0 && !welcomeSuggestion && !isLoading && (
            <div className="cv4-row cv4-row--assistant">
              <div className="cv4-suggestions">
                {suggestions.question && (
                  <div className="cv4-suggestions-label">{suggestions.question}</div>
                )}
                <div className="cv4-suggestions-chips">
                  {suggestions.items.map((label) => (
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
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="cv4-input-area">
          {/* Welcome suggestion accept chip */}
          {welcomeSuggestion && (
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

          {/* Text input */}
          <div className="cv4-input-row">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your course, ask a question, or tell me what to change..."
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

          {/* Start over */}
          {messages.length > 1 && (
            <div className="cv4-start-over-row">
              {confirmReset ? (
                <>
                  <span className="cv4-start-over-label">Clear conversation?</span>
                  <button
                    type="button"
                    className="cv4-start-over-confirm"
                    onClick={handleStartOver}
                  >
                    Yes, start over
                  </button>
                  <button
                    type="button"
                    className="cv4-start-over-cancel"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="cv4-start-over-btn"
                  onClick={() => setConfirmReset(true)}
                >
                  Start over
                </button>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Right panel — always visible, shows live course build progress */}
      <div className="cv4-panel-column">
        <ScaffoldPanel
          getData={getData}
          currentStepIndex={99}
          onItemClick={(itemKey) => {
            handleSend(`I'd like to review my ${REVIEW_LABELS[itemKey] ?? itemKey}`);
          }}
        />

        {/* Sources panel — visible once institution/domain resolved */}
        {resolvedDomainId && !launched && (
          <div ref={sourcesPanelElRef}>
            <SourcesPanel
              ref={sourcesPanelRef}
              domainId={resolvedDomainId}
              courseName={getData<string>("courseName") || "Course"}
              interactionPattern={getData<string>("interactionPattern") || undefined}
              teachingMode={getData<string>("teachingMode") || undefined}
              subjectDiscipline={getData<string>("subjectDiscipline") || undefined}
              institutionName={getData<string>("institutionName") || undefined}
              glow={sourcesGlow}
              onSourcesReady={handleSourcesReady}
              onExtractionDone={handleExtractionDone}
            />
          </div>
        )}
      </div>
    </div>
  );
}
