"use client";

/**
 * ConversationWizard — chat-like UI for the Get Started wizard.
 *
 * AI questions as left-aligned bubbles. User answers as right-aligned bubbles.
 * Single input area at the bottom. Inline pickers within the conversation.
 *
 * Uses StepFlowContext directly (same data bag, same persistence).
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUp,
  Check,
  Command,
  Globe,
  Loader2,
  Pencil,
  Rocket,
  ExternalLink,
  X,
} from "lucide-react";
import slugify from "slugify";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { useEntityContext } from "@/contexts/EntityContext";
import { useChatContext } from "@/contexts/ChatContext";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { ChipSelect } from "@/components/shared/ChipSelect";
import { TypePicker } from "@/components/shared/TypePicker";
import { PackUploadStep } from "@/components/wizards/PackUploadStep";
import type { PackUploadResult } from "@/components/wizards/PackUploadStep";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import {
  CONVERSATION_SCRIPT,
  STEP_INDEX,
  PERSONALITY_SLIDERS,
  type ConversationQuestion,
  type DataGetter,
  type SliderDef,
} from "./conversation-script";
import "../conversation-wizard.css";

// ── Types ────────────────────────────────────────────────

interface ConversationMessage {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  questionId?: string;
  rawValue?: unknown;
  systemType?: "timeline" | "success" | "error";
  timeline?: TimelineItem[];
}

interface TimelineItem {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

interface ExistingInstitution {
  id: string;
  name: string;
  typeSlug: string | null;
  defaultDomainKind: string | null;
  domainId: string | null;
}

// ── Helper: suggest type from name ───────────────────────

function suggestTypeFromName(name: string): string | null {
  if (!name.trim()) return null;
  if (/school|primary|secondary|infant|junior|nursery|prep|sixth.?form/i.test(name)) return "school";
  if (/hospital|clinic|health|care|nhs|therapy|medical|dental/i.test(name)) return "healthcare";
  if (/charity|foundation|community|trust|wellbeing|centre|center|society|association/i.test(name)) return "community";
  if (/gym|fitness|sport|athletics|personal.train/i.test(name)) return "coaching";
  if (/training|learning|workshop|development/i.test(name)) return "training";
  if (/ltd|limited|consulting|solutions|group|agency|corp|company|plc/i.test(name)) return "corporate";
  return null;
}

// ── Helper: display text for a user answer ───────────────

function answerDisplayText(q: ConversationQuestion, value: unknown): string {
  const ctrl = q.control;
  if (ctrl.type === "chips") {
    const opt = ctrl.options.find((o) => o.value === value);
    return opt?.label ?? String(value);
  }
  if (ctrl.type === "type-picker") return String(value || "");
  if (ctrl.type === "sliders") return "Personality set";
  if (ctrl.type === "file-upload") return String(value || "Content uploaded");
  if (ctrl.type === "actions") return String(value || "");
  if (ctrl.type === "review") return String(value || "");
  if (ctrl.type === "textarea" && !value) return "(Skipped)";
  return String(value || "(Skipped)");
}

// ── Step definitions for StepFlowContext ─────────────────

const STEP_DEFS: StepDefinition[] = [
  { id: "institution", label: "Organisation", activeLabel: "Tell us about your organisation" },
  { id: "course", label: "Course", activeLabel: "What are we teaching?" },
  { id: "content", label: "Content", activeLabel: "Upload your teaching materials" },
  { id: "checkpoint", label: "Ready to Test", activeLabel: "Ready to try your AI tutor" },
  { id: "welcome", label: "Welcome & Sessions", activeLabel: "How should the first call feel?" },
  { id: "tune", label: "Fine-Tune", activeLabel: "Adjust the AI personality" },
  { id: "launch", label: "Launch", activeLabel: "Review & create" },
];

// ── Main component ───────────────────────────────────────

export function ConversationWizard() {
  const router = useRouter();
  const {
    state,
    isActive,
    startFlow,
    setStep,
    setData,
    getData,
    endFlow,
  } = useStepFlow();
  const { pushEntity, replaceEntity, popEntity } = useEntityContext();
  const { togglePanel: toggleChatPanel } = useChatContext();

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activeQIndex, setActiveQIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [editingQId, setEditingQId] = useState<string | null>(null);

  // Typeahead state
  const [institutions, setInstitutions] = useState<ExistingInstitution[]>([]);
  const [instLoading, setInstLoading] = useState(true);
  const [typeaheadQuery, setTypeaheadQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedInst, setSelectedInst] = useState<ExistingInstitution | null>(null);

  // URL import state
  const [urlImporting, setUrlImporting] = useState(false);
  const urlImportAttempted = useRef(false);

  // SSE timeline state (for institution creation + course creation)
  const [sseTimeline, setSseTimeline] = useState<TimelineItem[]>([]);
  const [ssePhase, setSsePhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [sseError, setSseError] = useState<string | null>(null);

  // Slider state
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({
    warmth: 0.6,
    directiveness: 0.5,
    pace: 0.5,
    encouragement: 0.7,
  });

  // Launch state
  const [launchPhase, setLaunchPhase] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [launchError, setLaunchError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typeaheadWrapRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // ── Initialize flow ────────────────────────────────────

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    if (!isActive || state?.flowId !== "get-started") {
      startFlow({
        flowId: "get-started",
        steps: STEP_DEFS,
        returnPath: "/x/domains",
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useUnsavedGuard(isActive && messages.length > 0);

  // ── Load existing institutions ─────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/user/institutions");
        const data = await res.json();
        if (data.ok && data.institutions?.length > 0) {
          setInstitutions(
            data.institutions.map((i: any) => ({
              id: i.id,
              name: i.name,
              typeSlug: i.typeSlug || null,
              defaultDomainKind: i.defaultDomainKind || null,
              domainId: i.domainId || null,
            })),
          );
        }
      } catch {
        // Silent
      } finally {
        setInstLoading(false);
      }
    })();
  }, []);

  // ── Restore from data bag on mount ─────────────────────

  useEffect(() => {
    // Wait for flow to be active AND institutions to finish loading
    // (institutions needed for typeahead restore + showWhen evaluation)
    if (!isActive || instLoading || messages.length > 0) return;

    // Build messages from already-answered questions in the data bag
    const restored: ConversationMessage[] = [];
    let lastAnsweredIndex = -1;

    for (let i = 0; i < CONVERSATION_SCRIPT.length; i++) {
      const q = CONVERSATION_SCRIPT[i];

      // Check condition — skip hidden questions
      if (q.showWhen && !q.showWhen(getData)) continue;

      // Check if this question has been answered
      const ctrl = q.control;
      let value: unknown;
      // Sliders always require interaction — don't auto-restore from data bag.
      // The user must see and confirm the slider values on every visit.
      if (ctrl.type === "sliders") {
        value = undefined;
      } else if ("dataKey" in ctrl) {
        value = getData(ctrl.dataKey);
      } else if (ctrl.type === "file-upload") {
        value = getData("contentSkipped") || getData("extractionTotals") ? "done" : undefined;
      } else if (ctrl.type === "actions") {
        value = getData("draftPlaybookId") ? "Created" : undefined;
      } else if (ctrl.type === "review") {
        value = getData("launched") ? "Launched" : undefined;
      }

      if (value !== undefined && value !== null && value !== "") {
        // Restore group separator
        if (q.groupLabel) {
          restored.push({
            id: `sep-${q.id}`,
            role: "system",
            content: q.groupLabel,
          });
        }

        // AI message
        const aiText = typeof q.message === "function" ? q.message(getData) : q.message;
        restored.push({
          id: `ai-${q.id}`,
          role: "assistant",
          content: aiText,
          questionId: q.id,
        });

        // User message
        restored.push({
          id: `user-${q.id}`,
          role: "user",
          content: answerDisplayText(q, value),
          questionId: q.id,
          rawValue: value,
        });

        lastAnsweredIndex = i;
      } else {
        // First unanswered visible question — this is where we resume
        break;
      }
    }

    // Restore slider values if saved
    const savedTargets = getData<Record<string, number>>("behaviorTargets");
    if (savedTargets) setSliderValues(savedTargets);

    // Restore typeahead state
    const existingId = getData<string>("existingInstitutionId");
    if (existingId) {
      const inst = institutions.find((i) => i.id === existingId);
      if (inst) {
        setSelectedInst(inst);
        setTypeaheadQuery(inst.name);
      } else {
        // Institution was in data bag but not in loaded list — restore name from saved data
        const savedName = getData<string>("existingInstitutionName");
        if (savedName) setTypeaheadQuery(savedName);
      }
    } else {
      const name = getData<string>("institutionName");
      if (name) setTypeaheadQuery(name);
    }

    if (restored.length > 0) {
      setMessages(restored);
      // Find the next visible question after the last answered one
      let resumeIdx = lastAnsweredIndex + 1;
      while (resumeIdx < CONVERSATION_SCRIPT.length) {
        const q = CONVERSATION_SCRIPT[resumeIdx];
        if (!q.showWhen || q.showWhen(getData)) break;
        resumeIdx++;
      }
      setActiveQIndex(resumeIdx);

      // Sync ScaffoldPanel to the step we're resuming at
      const resumeStepId = resumeIdx < CONVERSATION_SCRIPT.length
        ? CONVERSATION_SCRIPT[resumeIdx].stepId
        : CONVERSATION_SCRIPT[lastAnsweredIndex].stepId;
      const stepNum = STEP_INDEX[resumeStepId];
      if (stepNum !== undefined) setStep(stepNum);

      // Push the resume question's AI bubble so the user sees what to answer next
      if (resumeIdx < CONVERSATION_SCRIPT.length) {
        const nextQ = CONVERSATION_SCRIPT[resumeIdx];
        const nextMsgs: ConversationMessage[] = [];
        if (nextQ.groupLabel) {
          nextMsgs.push({ id: `sep-${nextQ.id}`, role: "system", content: nextQ.groupLabel });
        }
        const text = typeof nextQ.message === "function" ? nextQ.message(getData) : nextQ.message;
        nextMsgs.push({ id: `ai-${nextQ.id}`, role: "assistant", content: text, questionId: nextQ.id });
        setMessages((prev) => [...prev, ...nextMsgs]);
      }
    } else {
      // Start fresh — show first question
      pushFirstQuestion();
    }
  }, [isActive, instLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Active question ────────────────────────────────────

  const activeQuestion = useMemo(() => {
    // Find the next visible question from activeQIndex
    for (let i = activeQIndex; i < CONVERSATION_SCRIPT.length; i++) {
      const q = CONVERSATION_SCRIPT[i];
      if (q.showWhen && !q.showWhen(getData)) continue;
      return { question: q, index: i };
    }
    return null;
  }, [activeQIndex, getData]);

  // ── Push first question ────────────────────────────────

  const pushFirstQuestion = useCallback(() => {
    const q = CONVERSATION_SCRIPT[0];
    const newMessages: ConversationMessage[] = [];
    if (q.groupLabel) {
      newMessages.push({ id: `sep-${q.id}`, role: "system", content: q.groupLabel });
    }
    const text = typeof q.message === "function" ? q.message(getData) : q.message;
    newMessages.push({ id: `ai-${q.id}`, role: "assistant", content: text, questionId: q.id });
    setMessages(newMessages);
    setActiveQIndex(0);
  }, [getData]);

  // ── Auto-scroll ────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Click outside to close typeahead dropdown ──────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (typeaheadWrapRef.current && !typeaheadWrapRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Advance to next question ───────────────────────────

  const advanceToQuestion = useCallback(
    (fromIndex: number, pendingData?: Record<string, unknown>) => {
      // Build a getData that sees pending (not-yet-flushed) writes
      const getDataNow: DataGetter = <T = unknown,>(key: string): T | undefined => {
        if (pendingData && key in pendingData) return pendingData[key] as T;
        return getData<T>(key);
      };

      // Find next visible question
      let nextIdx = fromIndex + 1;
      while (nextIdx < CONVERSATION_SCRIPT.length) {
        const q = CONVERSATION_SCRIPT[nextIdx];
        if (!q.showWhen || q.showWhen(getDataNow)) break;
        nextIdx++;
      }

      if (nextIdx >= CONVERSATION_SCRIPT.length) return; // Wizard complete

      const nextQ = CONVERSATION_SCRIPT[nextIdx];

      // Update step if crossing step boundary
      const prevStepId = CONVERSATION_SCRIPT[fromIndex]?.stepId;
      if (nextQ.stepId !== prevStepId) {
        const stepNum = STEP_INDEX[nextQ.stepId];
        if (stepNum !== undefined) setStep(stepNum);
      }

      // Show typing indicator, then push question
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        const newMsgs: ConversationMessage[] = [];

        if (nextQ.groupLabel) {
          newMsgs.push({ id: `sep-${nextQ.id}`, role: "system", content: nextQ.groupLabel });
        }

        const text = typeof nextQ.message === "function" ? nextQ.message(getDataNow) : nextQ.message;
        newMsgs.push({ id: `ai-${nextQ.id}`, role: "assistant", content: text, questionId: nextQ.id });

        setMessages((prev) => [...prev, ...newMsgs]);
        setActiveQIndex(nextIdx);

        // Pre-populate textarea with defaultValue if provided, otherwise clear
        const ctrl = nextQ.control;
        if (ctrl.type === "textarea" && ctrl.defaultValue) {
          const resolved = typeof ctrl.defaultValue === "function" ? ctrl.defaultValue(getDataNow) : ctrl.defaultValue;
          setInputValue(resolved);
        } else {
          setInputValue("");
        }

        // Focus input if text-based
        if (ctrl.type === "text" || ctrl.type === "textarea" || ctrl.type === "url") {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }, 350);
    },
    [getData, setStep],
  );

  // ── Handle answer ──────────────────────────────────────

  const handleAnswer = useCallback(
    (questionId: string, value: unknown, displayText?: string) => {
      const qIdx = CONVERSATION_SCRIPT.findIndex((q) => q.id === questionId);
      if (qIdx === -1) return;
      const q = CONVERSATION_SCRIPT[qIdx];
      const ctrl = q.control;

      // Persist to data bag
      if ("dataKey" in ctrl && ctrl.dataKey) {
        setData(ctrl.dataKey, value);
      }

      // Special: typeIdKey for type-picker
      if (ctrl.type === "type-picker" && "typeIdKey" in ctrl) {
        // typeId is handled by TypePicker's onChange callback separately
      }

      // Run onAnswer hook
      if (q.onAnswer) {
        q.onAnswer(value, setData, getData);
      }

      // Push user bubble
      const text = displayText ?? answerDisplayText(q, value);
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${q.id}`,
          role: "user",
          content: text,
          questionId: q.id,
          rawValue: value,
        },
      ]);

      // Handle special post-answer logic — collect pending data for immediate visibility
      let pendingData: Record<string, unknown> | undefined;

      if (q.id === "inst.name" && selectedInst) {
        // Existing institution selected — store selection data
        pendingData = {
          existingInstitutionId: selectedInst.id,
          existingInstitutionName: selectedInst.name,
          existingDomainId: selectedInst.domainId || "",
          typeSlug: selectedInst.typeSlug,
          institutionName: undefined,
        };
        for (const [k, v] of Object.entries(pendingData)) setData(k, v);
      } else if (q.id === "inst.name") {
        // New institution
        pendingData = {
          institutionName: String(value).trim(),
          existingInstitutionId: undefined,
          existingInstitutionName: undefined,
          existingDomainId: undefined,
        };
        for (const [k, v] of Object.entries(pendingData)) setData(k, v);
      }

      if (q.id === "course.discipline" && !value) {
        // Default discipline to course name
        setData("subjectDiscipline", getData<string>("courseName")?.trim() || "");
      }

      // Advance — pass pendingData so showWhen sees not-yet-flushed writes
      advanceToQuestion(qIdx, pendingData);
    },
    [advanceToQuestion, getData, setData, selectedInst],
  );

  // ── Text input submit ──────────────────────────────────

  const handleTextSubmit = useCallback(() => {
    if (!activeQuestion) return;
    const q = activeQuestion.question;
    const ctrl = q.control;

    if (ctrl.type === "typeahead") {
      // Typeahead submit
      const val = typeaheadQuery.trim();
      if (!val && !selectedInst) return;
      handleAnswer(q.id, selectedInst ? selectedInst.name : val);
      return;
    }

    if (ctrl.type === "text" || ctrl.type === "url") {
      const val = inputValue.trim();
      if (ctrl.type === "text" && !val) return; // Text required
      handleAnswer(q.id, val);
      return;
    }

    if (ctrl.type === "textarea") {
      // Textarea can be blank (optional)
      handleAnswer(q.id, inputValue.trim());
      return;
    }
  }, [activeQuestion, inputValue, typeaheadQuery, selectedInst, handleAnswer]);

  // ── Keyboard handler for input ─────────────────────────

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleTextSubmit();
      }
    },
    [handleTextSubmit],
  );

  // ── Typeahead handlers ─────────────────────────────────

  const filteredInstitutions = useMemo(() => {
    if (!typeaheadQuery.trim() || selectedInst) return [];
    const q = typeaheadQuery.toLowerCase();
    return institutions.filter((i) => i.name.toLowerCase().includes(q));
  }, [typeaheadQuery, institutions, selectedInst]);

  const hasExactMatch = filteredInstitutions.some(
    (i) => i.name.toLowerCase() === typeaheadQuery.trim().toLowerCase(),
  );

  const showCreateAction = typeaheadQuery.trim().length > 0 && !hasExactMatch && !selectedInst;
  const dropdownItemCount = filteredInstitutions.length + (showCreateAction ? 1 : 0);

  const handleSelectInstitution = useCallback(
    (inst: ExistingInstitution) => {
      setSelectedInst(inst);
      setTypeaheadQuery(inst.name);
      setShowDropdown(false);
      setHighlightIndex(-1);

      // Store and advance
      setData("existingInstitutionId", inst.id);
      setData("existingInstitutionName", inst.name);
      setData("existingDomainId", inst.domainId || "");
      setData("typeSlug", inst.typeSlug);
      if (inst.defaultDomainKind) setData("defaultDomainKind", inst.defaultDomainKind);
      setData("institutionName", undefined);

      if (activeQuestion?.question.id === "inst.name") {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-inst.name`,
            role: "user",
            content: inst.name,
            questionId: "inst.name",
            rawValue: inst.name,
          },
        ]);
        advanceToQuestion(activeQuestion.index);
      }
    },
    [activeQuestion, advanceToQuestion, setData],
  );

  const handleClearInstitution = useCallback(() => {
    setSelectedInst(null);
    setTypeaheadQuery("");
    setShowDropdown(false);
    setHighlightIndex(-1);
    setData("existingInstitutionId", undefined);
    setData("existingInstitutionName", undefined);
    setData("existingDomainId", undefined);
  }, [setData]);

  const handleTypeaheadKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedInst) return;

      const isDropdownVisible = showDropdown && dropdownItemCount > 0;

      if (!isDropdownVisible) {
        if (e.key === "ArrowDown" && dropdownItemCount > 0) {
          setShowDropdown(true);
          setHighlightIndex(0);
          e.preventDefault();
        }
        if (e.key === "Enter" && typeaheadQuery.trim()) {
          e.preventDefault();
          handleTextSubmit();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((p) => Math.min(p + 1, dropdownItemCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((p) => Math.max(p - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filteredInstitutions.length) {
            handleSelectInstitution(filteredInstitutions[highlightIndex]);
          } else if (highlightIndex === filteredInstitutions.length && showCreateAction) {
            setShowDropdown(false);
            handleTextSubmit();
          } else if (typeaheadQuery.trim()) {
            handleTextSubmit();
          }
          break;
        case "Escape":
          e.preventDefault();
          setShowDropdown(false);
          setHighlightIndex(-1);
          break;
      }
    },
    [
      selectedInst, showDropdown, dropdownItemCount, highlightIndex,
      filteredInstitutions, showCreateAction, typeaheadQuery,
      handleSelectInstitution, handleTextSubmit,
    ],
  );

  // ── URL import ─────────────────────────────────────────

  const handleUrlImport = useCallback(
    async (url: string) => {
      if (!url.trim() || urlImportAttempted.current) return;
      urlImportAttempted.current = true;
      setUrlImporting(true);
      try {
        const res = await fetch("/api/institutions/url-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        const data = await res.json();
        if (data.ok && data.meta) {
          if (data.meta.logoUrl) setData("logoUrl", data.meta.logoUrl);
          if (data.meta.primaryColor) setData("primaryColor", data.meta.primaryColor);
          if (data.meta.secondaryColor) setData("secondaryColor", data.meta.secondaryColor);
        }
      } catch {
        // Silent
      } finally {
        setUrlImporting(false);
      }
    },
    [setData],
  );

  // ── SSE: Eager institution creation ────────────────────

  const runEagerCreation = useCallback(async () => {
    const instName = getData<string>("institutionName");
    if (!instName) return;

    setSsePhase("running");
    setSseError(null);
    const steps: TimelineItem[] = [
      { label: "Creating organisation", status: "active" },
      { label: "Setting up workspace", status: "pending" },
      { label: "Ready for content", status: "pending" },
    ];
    setSseTimeline([...steps]);

    // Push system message
    setMessages((prev) => [
      ...prev,
      { id: "sys-creation", role: "system", content: "setting-up", systemType: "timeline", timeline: [...steps] },
    ]);

    try {
      const res = await fetch("/api/institutions/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionName: instName,
          slug: slugify(instName, { lower: true, strict: true }),
          typeSlug: getData<string>("typeSlug"),
          typeId: getData<string>("typeId"),
          websiteUrl: getData<string>("websiteUrl"),
          logoUrl: getData<string>("logoUrl"),
          primaryColor: getData<string>("primaryColor"),
          secondaryColor: getData<string>("secondaryColor"),
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6));
            if (event.phase === "creating-institution") {
              steps[0] = { ...steps[0], status: "active" };
            }
            if (event.phase === "creating-domain" || event.phase === "scaffolding") {
              steps[0] = { ...steps[0], status: "done" };
              steps[1] = { ...steps[1], status: "active" };
            }
            if (event.phase === "linking-user") {
              steps[1] = { ...steps[1], status: "done" };
              steps[2] = { ...steps[2], status: "active" };
            }
            if (event.phase === "complete" && event.detail) {
              steps[0] = { ...steps[0], status: "done" };
              steps[1] = { ...steps[1], status: "done" };
              steps[2] = { ...steps[2], status: "done" };
              setData("draftDomainId", event.detail.domainId);
              setData("draftInstitutionId", event.detail.institutionId);
              completed = true;
            }
            if (event.phase === "error") {
              throw new Error(event.message || "Creation failed");
            }
            setSseTimeline([...steps]);
            // Update the system message in-place
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "sys-creation" ? { ...m, timeline: [...steps] } : m,
              ),
            );
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (!completed) throw new Error("Institution creation did not complete");
      setSsePhase("done");
    } catch (err: any) {
      setSseError(err.message || "Something went wrong");
      setSsePhase("error");
      const updated = steps.map((t) =>
        t.status === "active" ? { ...t, status: "error" as const } : t,
      );
      setSseTimeline(updated);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "sys-creation" ? { ...m, timeline: updated, systemType: "error" } : m,
        ),
      );
    }
  }, [getData, setData]);

  // ── SSE: Course creation (checkpoint) ──────────────────

  const runCourseCreation = useCallback(async () => {
    setSsePhase("running");
    setSseError(null);

    const isExisting = !!getData<string>("existingInstitutionId");
    const hasDraftDomain = !!getData<string>("draftDomainId");

    const steps: TimelineItem[] = [
      {
        label: hasDraftDomain || isExisting ? "Using existing organisation" : "Creating organisation",
        status: hasDraftDomain || isExisting ? "done" : "active",
      },
      { label: "Setting up course", status: hasDraftDomain || isExisting ? "active" : "pending" },
      { label: "Scaffolding AI tutor", status: "pending" },
      { label: "Composing first prompt", status: "pending" },
    ];
    setSseTimeline([...steps]);

    setMessages((prev) => [
      ...prev,
      { id: "sys-course-creation", role: "system", content: "creating-course", systemType: "timeline", timeline: [...steps] },
    ]);

    try {
      let domainId: string;
      let institutionId: string | undefined;

      if (hasDraftDomain) {
        domainId = getData<string>("draftDomainId") || "";
        institutionId = getData<string>("draftInstitutionId") || undefined;
      } else if (isExisting) {
        domainId = getData<string>("existingDomainId") || "";
        institutionId = getData<string>("existingInstitutionId") || undefined;
      } else {
        // Fallback: create institution (shouldn't normally happen with eager creation)
        const instName = getData<string>("institutionName") || "";
        const launchRes = await fetch("/api/institutions/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionName: instName,
            slug: slugify(instName, { lower: true, strict: true }),
            typeSlug: getData<string>("typeSlug"),
            typeId: getData<string>("typeId"),
            websiteUrl: getData<string>("websiteUrl"),
            logoUrl: getData<string>("logoUrl"),
            primaryColor: getData<string>("primaryColor"),
            secondaryColor: getData<string>("secondaryColor"),
          }),
        });

        const reader = launchRes.body?.getReader();
        const decoder = new TextDecoder();
        let result = { institutionId: "", domainId: "" };
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split("\n").filter((l) => l.startsWith("data: "));
            for (const line of lines) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.phase === "complete" && event.detail) {
                  result = event.detail;
                }
              } catch { /* skip */ }
            }
          }
        }
        if (!result.domainId) throw new Error("Failed to create institution");

        domainId = result.domainId;
        institutionId = result.institutionId;
        steps[0] = { ...steps[0], status: "done" };
      }

      // Create course
      steps[1] = { ...steps[1], status: "active" };
      setSseTimeline([...steps]);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "sys-course-creation" ? { ...m, timeline: [...steps] } : m,
        ),
      );

      let playbookId: string | undefined;

      if (getData<string>("defaultDomainKind") === "COMMUNITY") {
        // Community early launch — simpler path, no task polling needed
        const communityRes = await fetch("/api/communities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: getData<string>("courseName") || getData<string>("institutionName") || "My Community",
            communityKind: "OPEN_CONNECTION",
            hubPattern: getData<string>("interactionPattern") || "companion",
            institutionId: getData<string>("existingInstitutionId") || undefined,
          }),
        });
        const communityData = await communityRes.json();
        if (!communityData.ok) throw new Error(communityData.error || "Failed to create community");
        domainId = communityData.community.id;

        // Fetch scaffold-created playbook
        const pbRes = await fetch(`/api/domains/${domainId}/playbooks`);
        const pbData = await pbRes.json();
        playbookId = pbData.ok ? pbData.playbooks?.[0]?.id : undefined;
      } else {
        const setupRes = await fetch("/api/courses/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseName: getData<string>("courseName"),
            domainId,
            interactionPattern: getData<string>("interactionPattern"),
            teachingMode: getData<string>("teachingMode"),
            subjectDiscipline: getData<string>("subjectDiscipline"),
            packSubjectIds: getData<string[]>("packSubjectIds"),
            sourceId: getData<string>("sourceId"),
            learningOutcomes: [],
            teachingStyle: getData<string>("interactionPattern") || "socratic",
            sessionCount: 5,
            durationMins: 30,
            emphasis: "balanced",
            welcomeMessage: "",
            studentEmails: [],
          }),
        });

        const setupData = await setupRes.json();
        if (!setupData.ok) throw new Error(setupData.error || "Failed to set up course");

        // Poll the course setup task until complete so we get the playbookId
        const taskId = setupData.taskId;
        if (taskId) {
          const POLL_MS = 1500;
          const TIMEOUT_MS = 60_000;
          const start = Date.now();
          while (Date.now() - start < TIMEOUT_MS) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            try {
              const taskRes = await fetch(`/api/tasks?taskId=${taskId}`);
              if (!taskRes.ok) continue;
              const taskData = await taskRes.json();
              const task = taskData.task || taskData.tasks?.[0] || taskData.guidance?.task;
            if (task?.status === "completed") {
              playbookId = task.context?.summary?.playbook?.id;
              break;
            }
            if (task?.status === "abandoned" || task?.context?.error) break;
          } catch { /* keep polling */ }
        }
      }
      } // end course setup branch

      steps[1] = { ...steps[1], status: "done" };
      steps[2] = { ...steps[2], status: "done" };
      steps[3] = { ...steps[3], status: "done" };
      setSseTimeline([...steps]);

      setData("draftDomainId", domainId);
      if (playbookId) setData("draftPlaybookId", playbookId);
      if (institutionId) setData("draftInstitutionId", institutionId);

      // Create a test caller enrolled in the specific course — only if we got the playbookId.
      // Without it, enrollCallerInDomainPlaybooks would enrol in ALL domain playbooks (wrong course).
      if (playbookId) {
        try {
          const FRIENDLY_NAMES = [
            "Alex", "Jordan", "Sam", "Taylor", "Morgan",
            "Riley", "Casey", "Jamie", "Quinn", "Avery",
            "Charlie", "Reese", "Skyler", "Finley", "Rowan",
          ];
          const simName = FRIENDLY_NAMES[Math.floor(Math.random() * FRIENDLY_NAMES.length)];
          const callerRes = await fetch("/api/callers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId, name: simName, playbookId }),
          });
          const callerData = await callerRes.json();
          if (callerData.ok && callerData.caller?.id) {
            setData("draftCallerId", callerData.caller.id);
          }
        } catch {
          // Non-fatal — sim link just won't show
        }
      }

      setSsePhase("done");

      // Update system message to done
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "sys-course-creation" ? { ...m, timeline: [...steps], systemType: "success" } : m,
        ),
      );

      // Push success message
      setMessages((prev) => [
        ...prev,
        {
          id: "sys-course-done",
          role: "system",
          content: "course-created",
          systemType: "success",
        },
      ]);

    } catch (err: any) {
      setSseError(err.message || "Something went wrong");
      setSsePhase("error");
      const updated = steps.map((t) =>
        t.status === "active" ? { ...t, status: "error" as const } : t,
      );
      setSseTimeline(updated);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "sys-course-creation" ? { ...m, timeline: updated, systemType: "error" } : m,
        ),
      );
    }
  }, [getData, setData]);

  // ── Handle launch ──────────────────────────────────────

  const handleLaunch = useCallback(async () => {
    setLaunchPhase("creating");
    setLaunchError(null);

    try {
      const draftDomainId = getData<string>("draftDomainId");
      const isUpdate = !!draftDomainId;

      if (isUpdate) {
        const res = await fetch(`/api/domains/${draftDomainId}/update-and-publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            welcomeMessage: getData<string>("welcomeMessage"),
            sessionCount: getData<number>("sessionCount"),
            durationMins: getData<number>("durationMins"),
            emphasis: getData<string>("planEmphasis"),
            behaviorTargets: getData<Record<string, number>>("behaviorTargets"),
            lessonPlanModel: getData<string>("lessonPlanModel"),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to publish");
      } else if (getData<string>("defaultDomainKind") === "COMMUNITY") {
        // Community creation — uses companion archetype, no curriculum
        const communityRes = await fetch("/api/communities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: getData<string>("courseName") || getData<string>("institutionName") || "My Community",
            description: getData<string>("welcomeMessage") || "",
            communityKind: "OPEN_CONNECTION",
            hubPattern: getData<string>("interactionPattern") || "companion",
            institutionId: getData<string>("existingInstitutionId") || undefined,
          }),
        });
        const communityData = await communityRes.json();
        if (!communityData.ok) throw new Error(communityData.error || "Failed to create community");

        setData("draftDomainId", communityData.community.id);

        // Fetch the scaffold-created playbook for sim link
        const pbRes = await fetch(`/api/domains/${communityData.community.id}/playbooks`);
        const pbData = await pbRes.json();
        if (pbData.ok && pbData.playbooks?.[0]?.id) {
          setData("draftPlaybookId", pbData.playbooks[0].id);
        }
      } else {
        // Full course creation
        const setupRes = await fetch("/api/courses/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseName: getData<string>("courseName"),
            domainId: getData<string>("existingDomainId") || "",
            interactionPattern: getData<string>("interactionPattern"),
            teachingMode: getData<string>("teachingMode"),
            subjectDiscipline: getData<string>("subjectDiscipline"),
            packSubjectIds: getData<string[]>("packSubjectIds"),
            sourceId: getData<string>("sourceId"),
            learningOutcomes: [],
            teachingStyle: getData<string>("interactionPattern") || "socratic",
            sessionCount: getData<number>("sessionCount") || 5,
            durationMins: getData<number>("durationMins") || 30,
            emphasis: getData<string>("planEmphasis") || "balanced",
            welcomeMessage: getData<string>("welcomeMessage") || "",
            studentEmails: [],
            behaviorTargets: getData<Record<string, number>>("behaviorTargets"),
            lessonPlanModel: getData<string>("lessonPlanModel"),
          }),
        });
        const data = await setupRes.json();
        if (!data.ok) throw new Error(data.error || "Failed to create course");
        setData("draftDomainId", getData<string>("existingDomainId") || "");
      }

      // Ensure a test caller exists for "Try a Sim Call" — requires playbookId
      // to avoid enrolling in ALL domain playbooks (wrong course).
      if (!getData<string>("draftCallerId")) {
        const domainId = getData<string>("draftDomainId") || getData<string>("existingDomainId");
        const pbId = getData<string>("draftPlaybookId");
        if (domainId && pbId) {
          try {
            const FRIENDLY_NAMES = [
              "Alex", "Jordan", "Sam", "Taylor", "Morgan",
              "Riley", "Casey", "Jamie", "Quinn", "Avery",
              "Charlie", "Reese", "Skyler", "Finley", "Rowan",
            ];
            const simName = FRIENDLY_NAMES[Math.floor(Math.random() * FRIENDLY_NAMES.length)];
            const callerRes = await fetch("/api/callers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ domainId, name: simName, playbookId: pbId }),
            });
            const callerData = await callerRes.json();
            if (callerData.ok && callerData.caller?.id) {
              setData("draftCallerId", callerData.caller.id);
            }
          } catch {
            // Non-fatal
          }
        }
      }

      setData("launched", true);
      setLaunchPhase("done");
    } catch (err: any) {
      setLaunchError(err.message || "Something went wrong");
      setLaunchPhase("error");
    }
  }, [getData, setData]);

  // ── Content upload handler ─────────────────────────────

  const handleContentResult = useCallback(
    (result: PackUploadResult) => {
      if (result.mode === "skip") {
        setData("contentSkipped", true);
        handleAnswer("content.upload", "Skipped", "Skip for now");
      } else {
        setData("contentSkipped", false);
        if (result.subjects) setData("packSubjectIds", result.subjects.map((s) => s.id));
        if (result.sourceCount) setData("sourceCount", result.sourceCount);
        if (result.extractionTotals) setData("extractionTotals", result.extractionTotals);
        if (result.classifications) setData("classifications", result.classifications);
        const totalStr = result.extractionTotals
          ? `${result.extractionTotals.assertions} teaching points extracted`
          : "Content uploaded";
        handleAnswer("content.upload", totalStr, totalStr);
      }
    },
    [handleAnswer, setData],
  );

  // ── Render: message bubbles ────────────────────────────

  const renderMessage = (msg: ConversationMessage) => {
    if (msg.role === "system" && msg.systemType === "timeline") {
      return (
        <div key={msg.id} className="gs-chat-row gs-chat-row--system">
          <div className="gs-chat-bubble gs-chat-bubble--system">
            <div className="gs-chat-timeline">
              {(msg.timeline || sseTimeline).map((item, i) => (
                <div key={i} className={`gs-chat-timeline-item gs-chat-timeline-item--${item.status}`}>
                  {item.status === "done" && <Check size={14} />}
                  {item.status === "active" && <Loader2 size={14} className="hf-spinner" />}
                  {item.status === "pending" && <div className="gs-timeline-pending" />}
                  {item.status === "error" && <div className="gs-timeline-error" />}
                  <span>{item.label}</span>
                </div>
              ))}
              {sseError && (
                <div className="hf-banner hf-banner-error" style={{ marginTop: 8, fontSize: 12 }}>
                  {sseError}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (msg.role === "system" && msg.systemType === "success" && msg.id === "sys-course-done") {
      const callerId = getData<string>("draftCallerId");
      return (
        <div key={msg.id} className="gs-chat-row gs-chat-row--system">
          <div className="gs-chat-bubble gs-chat-bubble--system">
            <div className="gs-chat-success">
              <div className="gs-chat-success-title">
                <Check size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6, color: "var(--status-success-text)" }} />
                Course created
              </div>
              <div className="gs-chat-success-sub">Your AI tutor is ready to test.</div>
              <div className="gs-chat-success-actions">
                {callerId && (
                  <a href={`/x/sim/${callerId}`} target="_blank" rel="noopener noreferrer" className="hf-btn hf-btn-primary">
                    <Rocket size={14} /> Try a Sim Call <ExternalLink size={12} />
                  </a>
                )}
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary"
                  onClick={() => {
                    // Continue to welcome step
                    if (activeQuestion) advanceToQuestion(activeQuestion.index);
                  }}
                >
                  Continue Setup <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (msg.role === "system" && !msg.systemType) {
      // Group separator
      return (
        <div key={msg.id} className="gs-chat-group-sep">
          <span className="gs-chat-group-sep-line" />
          <span className="gs-chat-group-sep-label">{msg.content}</span>
          <span className="gs-chat-group-sep-line" />
        </div>
      );
    }

    if (msg.role === "assistant") {
      const q = CONVERSATION_SCRIPT.find((q) => q.id === msg.questionId);
      const subMsg = q?.subMessage;
      const subText = typeof subMsg === "function" ? subMsg(getData) : subMsg;
      const hintKey = q?.hintKey;
      const hintData = hintKey ? WIZARD_HINTS[hintKey] : undefined;

      return (
        <div key={msg.id} className="gs-chat-row gs-chat-row--assistant">
          <div className="gs-chat-bubble gs-chat-bubble--assistant">
            <div>
              {hintData ? (
                <FieldHint label={msg.content} hint={hintData} labelClass="" />
              ) : (
                msg.content
              )}
            </div>
            {subText && <div className="gs-chat-sub">{subText}</div>}
          </div>
        </div>
      );
    }

    if (msg.role === "user") {
      const isStale = editingQId !== null && msg.questionId !== editingQId;
      const canEdit = !editingQId; // Only allow edit when not already editing

      return (
        <div
          key={msg.id}
          className={`gs-chat-row gs-chat-row--user${isStale ? " gs-chat-bubble--stale" : ""}`}
        >
          <div
            className={`gs-chat-bubble gs-chat-bubble--user${canEdit ? " gs-chat-bubble--editable" : ""}`}
            onClick={canEdit ? () => handleEditClick(msg.questionId!) : undefined}
          >
            {msg.content}
            {canEdit && <Pencil size={10} className="gs-chat-edit-icon" />}
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Edit-back ──────────────────────────────────────────

  const handleEditClick = useCallback(
    (questionId: string) => {
      const qIdx = CONVERSATION_SCRIPT.findIndex((q) => q.id === questionId);
      if (qIdx === -1) return;

      // Find the message index of the user answer for this question
      const msgIdx = messages.findIndex(
        (m) => m.role === "user" && m.questionId === questionId,
      );
      if (msgIdx === -1) return;

      // Truncate all messages after the AI message for this question
      const aiMsgIdx = messages.findIndex(
        (m) => m.role === "assistant" && m.questionId === questionId,
      );
      if (aiMsgIdx === -1) return;

      // Keep messages up to and including the AI message, remove everything after
      setMessages((prev) => prev.slice(0, aiMsgIdx + 1));
      setActiveQIndex(qIdx);
      setEditingQId(null);

      // Restore the previous value into input
      const q = CONVERSATION_SCRIPT[qIdx];
      const ctrl = q.control;
      if ("dataKey" in ctrl) {
        const val = getData(ctrl.dataKey);
        if (ctrl.type === "text" || ctrl.type === "url") {
          setInputValue(String(val || ""));
        } else if (ctrl.type === "textarea") {
          setInputValue(String(val || ""));
        } else if (ctrl.type === "typeahead") {
          setTypeaheadQuery(String(val || ""));
          setSelectedInst(null);
        }
      }
    },
    [messages, getData],
  );

  // ── Render: inline control for active question ─────────

  const renderActiveControl = () => {
    if (!activeQuestion) return null;
    const q = activeQuestion.question;
    const ctrl = q.control;

    if (ctrl.type === "chips") {
      const currentVal = getData<string>(ctrl.dataKey) || "";
      return (
        <div className="gs-chat-control">
          <ChipSelect
            options={ctrl.options}
            value={currentVal}
            onChange={(val) => {
              setData(ctrl.dataKey, val);
              if (q.autoAdvance) {
                handleAnswer(q.id, val);
              }
            }}
            hint={ctrl.hints?.[currentVal]}
          />
          {!q.autoAdvance && (
            <div className="gs-chat-control-footer">
              <button
                type="button"
                className="hf-btn hf-btn-primary hf-btn-sm"
                onClick={() => handleAnswer(q.id, currentVal)}
                disabled={!currentVal}
              >
                Continue
              </button>
            </div>
          )}
        </div>
      );
    }

    if (ctrl.type === "type-picker") {
      const currentSlug = getData<string>(ctrl.dataKey) || null;
      const suggestedType = suggestTypeFromName(typeaheadQuery || getData<string>("institutionName") || "");
      return (
        <div className="gs-chat-control">
          <TypePicker
            value={currentSlug}
            suggestedValue={suggestedType}
            label=""
            onChange={(slug, id, domainKind) => {
              setData(ctrl.dataKey, slug);
              if (ctrl.typeIdKey) setData(ctrl.typeIdKey, id);
              if (domainKind) setData("defaultDomainKind", domainKind);
              if (q.autoAdvance) {
                handleAnswer(q.id, slug, slug);
              }
            }}
          />
        </div>
      );
    }

    if (ctrl.type === "sliders") {
      return (
        <div className="gs-chat-control">
          <div className="gs-chat-control-sliders">
            {ctrl.sliders.map((s: SliderDef) => (
              <div key={s.key} className="gs-chat-slider-row">
                <div className="gs-chat-slider-labels">
                  <span className="gs-chat-slider-label-end">{s.low}</span>
                  <span className="gs-chat-slider-label-center">{s.label}</span>
                  <span className="gs-chat-slider-label-end">{s.high}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={sliderValues[s.key] ?? 0.5}
                  onChange={(e) =>
                    setSliderValues((prev) => ({ ...prev, [s.key]: parseFloat(e.target.value) }))
                  }
                  className="gs-chat-slider-input"
                />
              </div>
            ))}
          </div>
          <div className="gs-chat-control-footer">
            <button
              type="button"
              className="hf-btn hf-btn-primary"
              onClick={() => {
                setData(ctrl.dataKey, sliderValues);
                handleAnswer(q.id, sliderValues, "Personality set");
              }}
            >
              Continue
            </button>
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => {
                // Skip — use defaults
                handleAnswer(q.id, sliderValues, "Using defaults");
              }}
            >
              Skip — use defaults
            </button>
          </div>
        </div>
      );
    }

    if (ctrl.type === "file-upload") {
      const effectiveDomainId =
        getData<string>("existingDomainId") ||
        getData<string>("draftDomainId") ||
        "";

      // Need eager creation first?
      if (!effectiveDomainId && getData<string>("institutionName") && ssePhase === "idle") {
        // Trigger eager creation
        runEagerCreation();
        return null;
      }

      if (!effectiveDomainId) {
        return (
          <div className="gs-chat-control">
            <div className="hf-flex hf-items-center hf-gap-sm hf-text-muted">
              <Loader2 size={14} className="hf-spinner" />
              <span>Setting up your workspace...</span>
            </div>
          </div>
        );
      }

      return (
        <div className="gs-chat-control gs-chat-control-upload">
          <PackUploadStep
            domainId={effectiveDomainId}
            courseName={getData<string>("courseName") || ""}
            interactionPattern={getData<string>("interactionPattern")}
            teachingMode={getData<string>("teachingMode")}
            subjectDiscipline={getData<string>("subjectDiscipline")}
            onResult={handleContentResult}
            onBack={undefined}
          />
        </div>
      );
    }

    if (ctrl.type === "actions") {
      return (
        <div className="gs-chat-control gs-chat-actions">
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={() => {
              handleAnswer(q.id, "Create & Try a Call", "Create & Try a Call");
              runCourseCreation();
            }}
          >
            <Rocket size={14} /> {ctrl.primary.label}
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={() => {
              handleAnswer(q.id, "Continue Setup", "Continue Setup");
            }}
          >
            {ctrl.secondary.label} <ArrowRight size={14} />
          </button>
        </div>
      );
    }

    if (ctrl.type === "review") {
      return (
        <div className="gs-chat-control">
          {renderReviewCard()}
        </div>
      );
    }

    // Textarea with suggestions: render clickable suggestion chips inline
    if (ctrl.type === "textarea" && ctrl.suggestions && ctrl.suggestions.length > 0) {
      return (
        <div className="gs-chat-control gs-chat-suggestions">
          {ctrl.suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              className="gs-suggestion-chip"
              onClick={() => {
                const resolved = typeof s.value === "function" ? s.value(getData) : s.value;
                setInputValue(resolved);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      );
    }

    return null; // text/textarea/url handled by input bar
  };

  // ── Review card ────────────────────────────────────────

  const renderReviewCard = () => {
    const rows: Array<{ label: string; value: string }> = [];
    const instName = getData<string>("institutionName") || getData<string>("existingInstitutionName");
    if (instName) rows.push({ label: "Organisation", value: instName });
    const courseName = getData<string>("courseName");
    if (courseName) rows.push({ label: "Course", value: courseName });
    const approach = getData<string>("interactionPattern");
    if (approach) rows.push({ label: "Teaching approach", value: approach.charAt(0).toUpperCase() + approach.slice(1) });
    const emphasis = getData<string>("teachingMode");
    if (emphasis) rows.push({ label: "Emphasis", value: emphasis.charAt(0).toUpperCase() + emphasis.slice(1) });
    const totals = getData<{ assertions: number }>("extractionTotals");
    if (totals) rows.push({ label: "Teaching points", value: String(totals.assertions) });
    const contentSkipped = getData<boolean>("contentSkipped");
    if (contentSkipped) rows.push({ label: "Content", value: "Skipped — add later" });
    const sessionCount = getData<number>("sessionCount");
    const durationMins = getData<number>("durationMins");
    if (sessionCount) rows.push({ label: "Sessions", value: `${sessionCount} × ${durationMins || 30} min` });
    const model = getData<string>("lessonPlanModel");
    if (model) rows.push({ label: "Lesson plan", value: model.charAt(0).toUpperCase() + model.slice(1) });

    const draftDomainId = getData<string>("draftDomainId");
    const isUpdate = !!draftDomainId;

    if (launchPhase === "done") {
      const callerId = getData<string>("draftCallerId");
      const domainIdForDash = getData<string>("draftDomainId") || getData<string>("existingDomainId");
      return (
        <div className="gs-chat-success">
          <div className="gs-chat-success-title">
            <Check size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6, color: "var(--status-success-text)" }} />
            Your AI tutor is live
          </div>
          <div className="gs-chat-success-sub">
            {getData<string>("courseName")} is ready for its first student.
          </div>
          <div className="gs-chat-success-actions">
            {callerId && (
              <a href={`/x/sim/${callerId}`} target="_blank" rel="noopener noreferrer" className="hf-btn hf-btn-primary">
                <Rocket size={14} /> Try a Sim Call <ExternalLink size={12} />
              </a>
            )}
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => {
                endFlow();
                router.push(domainIdForDash ? `/x/domains?id=${domainIdForDash}` : "/x/domains");
              }}
            >
              <ExternalLink size={14} /> Go to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="gs-chat-review-card">
        {rows.map((row, i) => (
          <div key={i} className="gs-chat-review-row">
            <span className="gs-chat-review-label">{row.label}</span>
            <span className="gs-chat-review-value">{row.value}</span>
          </div>
        ))}
        <div className="gs-chat-review-actions">
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={handleLaunch}
            disabled={launchPhase === "creating"}
            style={{ flex: 1 }}
          >
            {launchPhase === "creating" ? (
              <><Loader2 size={14} className="hf-spinner" /> {isUpdate ? "Publishing..." : "Creating..."}</>
            ) : (
              <><Rocket size={14} /> {isUpdate ? "Publish Course" : "Create AI Tutor"}</>
            )}
          </button>
        </div>
        {launchError && (
          <div className="hf-banner hf-banner-error" style={{ margin: 8, fontSize: 12 }}>
            {launchError}
          </div>
        )}
      </div>
    );
  };

  // ── Determine input bar visibility ─────────────────────

  const showInputBar = useMemo(() => {
    if (!activeQuestion) return false;
    const t = activeQuestion.question.control.type;
    return t === "text" || t === "textarea" || t === "url" || t === "typeahead";
  }, [activeQuestion]);

  const inputPlaceholder = useMemo(() => {
    if (!activeQuestion) return "";
    const ctrl = activeQuestion.question.control;
    if ("placeholder" in ctrl) return ctrl.placeholder;
    if (ctrl.type === "typeahead") return "Just start typing...";
    return "Type your answer...";
  }, [activeQuestion]);

  const isTextarea = activeQuestion?.question.control.type === "textarea";
  const isTypeahead = activeQuestion?.question.control.type === "typeahead";

  // ── Controls bar computed values ────────────────────────

  const stepCounterText = useMemo(() => {
    if (!activeQuestion) return null;
    const visible = CONVERSATION_SCRIPT.filter(
      (q) => !q.showWhen || q.showWhen(getData),
    );
    const idx = visible.findIndex((q) => q.id === activeQuestion.question.id);
    if (idx < 0) return null;
    return `${idx + 1} of ${visible.length}`;
  }, [activeQuestion, getData]);

  const controlsHintData = useMemo(() => {
    const hintKey = activeQuestion?.question.hintKey;
    return hintKey ? WIZARD_HINTS[hintKey] : undefined;
  }, [activeQuestion]);

  const kbHintText = useMemo(() => {
    if (!activeQuestion) return null;
    const t = activeQuestion.question.control.type;
    if (t === "textarea") return "⇧⏎ newline · ⏎ send";
    return "⏎ send";
  }, [activeQuestion]);

  const canSkip = useMemo(() => {
    if (!activeQuestion) return false;
    const t = activeQuestion.question.control.type;
    return t === "textarea" || t === "url";
  }, [activeQuestion]);

  const skipLabel = useMemo(() => {
    if (!activeQuestion) return "";
    if (activeQuestion.question.control.type === "url") return "Skip — no website";
    return "Skip";
  }, [activeQuestion]);

  // ── Cmd+K context: push entity breadcrumb ───────────────

  const flowEntityPushed = useRef(false);

  useEffect(() => {
    if (!isActive) return;

    const currentStep = activeQuestion?.question.stepId ?? "institution";
    const currentQuestionId = activeQuestion?.question.id ?? "";

    // Gather collected wizard data for AI context
    const collectedData: Record<string, unknown> = {};
    const dataKeys = [
      "institutionName", "existingInstitutionId", "existingInstitutionName",
      "typeSlug", "websiteUrl",
      "courseName", "subjectDiscipline", "interactionPattern", "teachingMode",
      "welcomeMessage", "sessionCount", "durationMins", "planEmphasis",
      "behaviorTargets", "lessonPlanModel",
      "contentSkipped", "sourceCount", "extractionTotals",
    ];
    for (const key of dataKeys) {
      const val = getData(key);
      if (val !== undefined && val !== "") collectedData[key] = val;
    }

    // Count answered vs remaining
    const visible = CONVERSATION_SCRIPT.filter(
      (q) => !q.showWhen || q.showWhen(getData),
    );
    const answeredIds = messages
      .filter((m) => m.role === "user" && m.questionId)
      .map((m) => m.questionId);
    const remaining = visible
      .filter((q) => !answeredIds.includes(q.id))
      .map((q) => q.id);

    const entity = {
      type: "flow" as const,
      id: "get-started",
      label: "Get Started Wizard",
      data: {
        currentStep,
        currentQuestion: currentQuestionId,
        collectedData,
        answeredCount: answeredIds.length,
        totalVisible: visible.length,
        remainingQuestions: remaining,
      },
    };

    // First time: push. Subsequent: replace to update data without dedup skip.
    if (!flowEntityPushed.current) {
      pushEntity(entity);
      flowEntityPushed.current = true;
    } else {
      replaceEntity(entity);
    }

    return () => {
      popEntity();
      flowEntityPushed.current = false;
    };
  }, [isActive, activeQuestion, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading state ──────────────────────────────────────

  if (!isActive) return null;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="gs-chat-container">
      {/* ── Messages ── */}
      <div className="gs-chat-messages">
        {messages.map(renderMessage)}

        {/* Active control (inline, below the last AI message) */}
        {!isTyping && activeQuestion && renderActiveControl()}

        {/* Typing indicator */}
        {isTyping && (
          <div className="gs-chat-row gs-chat-row--assistant">
            <div className="gs-chat-typing">
              <div className="gs-chat-typing-dot" />
              <div className="gs-chat-typing-dot" />
              <div className="gs-chat-typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar (two zones: typing + controls) ── */}
      <div className={`gs-chat-input-bar${showInputBar ? "" : " gs-chat-input-bar--hidden"}`}>
        {/* Zone 1: Full-width typing area */}
        <div className="gs-chat-input-zone">
          {isTypeahead ? (
            <div className="gs-chat-typeahead-wrap" ref={typeaheadWrapRef}>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={selectedInst ? selectedInst.name : typeaheadQuery}
                  readOnly={!!selectedInst}
                  onChange={(e) => {
                    setTypeaheadQuery(e.target.value);
                    setShowDropdown(true);
                    setHighlightIndex(-1);
                    if (selectedInst) {
                      setSelectedInst(null);
                      handleClearInstitution();
                    }
                  }}
                  onFocus={() => {
                    if (!selectedInst && typeaheadQuery.trim()) setShowDropdown(true);
                  }}
                  onKeyDown={handleTypeaheadKeyDown}
                  placeholder={instLoading ? "Loading..." : "Just start typing..."}
                  className={`gs-chat-textarea${selectedInst ? " gs-typeahead-locked" : ""}`}
                  style={{ paddingRight: selectedInst ? 36 : undefined }}
                />
                {selectedInst && (
                  <button
                    type="button"
                    className="gs-typeahead-clear"
                    onClick={handleClearInstitution}
                    aria-label="Clear selection"
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
                  >
                    <X size={16} />
                  </button>
                )}

                {/* Dropdown */}
                {showDropdown && !selectedInst && dropdownItemCount > 0 && (
                  <div className="gs-typeahead-dropdown">
                    {filteredInstitutions.map((inst, index) => (
                      <div
                        key={inst.id}
                        data-index={index}
                        data-highlighted={highlightIndex === index || undefined}
                        className="gs-typeahead-row"
                        onClick={() => handleSelectInstitution(inst)}
                        onMouseEnter={() => setHighlightIndex(index)}
                      >
                        <span className="gs-typeahead-row-name">{inst.name}</span>
                        {inst.typeSlug && (
                          <span className="gs-typeahead-row-meta">{inst.typeSlug}</span>
                        )}
                      </div>
                    ))}
                    {showCreateAction && (
                      <div
                        data-index={filteredInstitutions.length}
                        data-highlighted={highlightIndex === filteredInstitutions.length || undefined}
                        className="gs-typeahead-row gs-typeahead-create"
                        onClick={() => {
                          setShowDropdown(false);
                          handleTextSubmit();
                        }}
                        onMouseEnter={() => setHighlightIndex(filteredInstitutions.length)}
                      >
                        + Create &ldquo;{typeaheadQuery.trim()}&rdquo; as new organisation
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Locked badge */}
              {selectedInst && (
                <div className="gs-locked-badge" style={{ marginTop: 4 }}>
                  <Check size={14} />
                  <span>Using existing</span>
                  {selectedInst.typeSlug && (
                    <>
                      <span className="gs-locked-badge-sep" />
                      <span>{selectedInst.typeSlug}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={() => {
                if (activeQuestion?.question.control.type === "url" && inputValue.trim()) {
                  handleUrlImport(inputValue);
                }
              }}
              placeholder={inputPlaceholder}
              rows={isTextarea ? 3 : 1}
              className="gs-chat-textarea"
            />
          )}

          {/* URL import indicator */}
          {urlImporting && (
            <div className="hf-ai-loading-row" style={{ marginTop: 4, fontSize: 12 }}>
              <Loader2 size={12} className="hf-spinner" />
              <span>Importing from website...</span>
            </div>
          )}
        </div>

        {/* Zone 2: Controls bar */}
        <div className="gs-chat-controls-bar">
          <div className="gs-chat-controls-left">
            {controlsHintData && (
              <FieldHint label="" hint={controlsHintData} compact />
            )}
            {canSkip && (
              <>
                {controlsHintData && <span className="gs-chat-controls-sep">&middot;</span>}
                <button
                  type="button"
                  className="gs-chat-controls-btn"
                  onClick={() => handleAnswer(activeQuestion!.question.id, "", "(Skipped)")}
                >
                  {skipLabel}
                </button>
              </>
            )}
            {(controlsHintData || canSkip) && <span className="gs-chat-controls-sep">&middot;</span>}
            <button
              type="button"
              className="gs-chat-cmdk-btn"
              onClick={() => toggleChatPanel()}
              title="Ask AI for help (⌘K)"
            >
              <Command size={12} />
              <span>K</span>
            </button>
          </div>

          <div className="gs-chat-controls-right">
            {stepCounterText && (
              <span className="gs-chat-step-counter">{stepCounterText}</span>
            )}
            {kbHintText && (
              <span className="gs-chat-kb-hint">{kbHintText}</span>
            )}
            <button
              type="button"
              className="gs-chat-send-btn"
              disabled={
                isTypeahead
                  ? (!typeaheadQuery.trim() && !selectedInst)
                  : (activeQuestion?.question.control.type === "text" ? !inputValue.trim() : false)
              }
              onClick={handleTextSubmit}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
