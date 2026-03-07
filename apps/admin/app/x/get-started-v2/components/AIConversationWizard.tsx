"use client";

/**
 * AIConversationWizard — AI-driven conversational onboarding for Get Started V2.
 *
 * Uses the "Conversational Form" pattern: system controls the phase sequence,
 * AI controls the phrasing. One panel per turn. Phase separators in chat.
 * Undo toast for radio auto-submit. Send button becomes spinner during loading.
 *
 * Tool calls from /api/chat mode=WIZARD:
 *   - update_setup → saves data, updates ScaffoldPanel
 *   - show_options / show_sliders / show_upload / show_actions → renders OptionPanel above input bar
 *   - create_institution / create_course → triggers server-side creation
 *   - mark_complete → signals done
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { ArrowUp, Loader2, Paperclip, Undo2 } from "lucide-react";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { PackUploadStep } from "@/components/wizards/PackUploadStep";
import type { PackUploadResult } from "@/components/wizards/PackUploadStep";
import { ExtractionSummary } from "@/components/shared/ExtractionSummary";
import { ScaffoldPanel } from "../../get-started/components/ScaffoldPanel";
import { OptionPanel, type PanelConfig, type OptionDef, type SlidersPanel } from "./OptionPanel";
import { computeCurrentPhase, PERSONALITY_SLIDERS } from "./wizard-schema";
import "../get-started-v2.css";

// ── Types ────────────────────────────────────────────────

/** Pre-resolved institution context passed from the server component. */
export interface WizardInitialContext {
  institutionName: string;
  institutionId: string;
  domainId: string;
  domainKind: "INSTITUTION" | "COMMUNITY";
  typeSlug: string | null;
  userRole: string;
}

interface AIConversationWizardProps {
  initialContext?: WizardInitialContext;
}

interface Message {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  systemType?: "timeline" | "success" | "error" | "extraction-summary";
}

interface WizardToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface WizardResponse {
  content: string;
  toolCalls: WizardToolCall[];
  toolCallCount: number;
}

interface UndoState {
  dataKey: string;
  previousValue: unknown;
  displayText: string;
  timerId: ReturnType<typeof setTimeout>;
}

// ── Helpers ───────────────────────────────────────────────

/** Map server-provided context to StepFlowContext data keys. */
function contextToInitialData(ctx: WizardInitialContext): Record<string, unknown> {
  return {
    institutionName: ctx.institutionName,
    existingInstitutionId: ctx.institutionId,
    existingDomainId: ctx.domainId,
    defaultDomainKind: ctx.domainKind,
    ...(ctx.typeSlug ? { typeSlug: ctx.typeSlug } : {}),
  };
}

const ESCAPE_HATCH_LABELS = ["Different institution", "New institution"];

// ── Personality Card — visual summary after slider config ──

function PersonalityCard({ values }: { values: Record<string, number> }) {
  return (
    <div className="gs-personality-card">
      <div className="gs-personality-title">Your AI&apos;s personality</div>
      <div className="gs-personality-bars">
        {PERSONALITY_SLIDERS.map((s) => {
          const pct = values[s.key] ?? 50;
          return (
            <div key={s.key} className="gs-personality-row">
              <span className="gs-personality-low">{s.low}</span>
              <div className="gs-personality-track">
                <div className="gs-personality-fill" style={{ width: `${pct}%` }} />
                <div className="gs-personality-thumb" style={{ left: `${pct}%` }} />
              </div>
              <span className="gs-personality-high">{s.high}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step defs for StepFlowContext ────────────────────────

const WIZARD_STEPS: StepDefinition[] = [
  { id: "institution", label: "Organisation", activeLabel: "Setting up organisation" },
  { id: "subject", label: "Subject", activeLabel: "Choosing subject" },
  { id: "course", label: "Course", activeLabel: "Configuring course" },
  { id: "content", label: "Content", activeLabel: "Adding content" },
  { id: "welcome", label: "Welcome", activeLabel: "Writing welcome message" },
  { id: "tune", label: "Fine-Tune", activeLabel: "Tuning personality" },
  { id: "launch", label: "Launch", activeLabel: "Launching course" },
];

// ── Storage key ─────────────────────────────────────────

const HISTORY_KEY = "gs-v2-history";

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
  } catch { /* ignore quota errors */ }
}

// ── Unique ID helper ────────────────────────────────────

let idCounter = 0;
function uid(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

// ── Component ───────────────────────────────────────────

/** Maps scaffold item keys to human-readable review request messages */
const REVIEW_MESSAGES: Record<string, string> = {
  institution: "I'd like to review my organisation setup",
  subject: "I'd like to change the subject",
  course: "I'd like to review my course details",
  content: "I'd like to review my content",
  welcome: "I'd like to change the welcome message",
  lessons: "I'd like to adjust the lesson plan",
  personality: "I'd like to fine-tune the AI tutor",
};

export function AIConversationWizard({ initialContext }: AIConversationWizardProps) {
  const { getData, setData, isActive, startFlow } = useStepFlow();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelConfig | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentPhaseId, setCurrentPhaseId] = useState("institution");
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionQuestion, setSuggestionQuestion] = useState<string>("");
  const [lastUploadResult, setLastUploadResult] = useState<PackUploadResult | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialised = useRef(false);
  const lastPhaseRef = useRef("institution");
  const abortRef = useRef<AbortController | null>(null);
  const dismissedContextRef = useRef(false);

  // ── Scroll to bottom (with slight delay for layout settle) ──

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }, 50);
  }, []);

  // ── Derive setup data from StepFlowContext ──────────────

  const getSetupData = useCallback((): Record<string, unknown> => {
    const keys = [
      "institutionName", "existingInstitutionId", "existingDomainId",
      "typeSlug", "defaultDomainKind", "websiteUrl",
      "courseName", "subjectDiscipline", "interactionPattern", "audience", "teachingMode",
      "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
      "behaviorTargets", "lessonPlanModel",
      "draftDomainId", "draftInstitutionId", "draftPlaybookId", "draftCallerId",
      "launched", "sourceId", "packSubjectIds", "extractionTotals",
      "contentSkipped", "welcomeSkipped", "tuneSkipped",
    ];
    const data: Record<string, unknown> = {};
    for (const k of keys) {
      const v = getData(k);
      if (v !== undefined && v !== null && v !== "") data[k] = v;
    }
    return data;
  }, [getData]);

  // ── Send message to API ─────────────────────────────────

  const sendToAPI = useCallback(
    async (userMessage: string, history: Message[], dataOverrides?: Record<string, unknown>): Promise<WizardResponse | null> => {
      // Abort any previous in-flight request (e.g. if reset was clicked)
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const conversationHistory = history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));

        // Merge overrides into setupData so the API sees just-selected values
        // (React state from setData may not have re-rendered yet)
        const setupData = dataOverrides
          ? { ...getSetupData(), ...dataOverrides }
          : getSetupData();

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
        console.error("[wizard] API error:", err);
        return null;
      }
    },
    [getSetupData],
  );

  // ── Process tool calls from AI response ─────────────────

  const processToolCalls = useCallback(
    (toolCalls: WizardToolCall[]): Message[] => {
      let panel: PanelConfig | null = null;
      const phaseSeparators: Message[] = [];
      setSuggestions([]); // Clear stale suggestions before processing new tool calls
      setSuggestionQuestion("");

      for (const tc of toolCalls) {
        switch (tc.name) {
          case "update_setup": {
            const fields = tc.input.fields as Record<string, unknown>;
            for (const [k, v] of Object.entries(fields)) {
              setData(k, v);
            }

            // Compute new phase and check for transition
            const updatedData = { ...getSetupData(), ...fields };
            const isCommunity = updatedData.defaultDomainKind === "COMMUNITY";
            const { phase, phaseIndex } = computeCurrentPhase(updatedData, !!isCommunity);

            if (phase.id !== lastPhaseRef.current) {
              lastPhaseRef.current = phase.id;
              setCurrentPhaseId(phase.id);
              setCurrentStep(phaseIndex);

              // Add phase separator message
              phaseSeparators.push({
                id: uid(),
                role: "system",
                content: phase.label,
                systemType: "timeline",
              });
            }
            break;
          }

          case "show_options": {
            if (!panel) {
              panel = {
                type: "options",
                question: tc.input.question as string,
                dataKey: tc.input.dataKey as string,
                mode: (tc.input.mode as "radio" | "checklist") || "radio",
                options: (tc.input.options as OptionDef[]) || [],
              };
            }
            break;
          }

          case "show_sliders": {
            if (!panel) {
              panel = {
                type: "sliders",
                question: tc.input.question as string,
                sliders: (tc.input.sliders as SlidersPanel["sliders"]) || [],
              };
            }
            break;
          }

          case "show_upload": {
            if (!panel) {
              panel = {
                type: "upload",
                question: tc.input.question as string || "Upload teaching materials",
              };
            }
            break;
          }

          case "show_actions": {
            if (!panel) {
              panel = {
                type: "actions",
                question: tc.input.question as string,
                primary: tc.input.primary as { label: string; icon?: string },
                secondary: tc.input.secondary as { label: string; icon?: string },
              };
            }
            break;
          }

          case "show_suggestions": {
            const items = tc.input.suggestions as string[];
            if (items?.length) setSuggestions(items);
            const q = tc.input.question as string | undefined;
            if (q) setSuggestionQuestion(q);
            break;
          }

          case "mark_complete": {
            setData("launched", true);
            setCurrentStep(WIZARD_STEPS.length - 1);
            break;
          }
        }
      }

      setActivePanel(panel);
      return phaseSeparators;
    },
    [setData, getSetupData],
  );

  // ── Send user message ───────────────────────────────────

  const handleSend = useCallback(
    async (text?: string, dataOverrides?: Record<string, unknown>) => {
      const msg = (text || inputValue).trim();
      if (!msg || isLoading) return;

      // ── Escape hatch: switch institution (client-side, no API call) ──
      if (initialContext && ESCAPE_HATCH_LABELS.includes(msg)) {
        dismissedContextRef.current = true;

        // Clear pre-seeded institution fields
        for (const key of ["institutionName", "existingInstitutionId", "existingDomainId", "defaultDomainKind", "typeSlug"]) {
          setData(key, undefined);
        }

        // Reset phase tracking to institution
        setCurrentStep(0);
        setCurrentPhaseId("institution");
        lastPhaseRef.current = "institution";

        const userBubble: Message = { id: uid(), role: "user", content: msg };
        const reply: Message = {
          id: uid(),
          role: "assistant",
          content: "No problem! Type the name of your organisation or school below, " +
            "and I'll help you set things up.",
        };
        const newMessages = [...messages, userBubble, reply];
        setMessages(newMessages);
        saveHistory(newMessages);
        setInputValue("");
        setSuggestions([]);
        setSuggestionQuestion("");
        scrollToBottom();
        setTimeout(() => inputRef.current?.focus(), 150);
        return;
      }

      setInputValue("");
      setActivePanel(null);
      setSuggestions([]);
      setSuggestionQuestion("");

      // Clear undo if active
      if (undoState) {
        clearTimeout(undoState.timerId);
        setUndoState(null);
      }

      // Add user message
      const userMsg: Message = { id: uid(), role: "user", content: msg };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      saveHistory(newMessages);
      scrollToBottom();

      // Call API — pass dataOverrides so just-selected values are included
      // (React state from setData may not have re-rendered yet)
      setIsLoading(true);
      const response = await sendToAPI(msg, newMessages, dataOverrides);
      setIsLoading(false);

      if (!response) {
        // If the request was aborted (e.g. by Start Afresh), don't show error
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

      // Process tool calls (updates data, sets panel, returns phase separators)
      let phaseSeparators: Message[] = [];
      if (response.toolCalls?.length > 0) {
        phaseSeparators = processToolCalls(response.toolCalls);
      }

      // Build final message list: existing + phase separators + AI response
      let finalMessages = [...newMessages, ...phaseSeparators];
      if (response.content) {
        const aiMsg: Message = { id: uid(), role: "assistant", content: response.content };
        finalMessages = [...finalMessages, aiMsg];
      }
      setMessages(finalMessages);
      saveHistory(finalMessages);
      scrollToBottom();

      // Focus input
      setTimeout(() => inputRef.current?.focus(), 150);
    },
    // initialContext is a stable server prop — won't cause re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputValue, isLoading, messages, sendToAPI, processToolCalls, scrollToBottom, undoState, setData],
  );

  // ── Handle option panel submission (with undo for radio) ──

  const handlePanelSubmit = useCallback(
    (dataKey: string, value: unknown, displayText: string) => {
      // Clear any existing undo timer
      if (undoState?.timerId) clearTimeout(undoState.timerId);

      const previousValue = getData(dataKey);
      setData(dataKey, value);
      setActivePanel(null);

      // Set up undo toast (3s)
      const timerId = setTimeout(() => setUndoState(null), 3000);
      setUndoState({ dataKey, previousValue, displayText, timerId });

      // Send selection as user message — pass the just-selected value as an override
      // because React's setData is async and getSetupData() would return stale state
      handleSend(displayText, { [dataKey]: value });
    },
    [setData, getData, handleSend, undoState],
  );

  // ── Handle undo ─────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (!undoState) return;
    clearTimeout(undoState.timerId);
    setData(undoState.dataKey, undoState.previousValue);
    setUndoState(null);
  }, [undoState, setData]);

  // ── Handle action buttons ───────────────────────────────

  const handleAction = useCallback(
    (action: "primary" | "secondary") => {
      setActivePanel(null);
      const text = action === "primary" ? "Create & Try a Call" : "Continue Setup";
      handleSend(text);
    },
    [handleSend],
  );

  // ── Handle upload complete ──────────────────────────────

  const handleUploadComplete = useCallback(
    (result: PackUploadResult) => {
      if (result.subjects) {
        setData("packSubjectIds", result.subjects.map((s) => s.id));
      }
      if (result.extractionTotals) setData("extractionTotals", result.extractionTotals);
      if (result.categoryCounts) setData("categoryCounts", result.categoryCounts);
      if (result.taskId) setData("uploadTaskId", result.taskId);
      setLastUploadResult(result);
      setActivePanel(null);
      // Inject extraction summary card before the AI response
      setMessages(prev => [...prev, {
        id: `es-${Date.now()}`,
        role: "system" as const,
        content: "",
        systemType: "extraction-summary" as const,
      }]);
      handleSend("Teaching materials uploaded");
    },
    [setData, handleSend],
  );

  // ── Reset wizard (Start Afresh) ─────────────────────────

  const handleReset = useCallback(() => {
    // Abort any in-flight API call so it can't write stale state into the new session
    abortRef.current?.abort();
    abortRef.current = null;

    // Clear chat history from storage
    try { sessionStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }

    // Clear undo timer
    if (undoState?.timerId) clearTimeout(undoState.timerId);

    // Reset local state
    setInputValue("");
    setIsLoading(false);
    setActivePanel(null);
    setUndoState(null);
    setSuggestions([]);
    setSuggestionQuestion("");

    // Re-apply institution context if user didn't dismiss it
    const shouldReapplyContext = initialContext && !dismissedContextRef.current;
    const initialData = shouldReapplyContext ? contextToInitialData(initialContext) : undefined;

    if (shouldReapplyContext) {
      const isCommunity = initialData!.defaultDomainKind === "COMMUNITY";
      const { phase, phaseIndex } = computeCurrentPhase(initialData!, !!isCommunity);
      setCurrentStep(phaseIndex);
      setCurrentPhaseId(phase.id);
      lastPhaseRef.current = phase.id;
    } else {
      setCurrentStep(0);
      setCurrentPhaseId("institution");
      lastPhaseRef.current = "institution";
    }

    // Show appropriate greeting — the init effect won't re-fire because
    // isActive stays true (its deps don't change), so we handle it here.
    initialised.current = true;
    const greeting: Message = {
      id: uid(),
      role: "assistant",
      content: shouldReapplyContext
        ? `Welcome back! Still setting up for **${initialContext!.institutionName}**. ` +
          "What subject would you like to teach?"
        : "Welcome! I'll help you set up your AI tutor in just a few minutes.\n\n" +
          "Let's start with the basics — type the name of your organisation or school below, " +
          "or tell me a bit about what you'd like to set up and I'll guide you through it.",
    };
    setMessages([greeting]);
    saveHistory([greeting]);
    scrollToBottom();

    // Re-start flow with fresh data (overwrites existing StepFlowContext state)
    startFlow({
      flowId: "get-started-v2",
      steps: WIZARD_STEPS,
      returnPath: "/x/get-started-v2",
      initialData,
    });

    // ADMIN+ escape hatch on reset
    if (shouldReapplyContext && ["SUPERADMIN", "ADMIN"].includes(initialContext!.userRole)) {
      setSuggestions(ESCAPE_HATCH_LABELS);
    }

    // Focus input after render settles
    setTimeout(() => inputRef.current?.focus(), 150);
    // initialContext is a server prop — stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoState, startFlow, scrollToBottom]);

  // Esc: close active panel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activePanel) {
        setActivePanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel]);

  // ── Scaffold panel item click → review message ──────────

  const handleScaffoldItemClick = useCallback(
    (itemKey: string) => {
      const reviewMsg = REVIEW_MESSAGES[itemKey];
      if (reviewMsg && !isLoading) {
        handleSend(reviewMsg);
      }
    },
    [isLoading, handleSend],
  );

  // ── Keyboard handler ────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Start flow on mount ─────────────────────────────────

  useEffect(() => {
    if (!isActive) {
      startFlow({
        flowId: "get-started-v2",
        steps: WIZARD_STEPS,
        returnPath: "/x/get-started-v2",
        initialData: initialContext ? contextToInitialData(initialContext) : undefined,
      });
    }
    // initialContext is a server prop — stable across renders, not a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, startFlow]);

  // ── Initialise: restore history or show welcome ─────────

  useEffect(() => {
    if (!isActive || initialised.current) return;
    initialised.current = true;

    const saved = loadHistory();
    if (saved.length > 0) {
      setMessages(saved);
      scrollToBottom();
      return;
    }

    // Context-aware greeting
    const hasContext = initialContext && !dismissedContextRef.current;

    const greeting: Message = {
      id: uid(),
      role: "assistant",
      content: hasContext
        ? `Welcome! I can see you're at **${initialContext.institutionName}**. ` +
          "What subject would you like to set up a course for?"
        : "Welcome! I'll help you set up your AI tutor in just a few minutes.\n\n" +
          "Let's start with the basics — type the name of your organisation or school below, " +
          "or tell me a bit about what you'd like to set up and I'll guide you through it.",
    };
    setMessages([greeting]);
    saveHistory([greeting]);

    // Advance phase indicator past institution when context is pre-seeded
    if (hasContext) {
      const data = contextToInitialData(initialContext);
      const isCommunity = data.defaultDomainKind === "COMMUNITY";
      const { phase, phaseIndex } = computeCurrentPhase(data, !!isCommunity);
      setCurrentPhaseId(phase.id);
      setCurrentStep(phaseIndex);
      lastPhaseRef.current = phase.id;
    }

    // ADMIN+ escape hatch: offer to switch institution
    if (hasContext && ["SUPERADMIN", "ADMIN"].includes(initialContext.userRole)) {
      setSuggestions(ESCAPE_HATCH_LABELS);
    }

    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 150);
    // initialContext is a server prop — stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, scrollToBottom]);

  // ── Render ────────────────────────────────────────────

  if (!isActive) return null;

  const draftCallerId = getData<string>("draftCallerId");
  const draftPlaybookId = getData<string>("draftPlaybookId");
  const draftDomainId = getData<string>("draftDomainId") || getData<string>("existingDomainId");
  const resolvedDomainId = draftDomainId || "";

  return (
    <div className="gs-layout">
      <div className="gs-main">
        <div className="gs-chat-container">
          {/* Messages */}
          <div className="gs-chat-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`gs-chat-row gs-chat-row--${msg.role}`}>
                {msg.systemType === "timeline" ? (
                  <div className="gs-chat-group-sep">
                    <div className="gs-chat-group-sep-line" />
                    <span className="gs-chat-group-sep-label">{msg.content}</span>
                    <div className="gs-chat-group-sep-line" />
                  </div>
                ) : msg.systemType === "extraction-summary" && lastUploadResult ? (
                  <div className="gs-chat-bubble gs-chat-bubble--system">
                    <ExtractionSummary result={lastUploadResult} compact />
                  </div>
                ) : msg.systemType === "error" ? (
                  <div className="gs-chat-bubble gs-chat-bubble--system" style={{ borderColor: "var(--status-error-text)" }}>
                    {msg.content}
                  </div>
                ) : msg.role === "system" ? (
                  <div className="gs-chat-bubble gs-chat-bubble--system">{msg.content}</div>
                ) : msg.role === "user" && msg.content === "Personality configured" && getData<Record<string, number>>("behaviorTargets") ? (
                  <div className="gs-chat-bubble gs-chat-bubble--user">
                    <PersonalityCard values={getData<Record<string, number>>("behaviorTargets")!} />
                  </div>
                ) : (
                  <div className={`gs-chat-bubble gs-chat-bubble--${msg.role}`}>
                    {msg.content}
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="gs-chat-row gs-chat-row--assistant">
                <div className="gs-chat-typing">
                  <div className="gs-chat-typing-dot" />
                  <div className="gs-chat-typing-dot" />
                  <div className="gs-chat-typing-dot" />
                </div>
              </div>
            )}

            {/* Success card when complete */}
            {getData<boolean>("launched") && draftCallerId && (
              <div className="gs-chat-row gs-chat-row--system">
                <div className="gs-chat-bubble gs-chat-bubble--system">
                  <div className="gs-chat-success">
                    <div className="gs-chat-success-title">Your AI tutor is ready!</div>
                    <div className="gs-chat-success-sub">Try a sim call to see it in action.</div>
                    <div className="gs-chat-success-actions">
                      <a href={`/x/sim/${draftCallerId}?${new URLSearchParams({ ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}), ...(draftDomainId ? { domainId: draftDomainId } : {}) }).toString()}`} className="hf-btn hf-btn-primary" target="_blank" rel="noopener noreferrer">
                        Try a Sim Call
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="gs-chat-input-bar">
            {/* Zone 0: Single Option Panel (above input) */}
            {activePanel && (
              <OptionPanel
                panel={activePanel}
                onSubmit={handlePanelSubmit}
                onAction={handleAction}
                uploadComponent={
                  <PackUploadStep
                    domainId={resolvedDomainId}
                    courseName={getData<string>("courseName") || "Course"}
                    interactionPattern={getData<string>("interactionPattern") || undefined}
                    teachingMode={getData<string>("teachingMode") || undefined}
                    subjectDiscipline={getData<string>("subjectDiscipline") || undefined}
                    institutionName={getData<string>("institutionName") || undefined}
                    onResult={handleUploadComplete}
                  />
                }
              />
            )}

            {/* Undo toast */}
            {undoState && (
              <div className="gs-undo-toast">
                <span>Selected: {undoState.displayText}</span>
                <button type="button" className="gs-undo-btn" onClick={handleUndo}>
                  <Undo2 size={12} />
                  {" "}Undo
                </button>
              </div>
            )}

            {/* Quick-reply suggestions */}
            {suggestions.length > 0 && !activePanel && (
              <div className="gs-suggestions">
                {suggestionQuestion && (
                  <span className="gs-suggestions-label">{suggestionQuestion}</span>
                )}
                {suggestions.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="gs-suggestion-chip"
                    onClick={() => handleSend(label)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Zone 1: Typing area */}
            <div className="gs-chat-input-zone">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className="gs-chat-textarea"
              />
            </div>

            {/* Zone 2: Controls bar */}
            <div className="gs-chat-controls-bar">
              <div className="gs-chat-controls-left">
                <button
                  type="button"
                  className={`gs-chat-attach-btn${activePanel?.type === "upload" ? " gs-chat-attach-btn--active" : ""}`}
                  onClick={() => setActivePanel({ type: "upload", question: "Upload teaching materials" })}
                  disabled={!resolvedDomainId}
                  title={resolvedDomainId ? "Upload teaching materials" : "Set up your organisation first"}
                >
                  <Paperclip size={16} />
                </button>
                {isLoading && (
                  <span className="gs-chat-step-counter">
                    <Loader2 size={12} className="hf-spinner" style={{ display: "inline" }} />
                    {" "}Thinking...
                  </span>
                )}
              </div>
              <div className="gs-chat-controls-right">
                {isLoading ? (
                  <div className="gs-chat-send-btn gs-chat-send-btn--loading">
                    <Loader2 size={16} className="hf-spinner" />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="gs-chat-send-btn"
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
      </div>

      {/* Scaffold panel */}
      <ScaffoldPanel getData={getData} currentStepIndex={currentStep} currentPhaseId={currentPhaseId} onReset={handleReset} onItemClick={handleScaffoldItemClick} />
    </div>
  );
}
