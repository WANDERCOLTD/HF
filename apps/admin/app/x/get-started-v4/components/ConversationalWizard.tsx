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
import { ArrowUp, Loader2, MoreHorizontal, AlertCircle, HelpCircle, ChevronsRight, Copy, Quote, Check, Upload, Headphones, BookMarked, Link2, Plus } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import ReactMarkdown from "react-markdown";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { FileCard } from "./FileCard";
import type { FileCardData } from "./FileCard";
import type { LessonEntry } from "./LessonPlanAccordion";
import { OptionsCard } from "./OptionsCard";
import type { OptionsPanel } from "./OptionsCard";
import { SourcesPanel } from "./SourcesPanel";
import type { SourcesReadyData, SourcesPanelHandle } from "./SourcesPanel";
import type { FirstCallPreviewData } from "./FirstCallPreviewCard";
import { SessionPlanViewer } from "@/components/shared/SessionPlanViewer";
import type { SessionEntry } from "@/lib/lesson-plan/types";
import { ScaffoldPanel } from "@/components/wizards/ScaffoldPanel";
import { parseOptionsFromText } from "@/lib/chat/parse-options";
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
  userRole?: string;
}

type MessageRole = "assistant" | "user" | "system";
type SystemType = "timeline" | "success" | "success-card" | "error" | "upload-result" | "upload-zone" | "lesson-plan" | "first-call-preview" | "options" | "progress";

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
  welcome: "welcome message and session settings",
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
const WIZARD_FIELD_PICKER_KEY = "wizard.field-picker";

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

// ── Adapter: LessonEntry → SessionEntry for wizard snapshot ──

function toSessionEntries(entries: LessonEntry[]): SessionEntry[] {
  return entries.map((e) => ({
    session: e.session,
    type: e.type,
    moduleId: null,
    moduleLabel: "",
    label: e.label,
    notes: e.notes || null,
    estimatedDurationMins: e.estimatedDurationMins || null,
    assertionCount: e.teachingPointCount || null,
    phases: null,
    learningOutcomeRefs: null,
    assertionIds: null,
    media: null,
  }));
}

// ── Adapter: FirstCallPreviewData → SessionEntry[] for wizard snapshot ──

function previewToSessionEntries(preview: FirstCallPreviewData): SessionEntry[] {
  return [{
    session: 1,
    type: "onboarding",
    moduleId: null,
    moduleLabel: "",
    label: "First Call",
    notes: null,
    estimatedDurationMins: null,
    assertionCount: null,
    phases: preview.phases.map((p) => ({
      id: p.phase,
      label: p.phase.charAt(0).toUpperCase() + p.phase.slice(1),
      durationMins: parseInt(p.duration) || undefined,
      media: p.content.map((c) => ({
        mediaId: c.mediaId,
        fileName: c.fileName,
      })),
    })),
    learningOutcomeRefs: null,
    assertionIds: null,
    media: null,
  }];
}

// ── Component ────────────────────────────────────────────

export function ConversationalWizard({ initialContext, userRole }: ConversationalWizardProps) {
  const { getData, setData, clearData, isActive, startFlow } = useStepFlow();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<{ question?: string; items: string[] }>({ items: [] });
  const [welcomeSuggestion, setWelcomeSuggestion] = useState<string | null>(null);
  const [fieldPickerPanel, setFieldPickerPanel] = useState<OptionsPanel | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages; // always fresh for async callbacks
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialised = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Upload discoverability — peek+glow + page-level drag
  const sourcesPanelRef = useRef<SourcesPanelHandle>(null);
  const sourcesPanelElRef = useRef<HTMLDivElement>(null);
  const [sourcesGlow, setSourcesGlow] = useState(false);
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const dropCooldownRef = useRef(false);
  // Pending upload notification — queued when upload completes while AI is loading
  const pendingUploadRef = useRef<{ text: string; overrides: Record<string, unknown> } | null>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  // ── Scroll ───────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }, 50);
  }, []);

  // ── Start over ───────────────────────────────────────

  const handleStartOver = useCallback(() => {
    abortRef.current?.abort();
    sessionStorage.removeItem(HISTORY_KEY);
    clearData();
    setMessages([]);
    setInputValue("");
    setIsLoading(false);
    setSuggestions({ items: [] });
    setWelcomeSuggestion(null);
    setFieldPickerPanel(null);
    setConfirmReset(false);
    initialised.current = false;
    setResetKey((n) => n + 1);
  }, [clearData]);

  // ── Setup data ────────────────────────────────────────

  const getSetupData = useCallback((): Record<string, unknown> => {
    const keys = [
      "institutionName", "existingInstitutionId", "existingDomainId",
      "typeSlug", "defaultDomainKind", "websiteUrl",
      "courseName", "subjectDiscipline", "interactionPattern", "teachingMode",
      "teachingProfile",
      "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
      "behaviorTargets", "lessonPlanModel", "personalityPreset", "physicalMaterials",
      "draftDomainId", "draftInstitutionId", "draftPlaybookId", "draftCallerId",
      "launched", "sourceId", "packSubjectIds", "extractionTotals", "contentSkipped",
      "lastUploadClassifications",
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
    async (userMessage: string, history: Message[], overrides?: Record<string, unknown>): Promise<{ data: WizardResponse } | { error: string } | null> => {
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
          if (res.status === 401) return { error: "Your session has expired. Please refresh the page and log in again." };
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          return { error: err.error || `Server error (${res.status}). Try again in a moment.` };
        }

        return { data: await res.json() };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.error("[wizard-v4] API error:", err);
        return { error: "Network issue — check your connection and try again." };
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
            const prevSet = (getData<string[]>("userSetFields") ?? []);
            const newSet = new Set(prevSet);
            for (const [k, v] of Object.entries(fields)) {
              setData(k, v);
              newSet.add(k);
            }
            setData("userSetFields", Array.from(newSet));
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
            const fieldPickerEnabled = localStorage.getItem(WIZARD_FIELD_PICKER_KEY) !== "false";
            if (tc.input.fieldPicker && fieldPickerEnabled) {
              // Field picker renders above the input bar, not in the message stream
              setFieldPickerPanel(tc.input as unknown as OptionsPanel);
            } else {
              extras.push({
                id: uid(),
                role: "system",
                systemType: "options",
                content: tc.input.question as string,
                optionsPanel: tc.input as unknown as OptionsPanel,
              });
            }
            break;
          }

          case "mark_complete": {
            if (!getData<boolean>("launched")) {
              setData("launched", true);
              extras.push({
                id: "success-card",
                role: "system",
                systemType: "success-card",
                content: "Course launched",
              });
            }
            break;
          }
        }
      }

      return extras;
    },
    [getData, setData, setFieldPickerPanel],
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
      if (!msg) return;
      // If AI is mid-response, queue the message to send once it finishes
      if (isLoading) {
        pendingUploadRef.current = { text: msg, overrides: overrides || {} };
        return;
      }

      // Track input history for arrow-up recall (only real user input, not auto-messages)
      if (!text) {
        const history = inputHistoryRef.current;
        if (history[history.length - 1] !== msg) {
          history.push(msg);
          if (history.length > 50) history.shift();
        }
        historyIndexRef.current = -1;
      }

      setInputValue("");
      setSuggestions({ items: [] });
      setWelcomeSuggestion(null);

      const userMsg: Message = { id: uid(), role: "user", content: msg };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      saveHistory(newMessages);
      scrollToBottom();

      setIsLoading(true);
      const result = await sendToAPI(msg, newMessages, overrides);
      setIsLoading(false);

      if (!result) {
        // Aborted — no error to show
        return;
      }

      if ("error" in result) {
        // Restore the user's message so they can retry without retyping
        setInputValue(msg);
        const errMsg: Message = {
          id: uid(),
          role: "system",
          content: result.error,
          systemType: "error",
        };
        const withErr = [...newMessages, errMsg];
        setMessages(withErr);
        saveHistory(withErr);
        scrollToBottom();
        setTimeout(() => inputRef.current?.focus(), 150);
        return;
      }

      const response = result.data;
      const toolExtras = response.toolCalls?.length ? processToolCalls(response.toolCalls) : [];
      const contentExtras = processResponseContent(response.content, response.toolCalls || []);

      // Deduplicate stable-id cards (progress-card, success-card) — add once, never duplicate
      const stableIds = new Set(newMessages.filter((m) => m.id === "progress-card" || m.id === "success-card").map((m) => m.id));
      const filteredExtras: Message[] = [];
      for (const m of toolExtras) {
        if (m.id === "progress-card" || m.id === "success-card") {
          if (stableIds.has(m.id)) continue;
          stableIds.add(m.id);
        }
        filteredExtras.push(m);
      }

      // Success card should appear AFTER the AI text so it stays visible on scroll
      const preExtras = filteredExtras.filter((m) => m.systemType !== "success-card");
      const postExtras = filteredExtras.filter((m) => m.systemType === "success-card");

      let finalMessages = [...newMessages, ...preExtras];
      if (response.content) {
        finalMessages = [...finalMessages, {
          id: uid(),
          role: "assistant" as const,
          content: response.content,
          ...(response.thinkingContent ? { thinking: response.thinkingContent } : {}),
        }];
      }
      finalMessages = [...finalMessages, ...contentExtras, ...postExtras];

      // Deduplicate stable-id cards (progress-card, success-card) — keep last occurrence
      const stableCardIds = ["progress-card", "success-card"];
      const seen = new Set<string>();
      finalMessages = finalMessages.reverse().filter((m) => {
        if (stableCardIds.includes(m.id)) {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
        }
        return true;
      }).reverse();

      setMessages(finalMessages);
      saveHistory(finalMessages);
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);

      // Drain any upload notification that arrived while AI was loading
      const pending = pendingUploadRef.current;
      if (pending) {
        pendingUploadRef.current = null;
        handleSend(pending.text, pending.overrides);
      }
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
        // Collapse any inline upload-zone messages now that files are uploaded
        const updated = prev.map((m) =>
          m.systemType === "upload-zone" ? { ...m, resolved: true } : m,
        );
        const withUpload = [...updated, uploadMsg];
        saveHistory(withUpload);
        return withUpload;
      });

      // Tell the AI about the uploaded files so it can continue the conversation.
      // ALWAYS queue (never call handleSend synchronously) — the setMessages above
      // marks upload-zone as resolved, but handleSend's closure captures stale
      // `messages` and would overwrite the resolved flag. Queuing lets the state
      // settle first; the pending drain runs after the next render cycle.
      setData("lastUploadClassifications", data.classifications);
      const uploadOverrides = { lastUploadClassifications: data.classifications };
      pendingUploadRef.current = { text: "Teaching materials uploaded", overrides: uploadOverrides };
    },
    [setData],
  );

  // ── Drain pending upload notification after state settles ──
  // handleSourcesReady always queues (never calls handleSend synchronously)
  // so we need this effect to drain once isLoading is false.
  useEffect(() => {
    if (!isLoading && pendingUploadRef.current) {
      const pending = pendingUploadRef.current;
      pendingUploadRef.current = null;
      handleSend(pending.text, pending.overrides);
    }
  }, [isLoading, messages, handleSend]); // messages dep ensures we run after setMessages settles

  // ── Extraction done (from SourcesPanel) ─────────────

  const handleExtractionDone = useCallback(
    async (totals: { assertions: number; questions: number; vocabulary: number }) => {
      setData("extractionTotals", { ...totals, images: 0 });

      // Check if any uploaded files were COURSE_REFERENCE — if so, fetch their
      // assertions and build a digest for the wizard AI to reflect back.
      const classifications = getData<Array<{ fileName: string; documentType: string }>>("lastUploadClassifications");
      const sourceIds = getData<string[]>("uploadSourceIds");
      if (!classifications || !sourceIds) return;

      const courseRefIndices = classifications
        .map((c, i) => c.documentType === "COURSE_REFERENCE" ? i : -1)
        .filter((i) => i >= 0);
      if (courseRefIndices.length === 0) return;

      // Fetch assertions for COURSE_REFERENCE sources and build a digest
      try {
        const allAssertions: Array<{ assertion: string; category: string; chapter?: string }> = [];
        for (const idx of courseRefIndices) {
          const sid = sourceIds[idx];
          if (!sid) continue;
          const res = await fetch(`/api/content-sources/${sid}/assertions?limit=500`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.assertions) {
            for (const a of data.assertions) {
              allAssertions.push({
                assertion: a.assertion,
                category: a.category,
                chapter: a.chapter || undefined,
              });
            }
          }
        }
        if (allAssertions.length === 0) return;

        // Build digest: category counts + 2 samples per top category (max 10 samples)
        const catCounts: Record<string, number> = {};
        for (const a of allAssertions) {
          catCounts[a.category] = (catCounts[a.category] || 0) + 1;
        }
        const topCats = Object.entries(catCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cat]) => cat);
        const samples: typeof allAssertions = [];
        for (const cat of topCats) {
          const matching = allAssertions.filter((a) => a.category === cat);
          for (const m of matching.slice(0, 2)) {
            if (samples.length >= 10) break;
            samples.push(m);
          }
        }

        const digest = { categoryBreakdown: catCounts, sampleAssertions: samples, totalCount: allAssertions.length };
        setData("courseRefDigest", digest);

        // Send silently — no visible user bubble, just let the AI narrate what it found
        const digestOverrides = { courseRefDigest: digest };
        const hiddenMsg = "Teaching guide analyzed — here's what I found in your course reference";
        const currentMessages = messagesRef.current;
        setIsLoading(true);
        const result = await sendToAPI(hiddenMsg, [...currentMessages, { id: uid(), role: "user" as const, content: hiddenMsg }], digestOverrides);
        setIsLoading(false);
        if (result && "data" in result && result.data.content) {
          const assistantMsg: Message = { id: uid(), role: "assistant", content: result.data.content };
          const updated = [...messagesRef.current, assistantMsg];
          setMessages(updated);
          saveHistory(updated);
          scrollToBottom();
        }
      } catch {
        // Non-critical — fall back to classification-only narration
      }
    },
    [setData, getData, sendToAPI, setIsLoading, scrollToBottom],
  );

  // ── Page-level drag (full-page drop overlay) ─────────

  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dropCooldownRef.current) return;
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setPageDragOver(true);
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setPageDragOver(false);
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setPageDragOver(false);
    // Brief cooldown — browsers (especially Safari) fire stray dragenter after drop
    dropCooldownRef.current = true;
    setTimeout(() => { dropCooldownRef.current = false; }, 200);
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
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Let the OptionsCard handle keys when it's active
      if (hasActiveOptions) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Arrow-up/down: cycle through input history (only at cursor start / empty input)
      const history = inputHistoryRef.current;
      if (!history.length) return;
      const ta = e.currentTarget;
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;

      if (e.key === "ArrowUp" && (atStart || !inputValue)) {
        e.preventDefault();
        const idx = historyIndexRef.current === -1
          ? history.length - 1
          : Math.max(historyIndexRef.current - 1, 0);
        historyIndexRef.current = idx;
        setInputValue(history[idx]);
      } else if (e.key === "ArrowDown" && historyIndexRef.current !== -1) {
        e.preventDefault();
        const idx = historyIndexRef.current + 1;
        if (idx >= history.length) {
          historyIndexRef.current = -1;
          setInputValue("");
        } else {
          historyIndexRef.current = idx;
          setInputValue(history[idx]);
        }
      }
    },
    [handleSend, hasActiveOptions, inputValue],
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
  }, [isActive, scrollToBottom, resetKey]);

  // ── Clipboard (must be above early return to respect Rules of Hooks) ──
  const { copied: linkCopied, copy: copyLink } = useCopyToClipboard();

  // ── Render ────────────────────────────────────────────

  if (!isActive) return null;

  const draftCallerId = getData<string>("draftCallerId");
  const draftPlaybookId = getData<string>("draftPlaybookId");
  const draftDomainId = getData<string>("draftDomainId") || getData<string>("existingDomainId");
  const resolvedDomainId = draftDomainId || "";
  const launched = getData<boolean>("launched");
  const communityJoinToken = getData<string>("communityJoinToken");

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
          {(() => {
            const lastAssistantId = [...messages].reverse().find(m => m.role === "assistant")?.id;
            return messages.map((msg) => {
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

            if (msg.systemType === "upload-zone" && msg.resolved) return null;
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
                  <SessionPlanViewer
                    variant="timeline"
                    entries={toSessionEntries(msg.lessonEntries)}
                    courseId={msg.lessonCourseId}
                    readonly
                  />
                </div>
              );
            }

            if (msg.systemType === "first-call-preview" && msg.firstCallPreview) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <SessionPlanViewer
                    variant="timeline"
                    entries={previewToSessionEntries(msg.firstCallPreview)}
                    readonly
                  />
                </div>
              );
            }

            if (msg.systemType === "success-card") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <div className="cv4-success-card">
                    <div className="cv4-success-title">Your AI tutor is ready</div>
                    <div className="cv4-success-sub">
                      {draftCallerId
                        ? "View your course, share it with someone, or try it out."
                        : "View your course or head to your dashboard."}
                    </div>
                    <div className="cv4-success-actions">
                      {/* Primary — view course */}
                      {draftPlaybookId && (
                        <a
                          href={`/x/courses/${draftPlaybookId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hf-btn hf-btn-primary cv4-success-primary"
                        >
                          <BookMarked size={16} /> View Your Course
                        </a>
                      )}

                      {/* Secondary row — sharing + sim call */}
                      <div className="cv4-success-row">
                        {draftCallerId && (
                          <a
                            href={`/x/sim/${draftCallerId}?${new URLSearchParams({
                              forceFirstCall: "true",
                              ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                              ...(draftDomainId ? { domainId: draftDomainId } : {}),
                            }).toString()}`}
                            className="hf-btn hf-btn-secondary cv4-success-btn-half"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Headphones size={14} /> Try a Sim Call
                          </a>
                        )}
                        {(communityJoinToken || draftCallerId) && (
                          <button
                            type="button"
                            className="hf-btn hf-btn-secondary cv4-success-btn-half"
                            onClick={() => {
                              const url = communityJoinToken
                                ? `${window.location.origin}/join/${communityJoinToken}`
                                : `${window.location.origin}/x/sim/${draftCallerId}?${new URLSearchParams({
                                    forceFirstCall: "true",
                                    ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                                    ...(draftDomainId ? { domainId: draftDomainId } : {}),
                                  }).toString()}`;
                              copyLink(url, "tryit");
                            }}
                          >
                            {linkCopied ? <><Check size={14} /> Copied!</> : <><Link2 size={14} /> Copy Try-It Link</>}
                          </button>
                        )}
                      </div>

                      {/* Tertiary — create another */}
                      <div className="cv4-success-row">
                        <button
                          type="button"
                          className="hf-btn hf-btn-secondary cv4-success-btn-half"
                          onClick={() => {
                            if (!confirmReset) { setConfirmReset(true); return; }
                            handleStartOver();
                          }}
                        >
                          {confirmReset
                            ? "Confirm — Start Fresh"
                            : <><Plus size={14} /> Create Another Course</>}
                        </button>
                      </div>

                      {/* Dashboard — text link, opens new tab */}
                      <a
                        href={draftDomainId ? `/x/educator` : "/x"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cv4-success-link"
                      >
                        Go to Dashboard &rarr;
                      </a>
                    </div>
                  </div>
                </div>
              );
            }

            if (msg.role === "assistant") {
              const isLast = !isLoading && suggestions.items.length === 0 && !welcomeSuggestion && msg.id === lastAssistantId;
              const inlineOptions = isLast ? parseOptionsFromText(msg.content) : [];
              return (
                <div key={msg.id} className="cv4-row cv4-row--assistant">
                  {msg.thinking && <ThinkingBlock content={msg.thinking} />}
                  <div className="cv4-msg-actions-wrap">
                    <div className="cv4-bubble cv4-bubble--assistant">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                      {inlineOptions.length > 0 && (
                        <ul className="cv4-inline-options" role="listbox">
                          {inlineOptions.map((opt, i) => (
                            <li
                              key={i}
                              className="cv4-option-row"
                              role="option"
                              onClick={() => handleSend(opt.label)}
                            >
                              <span className="cv4-option-number">{i + 1}</span>
                              <div className="cv4-option-body">
                                <span className="cv4-option-label">{opt.label}</span>
                                {opt.description && (
                                  <span className="cv4-option-desc">{opt.description}</span>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
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
          });
          })()}

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
                  className="hf-btn hf-btn-primary hf-btn-sm"
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
                  className="hf-btn hf-btn-secondary hf-btn-sm"
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

          {/* Field picker panel — shown above input when AI calls show_options with fieldPicker: true */}
          {fieldPickerPanel && !isLoading && (
            <div className="cv4-field-picker-panel">
              <OptionsCard
                panel={fieldPickerPanel}
                onSelect={(_value, displayText) => {
                  setFieldPickerPanel(null);
                  handleSend(`Change ${displayText.toLowerCase()}`);
                }}
                onSkip={() => {
                  setFieldPickerPanel(null);
                  handleSend("Looks good, let's build it");
                }}
                onSomethingElse={() => {
                  setFieldPickerPanel(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
              />
            </div>
          )}

          {/* Text input */}
          <div className="cv4-input-row">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); historyIndexRef.current = -1; }}
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

          {/* Start over — hidden when launched (moved into success card) */}
          {messages.length > 1 && !launched && (
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
          currentStepIndex={-1}
          onItemClick={(itemKey) => {
            handleSend(`I'd like to review my ${REVIEW_LABELS[itemKey] ?? itemKey}`);
          }}
        />

        {/* Sources panel — always visible so files can be queued before domain exists */}
        {!launched && (
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
