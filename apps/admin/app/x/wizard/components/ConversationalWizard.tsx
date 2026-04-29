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
import { signOut } from "next-auth/react";
import { ArrowUp, Loader2, Check, Upload, Headphones, BookMarked, Link2, Plus } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { MessageActions } from "./MessageActions";
import { SuccessCard } from "./SuccessCard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { JourneyRail } from "@/components/shared/JourneyRail";
import type { SessionEntry } from "@/lib/lesson-plan/types";
import { MiniJourneyRail } from "@/components/shared/MiniJourneyRail";
import { ScaffoldPanel } from "@/components/wizards/ScaffoldPanel";
import { parseOptionsFromText, stripParameterTags } from "@/lib/chat/parse-options";
import { isStudentVisibleDefault } from "@/lib/doc-type-icons";
import { PEDAGOGY_TRIGGER_SLUGS } from "@/lib/wizard/graph-nodes";
import "../wizard.css";


// ── Types ────────────────────────────────────────────────

export interface WizardInitialContext {
  institutionName: string;
  institutionId: string;
  domainId: string;
  domainKind: "INSTITUTION" | "COMMUNITY";
  typeSlug: string | null;
  userRole: string;
  /** Amendment mode: pre-fill from existing course */
  courseId?: string;
  courseName?: string;
  subjectDiscipline?: string;
  interactionPattern?: string;
  teachingMode?: string;
  sessionCount?: number;
  durationMins?: number;
}

interface ConversationalWizardProps {
  initialContext?: WizardInitialContext;
  userRole?: string;
  /** Override wizard version sent to API. Defaults to "v4". */
  wizardVersion?: string;
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
  /** Onboarding phases folded into lesson-plan message for unified rail */
  lessonOnboardingPhases?: Array<{ phase: string; duration?: string }>;
  /** Populated for first-call-preview system messages (standalone fallback) */
  firstCallPreview?: FirstCallPreviewData;
  /** Populated for options system messages */
  optionsPanel?: OptionsPanel;
  /** True after the user has resolved an options card — hides it from render */
  resolved?: boolean;
  /** Extended thinking text from Claude, shown as collapsible block */
  thinking?: string;
}

/**
 * Why the wizard is busy — one state, two visual tiers:
 *
 * FOREGROUND (blocks input, bouncing dots — AI response imminent):
 *   "sending"         — API call in flight
 *   "upload-draining" — file uploaded, waiting for drain to fire handleSend
 *
 * BACKGROUND (blocks input, persistent pill — longer work in progress):
 *   "course-ref-analysing" — COURSE_REFERENCE extraction → digest → AI narration
 *
 * Both tiers disable the send button to prevent concurrent sendToAPI calls.
 * The visual indicator differs so the user knows whether to expect a quick
 * response (dots) or a longer wait (pill with explanation).
 */
type BusyReason =
  | null                     // idle
  | "sending"                // foreground — API call in flight
  | "upload-draining"        // foreground — file uploaded, waiting for drain
  | "course-ref-analysing";  // foreground — extraction + digest in progress

const FOREGROUND_REASONS: BusyReason[] = ["sending", "upload-draining", "course-ref-analysing"];

/** Glow durations for the SourcesPanel upload hint */
const GLOW_DURATION_AI_HINT_MS = 5000;  // AI-initiated (show_upload tool) — longer
const GLOW_DURATION_USER_DROP_MS = 3000; // User-initiated (drag & drop) — shorter

/** Map scaffold item keys to human-readable review phrases */
const REVIEW_LABELS: Record<string, string> = {
  institution: "organisation",
  department: "department",
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

// MessageActions extracted to ./MessageActions.tsx

// ── Step definitions ─────────────────────────────────────

const WIZARD_STEPS: StepDefinition[] = [
  { id: "open", label: "Tell me about your course", activeLabel: "Gathering course details" },
  { id: "personality", label: "Teaching style", activeLabel: "Choosing teaching style" },
  { id: "content", label: "Materials", activeLabel: "Adding materials" },
  { id: "launch", label: "Launch", activeLabel: "Launching course" },
];

// ── Storage ──────────────────────────────────────────────
// Bump to invalidate all cached wizard conversations (e.g. after prompt changes)
const WIZARD_CACHE_VERSION = 1;

function storageKey(version: string): string {
  return `gs-${version}-c${WIZARD_CACHE_VERSION}-history`;
}

function loadHistory(version: string): Message[] {
  try {
    const raw = sessionStorage.getItem(storageKey(version));
    if (!raw) return [];
    const msgs: Message[] = JSON.parse(raw);
    // Strip trailing user message with no AI response (failed send from prior visit)
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
      msgs.pop();
    }
    return msgs;
  } catch {
    return [];
  }
}

function saveHistory(messages: Message[], version: string) {
  try {
    // Don't persist error messages — they're transient and stale errors
    // create a bad experience when the user returns to the page
    const filtered = messages.filter((m) => m.systemType !== "error");
    sessionStorage.setItem(storageKey(version), JSON.stringify(filtered));
  } catch { /* quota */ }
}

// ── ID helper ────────────────────────────────────────────

let idCounter = 0;
function uid(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

/** Insert blank lines before emoji-led lines so markdown renders them as separate paragraphs. */
const EMOJI_LINE_RE = /(?<!\n)\n(?=[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{2300}-\u{23FF}✅❌✓✗•▸►])/gu;
function separateEmojiLines(text: string): string {
  return text.replace(EMOJI_LINE_RE, "\n\n");
}

// ── Context → setup data ─────────────────────────────────

function contextToInitialData(ctx: WizardInitialContext): Record<string, unknown> {
  return {
    institutionName: ctx.institutionName,
    existingInstitutionId: ctx.institutionId,
    existingDomainId: ctx.domainId,
    defaultDomainKind: ctx.domainKind,
    ...(ctx.typeSlug ? { typeSlug: ctx.typeSlug } : {}),
    // Amendment mode: pre-fill course fields
    ...(ctx.courseId ? { draftPlaybookId: ctx.courseId } : {}),
    ...(ctx.courseName ? { courseName: ctx.courseName } : {}),
    ...(ctx.subjectDiscipline ? { subjectDiscipline: ctx.subjectDiscipline } : {}),
    ...(ctx.interactionPattern ? { interactionPattern: ctx.interactionPattern } : {}),
    ...(ctx.teachingMode ? { teachingMode: ctx.teachingMode } : {}),
    ...(ctx.sessionCount ? { sessionCount: ctx.sessionCount } : {}),
    ...(ctx.durationMins ? { durationMins: ctx.durationMins } : {}),
  };
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

export function ConversationalWizard({ initialContext, userRole, wizardVersion = "v4" }: ConversationalWizardProps) {
  const { getData, setData, clearData, isActive, startFlow } = useStepFlow();

  // Scope sessionStorage by institution so step-in doesn't leak across orgs
  const storageScope = initialContext?.institutionId
    ? `${wizardVersion}-${initialContext.institutionId}`
    : wizardVersion;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [busyReason, setBusyReason] = useState<BusyReason>(null);
  const isBusy = busyReason !== null;
  const isForeground = isBusy && FOREGROUND_REASONS.includes(busyReason);
  const isBackground = isBusy && !FOREGROUND_REASONS.includes(busyReason);
  const isSending = busyReason === "sending";
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
  const apiInFlightRef = useRef(false);

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
    sessionStorage.removeItem(storageKey(storageScope));
    clearData();
    setMessages([]);
    setInputValue("");
    setBusyReason(null);
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
      "teachingProfile", "audience", "learningOutcomes",
      "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
      "assessments", "assessmentTargets", "constraints",
      "behaviorTargets", "lessonPlanModel", "personalityPreset", "personalityDescription",
      "physicalMaterials",
      "draftDomainId", "draftInstitutionId", "draftPlaybookId", "draftCallerId",
      "draftCallerName", "draftDemoCallerId", "draftDemoCallerName",
      "launched", "sourceId", "packSubjectIds", "uploadSourceIds", "extractionTotals", "categoryCounts", "contentSkipped",
      "lastUploadClassifications", "courseContext",
      "coursePedagogy", "courseRefDigest", "courseRefEnabled", "_docConfigKeys",
      "welcomeSkipped", "tuneSkipped",
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
      apiInFlightRef.current = true;

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
          _wizardVersion: wizardVersion,
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
          if (res.status === 401) {
            signOut({ callbackUrl: "/login" });
            return { error: "Session expired — redirecting to login…" };
          }
          if (res.status === 403) {
            return { error: "You don't have permission to use Build Course. Ask your admin to upgrade your role." };
          }
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          return { error: err.error || `Server error (${res.status}). Try again in a moment.` };
        }

        const data = await res.json();
        apiInFlightRef.current = false;
        return { data };
      } catch (err) {
        apiInFlightRef.current = false;
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.error(`[wizard-${wizardVersion}] API error:`, err);
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

      // Belt-and-braces: when the AI emits the welcome-flow checklist
      // (dataKey="_welcomePhases"), the checklist's Confirm / Something else / Skip
      // buttons own the decision surface. Drop any redundant show_suggestions chips
      // on the same turn even if the prompt-layer guard is ignored by the model.
      const hasWelcomePhasesChecklist = toolCalls.some(
        (t) => t.name === "show_options"
          && (t.input as { mode?: string; dataKey?: string })?.mode === "checklist"
          && (t.input as { mode?: string; dataKey?: string })?.dataKey === "_welcomePhases",
      );

      for (const tc of toolCalls) {
        switch (tc.name) {
          case "update_setup": {
            const fields = tc.input.fields as Record<string, unknown>;
            const prevSet = (getData<string[]>("userSetFields") ?? []);
            const newSet = new Set(prevSet);
            for (const [k, v] of Object.entries(fields)) {
              // Dedup array fields by identity key to prevent AI re-sends creating duplicates
              const DEDUP_BY_NAME = ["skillsFramework", "coursePhases", "edgeCases"];
              const DEDUP_BY_VALUE = ["learningOutcomes", "assessmentBoundaries", "assessmentTargets", "constraints"];
              if (DEDUP_BY_NAME.includes(k) && Array.isArray(v)) {
                const key = k === "edgeCases" ? "scenario" : "name";
                setData(k, [...new Map((v as Array<Record<string, unknown>>).map(s => [s[key], s])).values()]);
              } else if (DEDUP_BY_VALUE.includes(k) && Array.isArray(v)) {
                setData(k, [...new Set(v as string[])]);
              } else if (k === "teachingPrinciples" && v && typeof v === "object") {
                const tp = v as Record<string, unknown>;
                if (Array.isArray(tp.corePrinciples)) tp.corePrinciples = [...new Set(tp.corePrinciples as string[])];
                setData(k, tp);
              } else {
                setData(k, v);
              }
              newSet.add(k);
            }
            setData("userSetFields", Array.from(newSet));

            // Auto-activate pedagogy nodes when HE detected or COURSE_REFERENCE uploaded
            if (!getData("courseRefEnabled")) {
              const ts = (fields.typeSlug as string) || (getData<string>("typeSlug"));
              const aud = (fields.audience as string) || (getData<string>("audience"));
              if (PEDAGOGY_TRIGGER_SLUGS.has(ts ?? "") || PEDAGOGY_TRIGGER_SLUGS.has(aud ?? "")) {
                setData("courseRefEnabled", true);
              }
            }
            break;
          }

          case "show_suggestions": {
            // welcome-flow checklist owns the decision surface — drop redundant chips
            if (hasWelcomePhasesChecklist) break;
            const items = tc.input.suggestions as string[];
            const question = tc.input.question as string | undefined;
            if (items?.length) setSuggestions({ question, items });
            break;
          }

          case "show_upload": {
            // Peek + glow: scroll SourcesPanel into view and pulse
            sourcesPanelElRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            setSourcesGlow(true);
            setTimeout(() => setSourcesGlow(false), GLOW_DURATION_AI_HINT_MS);

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

      // Check if create_course just completed — lessonPlanPreview + firstCallPreview
      const preview = getData<LessonEntry[]>("lessonPlanPreview");
      const courseName = getData<string>("courseName");
      const playbookId = getData<string>("draftPlaybookId");
      const fcPreview = getData<FirstCallPreviewData>("firstCallPreview");

      if (preview?.length && !getData<boolean>("lessonPlanShown")) {
        setData("lessonPlanShown", true);
        // Fold onboarding phases into lesson-plan message for unified MiniJourneyRail
        const onboardingPhases = fcPreview?.phases?.length
          ? fcPreview.phases.map((p) => ({ phase: p.phase, duration: p.duration }))
          : undefined;
        if (onboardingPhases) setData("firstCallPreviewShown", true);
        extra.push({
          id: uid(),
          role: "system",
          content: "",
          systemType: "lesson-plan",
          lessonEntries: preview,
          lessonCourseName: courseName || undefined,
          lessonCourseId: playbookId || undefined,
          lessonOnboardingPhases: onboardingPhases,
        });
      }

      // Standalone first-call-preview — only if no lesson plan was shown
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
      // If any API call is in flight, queue. Checks both state-based flag
      // (isSending) and the ref (apiInFlightRef — covers background calls
      // from handleExtractionDone that bypass handleSend).
      if (isSending || apiInFlightRef.current) {
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
      saveHistory(newMessages, storageScope);
      scrollToBottom();

      // Promote to "sending" but don't downgrade "course-ref-analysing"
      // (the course-ref flow outlives the initial upload-notification API call).
      setBusyReason((prev) => prev === "course-ref-analysing" ? prev : "sending");
      const result = await sendToAPI(msg, newMessages, overrides);
      setBusyReason((prev) => prev === "sending" ? null : prev);

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
        saveHistory(withErr, storageScope);
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
      saveHistory(finalMessages, storageScope);
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);

      // Drain any upload notification that arrived while AI was loading
      const pending = pendingUploadRef.current;
      if (pending) {
        pendingUploadRef.current = null;
        handleSend(pending.text, pending.overrides);
      }
    },
    [inputValue, isSending, messages, sendToAPI, processToolCalls, processResponseContent, scrollToBottom],
  );

  // ── File processing started (from SourcesPanel) — show typing dots immediately ──

  const handleProcessingStart = useCallback(() => {
    setBusyReason("upload-draining");
    scrollToBottom();
  }, [scrollToBottom]);

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
        isStudentVisible: isStudentVisibleDefault(c.documentType),
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
        saveHistory(withUpload, storageScope);
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

      // Show typing dots immediately. If any file is COURSE_REFERENCE, use
      // "course-ref-analysing" which persists through extraction → digest → AI
      // narration. Otherwise "upload-draining" clears once the drain fires.
      const hasCourseRef = data.classifications.some(
        (c: { documentType: string }) => c.documentType === "COURSE_REFERENCE",
      );
      setBusyReason(hasCourseRef ? "course-ref-analysing" : "upload-draining");
      scrollToBottom();
    },
    [setData, scrollToBottom],
  );

  // ── Drain pending messages after state settles ──
  // Fires when no API call is actively in flight. This covers:
  //  - Upload notifications from handleSourcesReady (drains during "course-ref-analysing")
  //  - User messages queued during background work (drains after setBusyReason(null))
  // Safe because handleSend's queue guard prevents concurrent sendToAPI calls.
  useEffect(() => {
    if (!isSending && pendingUploadRef.current) {
      const pending = pendingUploadRef.current;
      pendingUploadRef.current = null;
      handleSend(pending.text, pending.overrides);
    }
  }, [isSending, messages, handleSend]);

  // ── Extraction done (from SourcesPanel) ─────────────

  const handleExtractionDone = useCallback(
    async (totals: { assertions: number; questions: number; vocabulary: number }) => {
      setData("extractionTotals", { ...totals, images: 0 });

      // Fetch category breakdown (fire-and-forget — ScaffoldPanel picks it up via getData)
      const uploadIds = getData<string[]>("uploadSourceIds");
      if (uploadIds?.length) {
        fetch(`/api/content-sources/category-counts?ids=${uploadIds.join(",")}`)
          .then(r => r.json())
          .then((d: { ok: boolean; categoryCounts?: Record<string, number> }) => {
            if (d.ok && d.categoryCounts) setData("categoryCounts", d.categoryCounts);
          })
          .catch(() => {});
      }

      // Check if any uploaded files were COURSE_REFERENCE — if so, fetch their
      // assertions and build a digest for the wizard AI to reflect back.
      const classifications = getData<Array<{ fileName: string; documentType: string }>>("lastUploadClassifications");
      const sourceIds = getData<string[]>("uploadSourceIds");
      if (!classifications || !sourceIds) { setBusyReason(null); return; }

      const courseRefIndices = classifications
        .map((c, i) => c.documentType === "COURSE_REFERENCE" ? i : -1)
        .filter((i) => i >= 0);
      if (courseRefIndices.length === 0) {
        // Non-COURSE_REFERENCE extraction done — show a quiet status in chat
        // so the user knows their content is ready (no AI round-trip needed).
        const total = totals.assertions + totals.questions + totals.vocabulary;
        if (total > 0) {
          const parts: string[] = [];
          if (totals.assertions > 0) parts.push(`${totals.assertions} teaching pt${totals.assertions !== 1 ? "s" : ""}`);
          if (totals.questions > 0) parts.push(`${totals.questions} question${totals.questions !== 1 ? "s" : ""}`);
          if (totals.vocabulary > 0) parts.push(`${totals.vocabulary} vocab`);
          const doneMsg: Message = {
            id: uid(),
            role: "system",
            content: `${parts.join(" · ")} extracted — ready for your course`,
            systemType: "timeline",
          };
          setMessages((prev) => {
            const updated = [...prev, doneMsg];
            saveHistory(updated, storageScope);
            return updated;
          });
          scrollToBottom();
        }
        setBusyReason(null);
        return;
      }

      // busyReason is already "course-ref-analysing" (set in handleSourcesReady).
      // Ensure it's set in case extraction was triggered without an upload flow.
      setBusyReason("course-ref-analysing");
      scrollToBottom();

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
        if (allAssertions.length === 0) {
          // No assertions extracted — tell the AI so it can prompt the user
          // rather than leaving the chat stuck after "Give me a moment...".
          const fallbackMsg = "Course reference processed but no structured content was extracted — please continue with the conversation";
          const currentMsgs = messagesRef.current;
          const fallbackResult = await sendToAPI(fallbackMsg, [...currentMsgs, { id: uid(), role: "user" as const, content: fallbackMsg }]);
          setBusyReason(null);
          if (fallbackResult && "data" in fallbackResult && fallbackResult.data.content) {
            const assistantMsg: Message = { id: uid(), role: "assistant", content: fallbackResult.data.content };
            const updated = [...messagesRef.current, assistantMsg];
            setMessages(updated);
            saveHistory(updated, storageScope);
            scrollToBottom();
          } else {
            // Safety net — show timeline message so chat isn't stuck
            const safetyMsg: Message = { id: uid(), role: "system", content: "Course reference processed — let's continue setting up your course", systemType: "timeline" };
            setMessages((prev) => { const u = [...prev, safetyMsg]; saveHistory(u, storageScope); return u; });
            scrollToBottom();
          }
          return;
        }

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

        // #167 — detect pedagogy signals (cadence, continuous mode, preset)
        // Scan BOTH extracted assertions AND raw source text. The extractor
        // paraphrases phrases, so regex patterns may not match assertions alone.
        // Raw source text preserves the original markers ("Call duration: 12-15 minutes").
        try {
          const { detectPedagogy, hasPedagogy } = await import("@/lib/wizard/detect-pedagogy");
          const joinedAssertions = allAssertions.map((a) => a.assertion).join("\n");

          // Also fetch textSample from course reference sources — the raw first
          // ~1000 chars preserve the original phrasing that regex detection needs.
          // The extractor paraphrases assertions, so "Call duration: 12-15 minutes"
          // becomes something the regex can't match.
          let rawSourceText = "";
          for (const idx of courseRefIndices) {
            const sid = sourceIds[idx];
            if (!sid) continue;
            try {
              const rawRes = await fetch(`/api/content-sources/${sid}`);
              if (rawRes.ok) {
                const rawData = await rawRes.json();
                if (rawData.source?.textSample) {
                  rawSourceText += rawData.source.textSample + "\n";
                }
              }
            } catch { /* non-fatal */ }
          }

          // Scan both — raw source text first (more reliable), then assertions as fallback
          const combinedText = rawSourceText
            ? `${rawSourceText}\n---\n${joinedAssertions}`
            : joinedAssertions;
          const pedagogy = detectPedagogy(combinedText);
          if (hasPedagogy(pedagogy)) {
            setData("coursePedagogy", pedagogy);
            console.log("[wizard] detected pedagogy from course ref:", pedagogy);
          } else {
            console.warn(
              "[wizard] detectPedagogy found no signals — falling back to defaults",
              {
                assertionCount: allAssertions.length,
                rawSourceLength: rawSourceText.length,
                sample: (rawSourceText || joinedAssertions).slice(0, 200),
              },
            );
          }
          // #179 — detect structured course config block from template v3.0
          try {
            const { detectCourseConfig, hasCourseConfig } = await import("@/lib/wizard/detect-course-config");
            const courseConfig = detectCourseConfig(combinedText);
            if (hasCourseConfig(courseConfig)) {
              // Structured config from the document WINS over AI guesses —
              // BUT only for fields the user/AI hasn't already set.
              // courseName is special: the user names their course, the doc
              // just has a document title. Never overwrite an existing courseName.
              const docKeys: string[] = [];
              const setIfEmpty = (key: string, value: unknown) => {
                if (!getData(key)) {
                  setData(key, value);
                  docKeys.push(key);
                }
              };
              // courseName: only fill if blank — user's chosen name always wins
              if (courseConfig.courseName) setIfEmpty("courseName", courseConfig.courseName);
              // These pedagogy fields: doc config wins (educator checkboxes)
              if (courseConfig.subjectDiscipline) { setData("subjectDiscipline", courseConfig.subjectDiscipline); docKeys.push("subjectDiscipline"); }
              if (courseConfig.interactionPattern) { setData("interactionPattern", courseConfig.interactionPattern); docKeys.push("interactionPattern"); }
              if (courseConfig.teachingMode) { setData("teachingMode", courseConfig.teachingMode); docKeys.push("teachingMode"); }
              if (courseConfig.audience) { setData("audience", courseConfig.audience); docKeys.push("audience"); }
              if (courseConfig.planEmphasis) { setData("planEmphasis", courseConfig.planEmphasis); docKeys.push("planEmphasis"); }
              // Merge precise preset detection into coursePedagogy (overrides detect-pedagogy's looser regex)
              if (courseConfig.pedagogicalPreset) {
                const existing = (getData("coursePedagogy") ?? {}) as Record<string, unknown>;
                setData("coursePedagogy", { ...existing, pedagogicalPreset: courseConfig.pedagogicalPreset.toLowerCase() });
                docKeys.push("pedagogicalPreset");
              }
              if (courseConfig.learningOutcomes?.length) { setData("learningOutcomes", courseConfig.learningOutcomes); docKeys.push("learningOutcomes"); }
              if (docKeys.length > 0) {
                setData("_docConfigKeys", docKeys);
              }
              console.log("[wizard] course config from document (locked keys):", docKeys, courseConfig);
            }
          } catch (configErr) {
            console.warn("[wizard] course config detection failed:", configErr);
          }

          // Auto-extract learning outcomes from assertions if not already set.
          // The AI consistently fails to do this via prompt, so we do it in code.
          if (!getData("learningOutcomes") && allAssertions.length > 0) {
            const OUTCOME_CATS = ["LEARNING_OUTCOME", "SKILL", "COMPETENCY", "OBJECTIVE"];
            const outcomeLike = allAssertions.filter((a) =>
              OUTCOME_CATS.includes(a.category) ||
              a.category === "KEY_CONCEPT" ||
              a.category === "COMPREHENSION_SKILL"
            );
            // Fall back to top assertions from any category if no outcome-specific ones
            const pool = outcomeLike.length >= 3 ? outcomeLike : allAssertions;
            // Deduplicate by text similarity (take first 6 unique-ish)
            const seen = new Set<string>();
            const outcomes: string[] = [];
            for (const a of pool) {
              const key = a.assertion.toLowerCase().slice(0, 40);
              if (!seen.has(key) && a.assertion.length > 10) {
                seen.add(key);
                outcomes.push(a.assertion);
                if (outcomes.length >= 6) break;
              }
            }
            if (outcomes.length >= 2) {
              setData("learningOutcomes", outcomes);
              console.log(`[wizard] auto-extracted ${outcomes.length} learning outcomes from assertions`);
            }
          }
        } catch (err) {
          console.warn("[wizard] pedagogy detection failed:", err);
        }

        // Pre-populate pedagogy blackboard keys from extracted assertions.
        // Document content wins — if the educator uploaded a skill framework, use it.
        const skillAssertions = allAssertions.filter((a) => a.category === "skill_framework");
        if (skillAssertions.length > 0) {
          const skills = skillAssertions.map((a, i) => {
            // Parse "SKILL-01: Name — Description\nEmerging: ...\nDeveloping: ...\nSecure: ..."
            const lines = a.assertion.split("\n");
            const header = lines[0] || "";
            const idMatch = header.match(/^(SKILL-\d+):\s*/);
            const rest = idMatch ? header.slice(idMatch[0].length) : header;
            const [name, desc] = rest.split(" — ");
            const tiers: Record<string, string> = {};
            for (const line of lines.slice(1)) {
              const m = line.match(/^(Emerging|Developing|Secure):\s*(.+)/i);
              if (m) tiers[m[1].toLowerCase()] = m[2];
            }
            return { id: idMatch?.[1] || `SKILL-${String(i + 1).padStart(2, "0")}`, name: name?.trim() || "", description: desc?.trim(), tiers: Object.keys(tiers).length > 0 ? tiers : undefined };
          });
          setData("skillsFramework", skills);
        }

        const ruleAssertions = allAssertions.filter((a) => a.category === "teaching_rule");
        const flowAssertions = allAssertions.filter((a) => a.category === "session_flow" && a.chapter === "Teaching Approach");
        if (ruleAssertions.length > 0 || flowAssertions.length > 0) {
          setData("teachingPrinciples", {
            corePrinciples: ruleAssertions.map((a) => a.assertion),
            sessionStructure: flowAssertions.length > 0 ? { phases: flowAssertions.map((a) => ({ name: a.assertion })) } : undefined,
          });
        }

        const edgeAssertions = allAssertions.filter((a) => a.category === "edge_case");
        if (edgeAssertions.length > 0) {
          setData("edgeCases", edgeAssertions.map((a) => {
            const [scenario, response] = a.assertion.split(": ");
            return { scenario: scenario || a.assertion, response: response || "" };
          }));
        }

        const phaseAssertions = allAssertions.filter((a) => a.category === "session_flow" && a.chapter === "Course Phases");
        if (phaseAssertions.length > 0) {
          setData("coursePhases", phaseAssertions.map((a) => {
            const parts: Record<string, string> = {};
            for (const segment of a.assertion.split(". ")) {
              const [key, ...val] = segment.split(": ");
              if (key && val.length) parts[key.toLowerCase().trim()] = val.join(": ");
            }
            return { name: parts.phase || a.assertion, goal: parts.goal, sessions: parts.sessions };
          }));
        }

        const boundaryAssertions = allAssertions.filter((a) => a.category === "assessment_approach" && a.chapter === "Assessment Boundaries");
        if (boundaryAssertions.length > 0) {
          setData("assessmentBoundaries", boundaryAssertions.map((a) => a.assertion));
        }

        // Activate pedagogy nodes
        setData("courseRefEnabled", true);

        // Send silently — no visible user bubble, just let the AI narrate what it found.
        // Include detected pedagogy in the override payload so it lands on THIS
        // turn (not just subsequent ones after the whitelist picks it up).
        const detectedPedagogy = getData("coursePedagogy");
        const digestOverrides: Record<string, unknown> = { courseRefDigest: digest };
        if (detectedPedagogy) digestOverrides.coursePedagogy = detectedPedagogy;
        const hiddenMsg = "Teaching guide analyzed — here's what I found in your course reference";
        const currentMessages = messagesRef.current;
        const result = await sendToAPI(hiddenMsg, [...currentMessages, { id: uid(), role: "user" as const, content: hiddenMsg }], digestOverrides);
        setBusyReason(null);
        if (result && "data" in result && result.data.content) {
          const assistantMsg: Message = { id: uid(), role: "assistant", content: result.data.content };
          const updated = [...messagesRef.current, assistantMsg];
          setMessages(updated);
          saveHistory(updated, storageScope);
          scrollToBottom();
        } else {
          // API returned no content — show a timeline message so chat isn't stuck
          const fallbackMsg: Message = {
            id: uid(),
            role: "system",
            content: `${digest.totalCount} teaching point${digest.totalCount !== 1 ? "s" : ""} extracted from your course reference`,
            systemType: "timeline",
          };
          setMessages((prev) => {
            const updated = [...prev, fallbackMsg];
            saveHistory(updated, storageScope);
            return updated;
          });
          scrollToBottom();
        }
      } catch {
        setBusyReason(null);
        // Non-critical — show a status message so the chat isn't stuck after
        // "Give me a moment..." with no follow-up.
        const fallbackDone: Message = {
          id: uid(),
          role: "system",
          content: "Course reference processed — I'll use it to shape your course",
          systemType: "timeline",
        };
        setMessages((prev) => {
          const updated = [...prev, fallbackDone];
          saveHistory(updated, storageScope);
          return updated;
        });
        scrollToBottom();
      }
    },
    [setData, getData, sendToAPI, scrollToBottom],
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
      setTimeout(() => setSourcesGlow(false), GLOW_DURATION_USER_DROP_MS);
    }
  }, []);

  // ── Keyboard ──────────────────────────────────────────

  const hasActiveOptions = messages.some((m) => m.systemType === "options" && !m.resolved);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isForeground) return; // Don't send while foreground-busy — background work allows input
        // If user typed text, auto-resolve any active options card and send
        if (hasActiveOptions && inputValue.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.systemType === "options" && !m.resolved ? { ...m, resolved: true } : m,
            ),
          );
        }
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
    [handleSend, hasActiveOptions, inputValue, isForeground],
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
  // Always call startFlow on mount — replaces any stale flow from a previous
  // course build so the RHS panel doesn't show leftover data.

  const flowStartedRef = useRef(false);
  useEffect(() => {
    if (!flowStartedRef.current) {
      flowStartedRef.current = true;
      startFlow({
        flowId: `get-started-${wizardVersion}`,
        steps: WIZARD_STEPS,
        returnPath: `/x/get-started-${wizardVersion}`,
        initialData: initialContext ? contextToInitialData(initialContext) : undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync initialContext into active flow (covers remount after institution fetch + reset) ──

  useEffect(() => {
    if (initialContext && isActive && !getData("institutionName")) {
      for (const [k, v] of Object.entries(contextToInitialData(initialContext))) {
        setData(k, v);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContext, isActive, resetKey]);

  // ── Init ──────────────────────────────────────────────

  useEffect(() => {
    if (!isActive || initialised.current) return;
    initialised.current = true;

    // Always start fresh — stale sessionStorage causes more UX issues than it solves.
    // The wizard is short enough that resuming mid-conversation is rarely needed.
    sessionStorage.removeItem(storageKey(storageScope));

    const hasContext = !!initialContext;
    const greeting: Message = {
      id: uid(),
      role: "assistant",
      content: hasContext
        ? `Hi! I can see you're at **${initialContext!.institutionName}**. Tell me about the course you want to set up — subject, level, and how many sessions you're thinking.`
        : "Hi! I'll help you set up your AI tutor. Tell me about the course you want to create — what subject, who it's for, and roughly how many sessions.",
    };
    setMessages([greeting]);
    saveHistory([greeting], storageScope);
    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, scrollToBottom, resetKey]);

  // ── Clipboard (must be above early return to respect Rules of Hooks) ──
  const { copied: linkCopied, copy: copyLink } = useCopyToClipboard();

  // ── Render ────────────────────────────────────────────

  if (!isActive) return null;

  const draftCallerId = getData<string>("draftCallerId");
  const draftCallerName = getData<string>("draftCallerName");
  const draftDemoCallerId = getData<string>("draftDemoCallerId");
  const draftDemoCallerName = getData<string>("draftDemoCallerName");
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
            // If the welcome-flow checklist is currently unresolved, suppress
            // fallback chips on the last assistant message — the checklist
            // owns the decision surface.
            const welcomeChecklistActive = messages.some(
              (m) => m.systemType === "options"
                && !m.resolved
                && (m.optionsPanel as { dataKey?: string } | undefined)?.dataKey === "_welcomePhases",
            );
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
                      // Reset page-level drag overlay (stopPropagation blocks parent onDrop)
                      dragCounterRef.current = 0;
                      setPageDragOver(false);
                      if (e.dataTransfer.files.length > 0) {
                        sourcesPanelRef.current?.addFiles(e.dataTransfer.files);
                        sourcesPanelElRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        setSourcesGlow(true);
                        setTimeout(() => setSourcesGlow(false), GLOW_DURATION_USER_DROP_MS);
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
                  <MiniJourneyRail
                    entries={msg.lessonEntries}
                    courseId={msg.lessonCourseId}
                    courseName={msg.lessonCourseName}
                    onboardingPhases={msg.lessonOnboardingPhases}
                  />
                </div>
              );
            }

            if (msg.systemType === "first-call-preview" && msg.firstCallPreview) {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <JourneyRail
                    variant="timeline"
                    sessions={previewToSessionEntries(msg.firstCallPreview)}
                    courseId=""
                    readonly
                  />
                </div>
              );
            }

            if (msg.systemType === "success-card") {
              return (
                <div key={msg.id} className="cv4-row cv4-row--system">
                  <SuccessCard
                    draftCallerId={draftCallerId}
                    draftCallerName={draftCallerName}
                    draftDemoCallerId={draftDemoCallerId}
                    draftDemoCallerName={draftDemoCallerName}
                    draftPlaybookId={draftPlaybookId}
                    draftDomainId={resolvedDomainId}
                    communityJoinToken={communityJoinToken}
                    confirmReset={confirmReset}
                    linkCopied={linkCopied}
                    onStartOver={handleStartOver}
                    onConfirmReset={() => setConfirmReset(true)}
                    onCopyLink={copyLink}
                  />
                </div>
              );
            }

            if (msg.role === "assistant") {
              const isLast = !isForeground && suggestions.items.length === 0 && !welcomeSuggestion && msg.id === lastAssistantId;
              const parsed = isLast ? parseOptionsFromText(msg.content) : [];
              // Fallback: if no chips from show_suggestions or text parsing,
              // ALWAYS show default chips on the last assistant message.
              // The AI must never leave the user with no visible next action.
              // Exception: when the welcome-flow checklist is the active decision
              // surface, fallback chips would be redundant (checklist already has
              // Confirm / Something else / Skip).
              const needsFallback = isLast && parsed.length === 0 && !welcomeChecklistActive;
              const inlineOptions = parsed.length > 0
                ? parsed
                : needsFallback
                  ? [
                      { marker: "1", label: "Continue", fullText: "Continue" },
                      { marker: "2", label: "I have a question", fullText: "I have a question" },
                    ]
                  : [];
              const displayContent = separateEmojiLines(stripParameterTags(msg.content));
              return (
                <div key={msg.id} className="cv4-row cv4-row--assistant">
                  {msg.thinking && <ThinkingBlock content={msg.thinking} />}
                  <div className="cv4-msg-actions-wrap">
                    <div className="cv4-bubble cv4-bubble--assistant">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
                    </div>
                    <MessageActions
                      message={msg}
                      onSend={(text) => handleSend(text)}
                      onPrefill={setInputValue}
                      onFocusInput={() => setTimeout(() => inputRef.current?.focus(), 50)}
                    />
                  </div>
                  {/* Inline options — lightweight chips instead of heavy OptionsCard */}
                  {inlineOptions.length > 0 && (
                    <div className="cv4-suggestions cv4-suggestions--inline">
                      <div className="cv4-suggestions-chips">
                        {inlineOptions.map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            className="cv4-suggestion-chip"
                            onClick={() => handleSend(opt.label)}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="cv4-suggestion-chip cv4-suggestion-chip--subtle"
                          onClick={() => {
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                        >
                          Something else
                        </button>
                      </div>
                    </div>
                  )}
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

          {/* Foreground typing indicator — AI response imminent */}
          {isForeground && (
            <div className="cv4-row cv4-row--assistant">
              <div className="cv4-typing">
                <div className="cv4-typing-dot" />
                <div className="cv4-typing-dot" />
                <div className="cv4-typing-dot" />
              </div>
            </div>
          )}

          {/* Suggestion chips — inline after last message, not buried at page bottom */}
          {suggestions.items.length > 0 && !welcomeSuggestion && !isForeground && (
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
          {/* Background activity — pinned above input so it persists on scroll */}
          {isBackground && (
            <div className="cv4-background-activity">
              <span className="cv4-sources-pulse" />
              <span>Analysing your teaching materials...</span>
            </div>
          )}

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
          {fieldPickerPanel && !isForeground && (
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

            {isForeground ? (
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
              key={resetKey}
              ref={sourcesPanelRef}
              domainId={resolvedDomainId}
              courseName={getData<string>("courseName") || "Course"}
              interactionPattern={getData<string>("interactionPattern") || undefined}
              teachingMode={getData<string>("teachingMode") || undefined}
              subjectDiscipline={getData<string>("subjectDiscipline") || undefined}
              subjectId={getData<string>("subjectId") || undefined}
              institutionName={getData<string>("institutionName") || undefined}
              glow={sourcesGlow}
              onProcessingStart={handleProcessingStart}
              onSourcesReady={handleSourcesReady}
              onExtractionDone={handleExtractionDone}
            />
          </div>
        )}
      </div>
    </div>
  );
}
