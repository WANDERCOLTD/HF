"use client";

/**
 * DemoTeachWizard — shared 6-step wizard for Demonstrate and Teach flows.
 *
 * Config-driven: the page wrapper passes a DemoTeachConfig that controls
 * flowId, labels, API filters, and terminology. All state, effects, and
 * rendering live here — the pages are thin wrappers.
 *
 * Steps: Select Institution [& Caller] → Set Your Goal → Add Content → Readiness Checks → Preview First Prompt → Launch
 *
 * When config.requireCallerUpfront is false (Teach flow), the caller is
 * auto-created at launch time instead of being selected in step 0.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { ProgressStepper } from "@/components/shared/ProgressStepper";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { useEntityContext } from "@/contexts/EntityContext";
import { useTerminology } from "@/contexts/TerminologyContext";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Pencil,
  Trash2,
  Save,
  X,
  Plus,
  Building2,
  User,
  Target,
  PlayCircle,
  Upload,
  FileText,
  CheckCircle2,
  Library,
} from "lucide-react";
import { OnboardingTabContent } from "@/app/x/domains/components/OnboardingTab";
import { PromptPreviewContent } from "@/app/x/domains/components/PromptPreviewModal";
import type { DomainDetail } from "@/app/x/domains/components/types";
import { AgentTuningPanel, type AgentTuningPanelOutput } from "@/components/shared/AgentTuningPanel";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { useWizardError } from "@/hooks/useWizardError";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { POLL_TIMEOUT_MS } from "@/lib/tasks/constants";
import "./demo-teach-wizard.css";

// ── Types ──────────────────────────────────────────

type CourseCheck = {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
};

type DomainInfo = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  callerCount: number;
};

type CallerInfo = {
  id: string;
  name: string;
};

type CallerGoal = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  progress: number;
  priority: number;
};

type AvailableSource = {
  id: string;
  name: string;
  _count: { assertions: number };
  subjects: Array<{
    subject: {
      domains: Array<{ domain: { id: string } }>;
    };
  }>;
};

const GOAL_TYPE_EMOJI: Record<string, string> = {
  LEARN: "\uD83D\uDCDA",
  ACHIEVE: "\uD83C\uDFC6",
  CHANGE: "\uD83D\uDD04",
  CONNECT: "\uD83E\uDD1D",
  SUPPORT: "\uD83D\uDCAA",
  CREATE: "\uD83C\uDFA8",
};

// ── Config ─────────────────────────────────────────

export interface DemoTeachConfig {
  /** Flow ID for StepFlowContext (e.g. "demonstrate" | "teach") */
  flowId: string;
  /** Wizard name for /api/wizard-steps?wizard= */
  wizardName: string;
  /** Return path for StepFlowContext */
  returnPath: string;
  /** Fallback step definitions if spec not in DB */
  fallbackSteps: StepDefinition[];
  /** Page title shown in the hero header */
  headerTitle: string;
  /** Emoji shown in the hero header icon */
  headerEmoji: string;
  /** Optional domain API filter (e.g. "?onlyInstitution=true") */
  domainApiFilter?: string;
  /** When true, uses useTerminology() for dynamic labels */
  useTerminologyLabels: boolean;
  /** When false, skip caller selection in step 0 and auto-create at launch. Default: true */
  requireCallerUpfront?: boolean;
}

// ── Component ──────────────────────────────────────

export default function DemoTeachWizard({ config }: { config: DemoTeachConfig }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, isActive, startFlow, setStep, setData, getData, endFlow } =
    useStepFlow();
  const { pushEntity } = useEntityContext();
  const { terms } = useTerminology();
  const { error: wizardError, setError: setWizardError, clearError: clearWizardError } = useWizardError();
  const flowInitialized = useRef(false);

  // Resolve labels: terminology-aware or hardcoded
  const t = config.useTerminologyLabels
    ? {
        domain: terms.domain,
        caller: terms.caller,
        session: terms.session,
      }
    : {
        domain: "Institution",
        caller: "Caller",
        session: "Lesson",
      };

  // ── State ──────────────────────────────────────────

  // Domain selector
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [domainOptions, setDomainOptions] = useState<FancySelectOption[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [loadingDomains, setLoadingDomains] = useState(true);

  // Caller for selected domain
  const [callers, setCallers] = useState<CallerInfo[]>([]);
  const [selectedCallerId, setSelectedCallerId] = useState("");
  const [callerOptions, setCallerOptions] = useState<FancySelectOption[]>([]);

  // Goal text
  const [goalText, setGoalText] = useState("");

  // Course readiness
  const [checks, setChecks] = useState<CourseCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [checksLoading, setChecksLoading] = useState(false);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState<"ready" | "almost" | "incomplete">(
    "incomplete",
  );

  // AI goal suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const lastSuggestText = useRef("");

  // Caller goals (CRUD)
  const [callerGoals, setCallerGoals] = useState<CallerGoal[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editGoalName, setEditGoalName] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  const currentStep = state?.currentStep ?? 0;

  // Content upload step
  type ContentPhase = "loading" | "has-content" | "no-content" | "uploading" | "extracting" | "generating-curriculum" | "composing-prompt" | "attaching-source" | "done" | "error";
  const [contentPhase, setContentPhase] = useState<ContentPhase>("loading");
  const [contentCount, setContentCount] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState({ current: 0, total: 0, extracted: 0 });
  const [extractElapsed, setExtractElapsed] = useState(0);
  const extractPollRef = useRef<NodeJS.Timeout | null>(null);
  const extractTickRef = useRef<NodeJS.Timeout | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const UPLOAD_ACCEPTED = [".pdf", ".txt", ".md", ".markdown", ".json"];

  // Content source selection (existing sources)
  type ContentMode = "select" | "upload";
  const [contentMode, setContentMode] = useState<ContentMode>("select");
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Post-extraction auto-wiring results
  const [autoWireResult, setAutoWireResult] = useState<{
    moduleCount: number;
    contentSpecGenerated: boolean;
    promptComposed: boolean;
    warnings: string[];
  } | null>(null);

  // Expandable sections on Launch step
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [teachingPointsExpanded, setTeachingPointsExpanded] = useState(false);
  const [domainDetail, setDomainDetail] = useState<DomainDetail | null>(null);
  const [domainDetailLoading, setDomainDetailLoading] = useState(false);
  const [teachingPoints, setTeachingPoints] = useState<Array<{ id: string; text: string; type: string; reviewed: boolean }>>([]);
  const [teachingPointsLoading, setTeachingPointsLoading] = useState(false);
  const [tunePersonaExpanded, setTunePersonaExpanded] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);

  // Launch-time caller creation (when requireCallerUpfront === false)
  type LaunchPhase = "idle" | "scaffolding" | "creating-caller" | "creating-goals" | "composing-prompt" | "redirecting";
  const [launching, setLaunching] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");

  // Convenience flag
  const needsCallerUpfront = config.requireCallerUpfront !== false;

  // Warn on browser refresh/close when user has started filling in data
  useUnsavedGuard(goalText.trim().length > 0 || !!selectedDomainId);

  // ── Initialize step flow ──────────────────────────

  useEffect(() => {
    if (flowInitialized.current) return;
    flowInitialized.current = true;

    const initFlow = async () => {
      let stepsToUse = config.fallbackSteps;
      try {
        const res = await fetch(
          `/api/wizard-steps?wizard=${config.wizardName}`,
        );
        const data = await res.json();
        if (data.ok && data.steps?.length > 0) {
          stepsToUse = data.steps.map((s: any) => ({
            id: s.id,
            label: s.label,
            activeLabel: s.activeLabel,
          }));
        }
      } catch {
        // Silent — use hardcoded fallback
      }

      if (!isActive) {
        startFlow({
          flowId: config.flowId,
          steps: stepsToUse,
          returnPath: config.returnPath,
        });
      } else {
        // Returning from a fix-action page — restore state from context
        const savedDomainId = getData<string>("domainId");
        const savedCallerId = getData<string>("callerId");
        const savedGoal = getData<string>("goal");
        const savedReady = getData<boolean>("ready");
        const savedScore = getData<number>("score");
        const savedLevel = getData<"ready" | "almost" | "incomplete">("level");
        if (savedDomainId) setSelectedDomainId(savedDomainId);
        if (savedCallerId) setSelectedCallerId(savedCallerId);
        if (savedGoal) setGoalText(savedGoal);
        if (savedReady !== undefined) setReady(savedReady);
        if (savedScore !== undefined) setScore(savedScore);
        if (savedLevel) setLevel(savedLevel);
      }
    };
    initFlow();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push flow breadcrumb for Cmd+K awareness ──────

  useEffect(() => {
    if (isActive) {
      pushEntity({
        type: "flow",
        id: config.flowId,
        label: `${config.headerTitle} Flow`,
        data: {
          step: currentStep,
          stepLabel: config.fallbackSteps[currentStep]?.label,
          goal: goalText,
          domainId: selectedDomainId,
          callerId: selectedCallerId,
        },
      });
    }
  }, [isActive, currentStep, goalText, selectedDomainId, selectedCallerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load domains on mount ─────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const filter = config.domainApiFilter || "";
        const res = await fetch(`/api/domains${filter}`);
        const data = await res.json();
        if (data.ok) {
          const list: DomainInfo[] = data.domains || [];
          setDomains(list);
          setDomainOptions(
            list.map((d) => ({
              value: d.id,
              label: d.name,
              subtitle: d.slug,
              badge: d.isDefault ? "Default" : undefined,
            })),
          );
          // Auto-select: URL param > context data > default domain > only domain
          const urlDomainId = searchParams.get("domainId");
          const ctxDomainId = getData<string>("domainId");
          if (urlDomainId && list.some((d) => d.id === urlDomainId)) {
            setSelectedDomainId(urlDomainId);
          } else if (ctxDomainId && list.some((d) => d.id === ctxDomainId)) {
            setSelectedDomainId(ctxDomainId);
          } else {
            const defaultDomain = list.find((d) => d.isDefault);
            if (defaultDomain) setSelectedDomainId(defaultDomain.id);
            else if (list.length === 1) setSelectedDomainId(list[0].id);
          }
        }
      } catch (e) {
        console.warn(`[${config.headerTitle}] Failed to load domains:`, e);
        setWizardError(`Failed to load ${t.domain.toLowerCase()}s`);
      } finally {
        setLoadingDomains(false);
      }
    })();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load callers when domain changes ──────────────

  useEffect(() => {
    if (!needsCallerUpfront) return; // Caller created at launch time
    if (!selectedDomainId) {
      setCallers([]);
      setCallerOptions([]);
      setSelectedCallerId("");
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/callers?scope=ALL", { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (data.ok) {
          const domainCallers = (data.callers || []).filter(
            (c: any) => c.domainId === selectedDomainId,
          );
          const list: CallerInfo[] = domainCallers.map((c: any) => ({
            id: c.id,
            name: c.name || c.email || c.id,
          }));
          setCallers(list);
          setCallerOptions(
            list.map((c) => ({
              value: c.id,
              label: c.name,
            })),
          );
          // Auto-select: URL param > context data > first caller
          const urlCallerId = searchParams.get("callerId");
          const ctxCallerId = getData<string>("callerId");
          if (urlCallerId && list.some((c) => c.id === urlCallerId)) {
            setSelectedCallerId(urlCallerId);
          } else if (
            ctxCallerId &&
            list.some((c) => c.id === ctxCallerId)
          ) {
            setSelectedCallerId(ctxCallerId);
          } else if (list.length > 0) {
            setSelectedCallerId(list[0].id);
          } else {
            setSelectedCallerId("");
          }
        }
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.warn(`[${config.headerTitle}] Failed to load callers:`, e);
      }
    })();
    return () => controller.abort();
  }, [selectedDomainId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch AI goal suggestions ─────────────────────

  const fetchSuggestions = useCallback(
    async (forceText?: string) => {
      if (!selectedDomainId) return;
      if (needsCallerUpfront && !selectedCallerId) return;
      const text = forceText ?? goalText;
      if (text === lastSuggestText.current && suggestions.length > 0) return;
      lastSuggestText.current = text;
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({ domainId: selectedDomainId });
        if (selectedCallerId) params.set("callerId", selectedCallerId);
        if (text) params.set("currentGoal", text);
        const res = await fetch(`/api/demonstrate/suggest?${params}`);
        const data = await res.json();
        if (data.ok && data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch {
        // Non-critical — suggestions are optional
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [selectedDomainId, selectedCallerId, needsCallerUpfront, goalText, suggestions.length],
  );

  useEffect(() => {
    if (currentStep === 1 && selectedDomainId && (needsCallerUpfront ? selectedCallerId : true)) {
      fetchSuggestions("");
    }
  }, [currentStep, selectedDomainId, selectedCallerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch caller goals ────────────────────────────

  const fetchCallerGoals = useCallback(async () => {
    if (!selectedCallerId) {
      setCallerGoals([]);
      return;
    }
    setLoadingGoals(true);
    try {
      const res = await fetch(
        `/api/goals?callerId=${selectedCallerId}&status=ACTIVE`,
      );
      const data = await res.json();
      if (data.ok) {
        setCallerGoals(data.goals || []);
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingGoals(false);
    }
  }, [selectedCallerId]);

  useEffect(() => {
    if (currentStep === 1 && selectedCallerId) {
      fetchCallerGoals();
    }
  }, [currentStep, selectedCallerId, fetchCallerGoals]);

  // ── Goal CRUD handlers ────────────────────────────

  const handleSaveAsGoal = async () => {
    if (!goalText.trim() || !selectedCallerId || savingGoal) return;
    setSavingGoal(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerId: selectedCallerId,
          name: goalText.trim(),
          type: "LEARN",
        }),
      });
      const data = await res.json();
      if (data.ok && data.goal) {
        setCallerGoals((prev) => [data.goal, ...prev]);
      }
    } catch {
      setWizardError("Failed to save goal. Please try again.");
    } finally {
      setSavingGoal(false);
    }
  };

  const handleUpdateGoal = async (goalId: string) => {
    if (!editGoalName.trim()) return;
    try {
      const res = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editGoalName.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.goal) {
        setCallerGoals((prev) =>
          prev.map((g) =>
            g.id === goalId ? { ...g, name: data.goal.name } : g,
          ),
        );
      }
    } catch {
      setWizardError("Failed to update goal. Please try again.");
    } finally {
      setEditingGoalId(null);
      setEditGoalName("");
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    try {
      const res = await fetch(`/api/goals/${goalId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setCallerGoals((prev) => prev.filter((g) => g.id !== goalId));
      }
    } catch {
      setWizardError("Failed to delete goal. Please try again.");
    }
  };

  // ── Fetch course readiness ────────────────────────

  const readinessAbort = useRef<AbortController | null>(null);

  const fetchReadiness = useCallback(async () => {
    if (!selectedDomainId) return;
    // Abort any in-flight readiness fetch
    readinessAbort.current?.abort();
    const controller = new AbortController();
    readinessAbort.current = controller;

    setChecksLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCallerId) params.set("callerId", selectedCallerId);
      const res = await fetch(
        `/api/domains/${selectedDomainId}/course-readiness?${params}`,
        { signal: controller.signal },
      );
      const data = await res.json();
      if (data.ok) {
        setChecks(data.checks || []);
        setReady(data.ready ?? false);
        setScore(data.score ?? 0);
        setLevel(data.level ?? "incomplete");
        // Persist to data bag for refresh resilience
        setData("ready", data.ready ?? false);
        setData("score", data.score ?? 0);
        setData("level", data.level ?? "incomplete");
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.warn(`[${config.headerTitle}] Readiness fetch failed:`, e);
    } finally {
      if (!controller.signal.aborted) setChecksLoading(false);
    }
  }, [selectedDomainId, selectedCallerId, config.headerTitle]);

  useEffect(() => {
    if (currentStep === 3 && selectedDomainId) fetchReadiness();
  }, [currentStep, selectedDomainId, selectedCallerId, fetchReadiness]);

  // Poll readiness every 10s while on step 3 (with timeout guard)
  useEffect(() => {
    if (currentStep !== 3 || !selectedDomainId) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        return;
      }
      fetchReadiness();
    }, 10_000);
    return () => clearInterval(interval);
  }, [currentStep, selectedDomainId, fetchReadiness]);

  // ── Content upload step logic ─────────────────────

  // Detect content on step 2 mount
  useEffect(() => {
    if (currentStep !== 2 || !selectedDomainId) return;
    setContentPhase("loading");
    setUploadError(null);
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams();
        if (selectedCallerId) params.set("callerId", selectedCallerId);
        const res = await fetch(`/api/domains/${selectedDomainId}/course-readiness?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          const lessonCheck = (data.checks || []).find((c: CourseCheck) => c.id === "lesson_plan");
          if (lessonCheck?.passed) {
            // Extract count from detail string like "117 content item(s) extracted"
            const match = lessonCheck.detail?.match(/^(\d+)/);
            setContentCount(match ? parseInt(match[1], 10) : 0);
            setContentPhase("has-content");
          } else {
            setContentPhase("no-content");
          }
        } else {
          setContentPhase("no-content");
        }
      } catch {
        if (!cancelled) setContentPhase("no-content");
      }
    })();

    return () => { cancelled = true; };
  }, [currentStep, selectedDomainId, selectedCallerId]);

  // Cleanup poll/tick on unmount
  useEffect(() => {
    return () => {
      if (extractPollRef.current) clearInterval(extractPollRef.current);
      if (extractTickRef.current) clearInterval(extractTickRef.current);
    };
  }, []);

  // Fetch available content sources when entering no-content phase
  useEffect(() => {
    if (contentPhase !== "no-content") return;
    let cancelled = false;

    (async () => {
      setLoadingSources(true);
      try {
        const res = await fetch("/api/content-sources?activeOnly=true");
        const data = await res.json();
        if (cancelled) return;
        if (data.sources) {
          const withAssertions = (data.sources as AvailableSource[]).filter(
            (s) => s._count.assertions > 0
          );
          setAvailableSources(withAssertions);
          setContentMode(withAssertions.length > 0 ? "select" : "upload");
        }
      } catch {
        if (!cancelled) {
          setAvailableSources([]);
          setContentMode("upload");
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();

    return () => { cancelled = true; };
  }, [contentPhase]);

  const handleUploadFile = useCallback((f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!UPLOAD_ACCEPTED.includes(ext)) {
      setUploadError(`Unsupported file type: ${ext}. Accepted: ${UPLOAD_ACCEPTED.join(", ")}`);
      return;
    }
    setUploadFile(f);
    setUploadError(null);
  }, []);

  const handleUploadDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setUploadDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUploadFile(e.dataTransfer.files[0]);
  }, [handleUploadFile]);

  // ── Post-extraction wiring ────────────────────────
  // After assertions are extracted, generate a content spec (curriculum)
  // and re-compose the caller's prompt so the first call has teaching content.
  // Mirrors Quick Launch steps 6 + 8.

  const runPostExtractionWiring = useCallback(async (extractedCount: number) => {
    const warnings: string[] = [];
    let moduleCount = 0;
    let contentSpecGenerated = false;
    let promptComposed = false;

    // Phase 0: Ensure domain has a published playbook (idempotent scaffold)
    // Without this, generateContentSpec can't link the content spec to a playbook
    try {
      await fetch(`/api/domains/${selectedDomainId}/scaffold`, { method: "POST" });
    } catch (e: any) {
      console.warn("[Teach] Scaffold failed (non-critical):", e);
      warnings.push("Domain scaffold failed — content spec may not be linked to playbook");
    }

    // Phase 1: Generate content spec from assertions
    setContentPhase("generating-curriculum");
    try {
      const specRes = await fetch(`/api/domains/${selectedDomainId}/generate-content-spec`, {
        method: "POST",
      });
      const specData = await specRes.json();
      if (specData.ok && specData.result?.contentSpec) {
        moduleCount = specData.result.moduleCount || 0;
        contentSpecGenerated = true;
      } else if (specData.result?.skipped?.length > 0) {
        // Already exists or no assertions — not an error
        warnings.push(...specData.result.skipped);
        contentSpecGenerated = true;
      } else if (specData.error) {
        warnings.push(`Curriculum: ${specData.error}`);
      }
    } catch (e: any) {
      console.warn("[Teach] Content spec generation failed:", e);
      warnings.push("Curriculum generation failed");
    }

    // Phase 2: Compose prompt (even if spec generation failed —
    // per-turn RAG can still find raw assertions)
    if (selectedCallerId) {
      setContentPhase("composing-prompt");
      try {
        const composeRes = await fetch(`/api/callers/${selectedCallerId}/compose-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggerType: "teach-wizard" }),
        });
        const composeData = await composeRes.json();
        if (composeData.ok) {
          promptComposed = true;
        } else {
          warnings.push(`Prompt: ${composeData.error || "composition failed"}`);
        }
      } catch (e: any) {
        console.warn("[Teach] Prompt composition failed:", e);
        warnings.push("Prompt composition failed");
      }
    }

    setAutoWireResult({
      moduleCount,
      contentSpecGenerated,
      promptComposed,
      warnings,
    });
    setContentPhase("done");
  }, [selectedDomainId, selectedCallerId]);

  const handleStartUpload = useCallback(async () => {
    if (!uploadFile || !selectedDomainId) return;
    setContentPhase("uploading");
    setUploadError(null);

    try {
      // 1. Get domain detail to find subjects
      const domRes = await fetch(`/api/domains/${selectedDomainId}`);
      const domData = await domRes.json();
      const domSlug = domData.domain?.slug || "content";
      const domName = domData.domain?.name || "Content";
      const subjects = domData.domain?.subjects || [];

      let subjectId: string;

      if (subjects.length > 0) {
        subjectId = subjects[0].subjectId || subjects[0].subject?.id;
      } else {
        // Auto-create subject + link to domain
        const slug = domSlug + "-content-" + Date.now();
        const subRes = await fetch("/api/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name: `${domName} Content` }),
        });
        const subData = await subRes.json();
        if (!subData.subject?.id) throw new Error("Failed to create subject");
        subjectId = subData.subject.id;

        // Link subject to domain
        await fetch(`/api/subjects/${subjectId}/domains`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domainId: selectedDomainId }),
        });
      }

      // 2. Upload file to subject → creates ContentSource
      const uploadFormData = new FormData();
      uploadFormData.append("file", uploadFile);
      uploadFormData.append("sourceName", uploadFile.name);

      const uploadRes = await fetch(`/api/subjects/${subjectId}/upload`, {
        method: "POST",
        body: uploadFormData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.ok || !uploadData.source?.id) {
        throw new Error(uploadData.error || "Upload failed");
      }
      const sourceId = uploadData.source.id;

      // 3. Start background extraction
      const extractFormData = new FormData();
      extractFormData.append("file", uploadFile);
      extractFormData.append("mode", "background");
      extractFormData.append("maxAssertions", "500");

      const extractRes = await fetch(`/api/content-sources/${sourceId}/import`, {
        method: "POST",
        body: extractFormData,
      });
      const extractData = await extractRes.json();
      if (!extractData.ok || !extractData.jobId) {
        throw new Error(extractData.error || "Extraction start failed");
      }

      // 4. Start polling
      setContentPhase("extracting");
      setExtractProgress({ current: 0, total: extractData.totalChunks || 0, extracted: 0 });
      setExtractElapsed(0);
      extractTickRef.current = setInterval(() => setExtractElapsed((e) => e + 1), 1000);

      const startedAt = Date.now();
      extractPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 3 * 60 * 1000) {
          if (extractPollRef.current) clearInterval(extractPollRef.current);
          if (extractTickRef.current) clearInterval(extractTickRef.current);
          setUploadError("Extraction timed out");
          setContentPhase("error");
          return;
        }
        try {
          const pollRes = await fetch(`/api/content-sources/${sourceId}/import?jobId=${extractData.jobId}`);
          const pollData = await pollRes.json();
          if (!pollData.ok) return;
          const job = pollData.job;
          setExtractProgress({
            current: job.currentChunk || 0,
            total: job.totalChunks || 0,
            extracted: job.extractedCount || 0,
          });
          if (job.status === "done") {
            if (extractPollRef.current) clearInterval(extractPollRef.current);
            if (extractTickRef.current) clearInterval(extractTickRef.current);
            const count = job.importedCount || job.extractedCount || 0;
            setContentCount(count);
            // Chain into content spec generation + prompt composition
            runPostExtractionWiring(count);
          } else if (job.status === "error") {
            if (extractPollRef.current) clearInterval(extractPollRef.current);
            if (extractTickRef.current) clearInterval(extractTickRef.current);
            setUploadError(job.error || "Extraction failed");
            setContentPhase("error");
          }
        } catch { /* network blip — keep polling */ }
      }, 2000);
    } catch (e: any) {
      setUploadError(e.message || "Upload failed");
      setContentPhase("error");
    }
  }, [uploadFile, selectedDomainId, runPostExtractionWiring]);

  // ── Select existing content source ─────────────────

  const handleSelectExistingSource = useCallback(async (sourceId: string) => {
    if (!selectedDomainId) return;
    setSelectedSourceId(sourceId);
    setContentPhase("attaching-source");
    setUploadError(null);

    try {
      // 1. Get domain detail to find or create subject
      const domRes = await fetch(`/api/domains/${selectedDomainId}`);
      const domData = await domRes.json();
      const domSlug = domData.domain?.slug || "content";
      const domName = domData.domain?.name || "Content";
      const subjects = domData.domain?.subjects || [];

      let subjectId: string;

      if (subjects.length > 0) {
        subjectId = subjects[0].subjectId || subjects[0].subject?.id;
      } else {
        // Auto-create subject + link to domain
        const slug = domSlug + "-content-" + Date.now();
        const subRes = await fetch("/api/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name: `${domName} Content` }),
        });
        const subData = await subRes.json();
        if (!subData.subject?.id) throw new Error("Failed to create subject");
        subjectId = subData.subject.id;

        // Link subject to domain
        await fetch(`/api/subjects/${subjectId}/domains`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domainId: selectedDomainId }),
        });
      }

      // 2. Attach the existing source to this subject (409 = already attached, OK)
      const attachRes = await fetch(`/api/subjects/${subjectId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      if (!attachRes.ok && attachRes.status !== 409) {
        const attachData = await attachRes.json();
        throw new Error(attachData.error || "Failed to attach source");
      }

      // 3. Get the assertion count from the selected source
      const source = availableSources.find((s) => s.id === sourceId);
      const count = source?._count.assertions || 0;
      setContentCount(count);

      // 4. Run post-extraction wiring (generate content spec + compose prompt)
      await runPostExtractionWiring(count);
    } catch (e: any) {
      console.error("[Teach] Source selection failed:", e);
      setUploadError(e.message || "Failed to attach content source");
      setContentPhase("error");
      setSelectedSourceId(null);
    }
  }, [selectedDomainId, availableSources, runPostExtractionWiring]);

  // ── Helpers ───────────────────────────────────────

  const selectedDomain = domains.find((d) => d.id === selectedDomainId);

  const levelColor =
    level === "ready"
      ? "var(--status-success-text)"
      : level === "almost"
        ? "var(--status-warning-text)"
        : "var(--text-muted)";

  const levelLabel =
    level === "ready"
      ? "Ready"
      : level === "almost"
        ? "Almost Ready"
        : "Incomplete";

  const canAdvanceFromDomain = !!selectedDomainId && (needsCallerUpfront ? !!selectedCallerId : true);
  const canAdvanceFromGoal = goalText.trim().length > 0;

  const handleNext = () => {
    if (currentStep === 0) {
      setData("domainId", selectedDomainId);
      setData("domainName", selectedDomain?.name || "");
      if (needsCallerUpfront) {
        setData("callerId", selectedCallerId);
      }
    } else if (currentStep === 1) {
      setData("goal", goalText.trim());
    } else if (currentStep === 3) {
      // Persist readiness state so Launch step has it even after refresh
      setData("ready", ready);
      setData("score", score);
      setData("level", level);
    }
    // Steps 2 (content), 4 (preview) have no data to persist — just advance
    setStep(currentStep + 1);
  };

  const handlePrev = () => {
    // Save context before navigating back
    if (currentStep === 1) {
      setData("goal", goalText.trim());
    } else if (currentStep >= 1) {
      setData("domainId", selectedDomainId);
      setData("callerId", selectedCallerId);
      setData("domainName", selectedDomain?.name || "");
    }
    setStep(currentStep - 1);
  };

  const handleStartLesson = useCallback(async () => {
    if (needsCallerUpfront) {
      // Original behavior: caller already exists, just redirect
      if (!selectedCallerId || !ready) return;
      const goal = goalText.trim();
      const params = new URLSearchParams();
      if (selectedDomainId) params.set("domainId", selectedDomainId);
      if (goal) params.set("goal", goal);
      const qs = params.toString();
      endFlow();
      router.push(`/x/sim/${selectedCallerId}${qs ? `?${qs}` : ""}`);
      return;
    }

    // New behavior: auto-create caller at launch time
    if (!selectedDomainId || launching) return;
    setLaunching(true);
    setLaunchPhase("idle");
    clearWizardError();

    try {
      const domainName = selectedDomain?.name || "Unknown";

      // Step 1: Scaffold domain (ensure playbook exists — idempotent)
      setLaunchPhase("scaffolding");
      await fetch(`/api/domains/${selectedDomainId}/scaffold`, { method: "POST" });

      // Step 2: Create test caller (auto-enrolls in domain playbooks via API)
      setLaunchPhase("creating-caller");
      const callerRes = await fetch("/api/callers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Test Learner — ${domainName}`,
          domainId: selectedDomainId,
        }),
      });
      const callerData = await callerRes.json();
      if (!callerData.ok || !callerData.caller?.id) {
        throw new Error(callerData.error || "Failed to create test learner");
      }
      const newCallerId = callerData.caller.id;

      // Step 3: Create goal if provided
      const goal = goalText.trim();
      if (goal) {
        setLaunchPhase("creating-goals");
        await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callerId: newCallerId,
            name: goal,
            type: "LEARN",
          }),
        });
      }

      // Step 4: Compose prompt
      setLaunchPhase("composing-prompt");
      await fetch(`/api/callers/${newCallerId}/compose-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "teach-wizard" }),
      });

      // Step 5: Redirect to sim
      setLaunchPhase("redirecting");
      const params = new URLSearchParams();
      if (selectedDomainId) params.set("domainId", selectedDomainId);
      if (goal) params.set("goal", goal);
      const qs = params.toString();
      endFlow();
      router.push(`/x/sim/${newCallerId}${qs ? `?${qs}` : ""}`);
    } catch (e: any) {
      console.error("[Teach] Launch failed:", e);
      setWizardError(e.message || "Failed to start lesson. Please try again.");
      setLaunching(false);
      setLaunchPhase("idle");
    }
  }, [needsCallerUpfront, selectedDomainId, selectedCallerId, selectedDomain, goalText, ready, launching, endFlow, router, clearWizardError, setWizardError]);

  // Fetch full domain detail for onboarding accordion
  const fetchDomainDetail = useCallback(async () => {
    if (!selectedDomainId) return;
    setDomainDetailLoading(true);
    try {
      const res = await fetch(`/api/domains/${selectedDomainId}`);
      const data = await res.json();
      if (data.ok && data.domain) {
        setDomainDetail(data.domain as DomainDetail);
      }
    } catch (e) {
      console.warn("[Teach] Failed to fetch domain detail:", e);
    } finally {
      setDomainDetailLoading(false);
    }
  }, [selectedDomainId]);

  // Fetch teaching points for selected domain (via domain's content sources)
  const fetchTeachingPoints = useCallback(async () => {
    if (!selectedDomainId) return;
    setTeachingPointsLoading(true);
    try {
      // Get domain's sources through subjects
      const domRes = await fetch(`/api/domains/${selectedDomainId}`);
      const domData = await domRes.json();
      if (!domData.ok) { setTeachingPointsLoading(false); return; }

      const subjects = domData.domain?.subjects || [];
      const sourceIds: string[] = [];
      for (const s of subjects) {
        for (const src of s.subject?.sources || []) {
          if (src.source?.id) sourceIds.push(src.source.id);
        }
      }

      if (sourceIds.length === 0) { setTeachingPointsLoading(false); return; }

      // Fetch assertions from first source (demo)
      const aRes = await fetch(`/api/content-sources/${sourceIds[0]}/assertions?limit=50`);
      const aData = await aRes.json();
      if (aData.ok) {
        setTeachingPoints(
          (aData.assertions || []).map((a: any) => ({
            id: a.id,
            text: a.text || a.assertion,
            type: a.assertionType || a.category || "FACT",
            reviewed: !!a.reviewedAt,
          }))
        );
      }
    } catch (e) {
      console.warn("[Teach] Failed to fetch teaching points:", e);
    } finally {
      setTeachingPointsLoading(false);
    }
  }, [selectedDomainId]);

  const handleToggleOnboarding = useCallback(() => {
    const willExpand = !onboardingExpanded;
    setOnboardingExpanded(willExpand);
    if (willExpand && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [onboardingExpanded, domainDetail, domainDetailLoading, fetchDomainDetail]);

  const handleToggleTeachingPoints = useCallback(() => {
    const willExpand = !teachingPointsExpanded;
    setTeachingPointsExpanded(willExpand);
    if (willExpand && teachingPoints.length === 0 && !teachingPointsLoading) {
      fetchTeachingPoints();
    }
  }, [teachingPointsExpanded, teachingPoints.length, teachingPointsLoading, fetchTeachingPoints]);

  const handleToggleTunePersona = useCallback(() => {
    const willExpand = !tunePersonaExpanded;
    setTunePersonaExpanded(willExpand);
    if (willExpand && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [tunePersonaExpanded, domainDetail, domainDetailLoading, fetchDomainDetail]);

  // Save persona tuning changes to domain
  const handlePersonaTuningChange = useCallback(async (output: AgentTuningPanelOutput) => {
    if (!selectedDomainId) return;
    setSavingPersona(true);
    try {
      const targets: Record<string, any> = {};
      for (const [paramId, value] of Object.entries(output.parameterMap)) {
        targets[paramId] = { value, confidence: 0.5 };
      }
      targets._matrixPositions = output.matrixPositions;
      targets._traits = output.traits;
      await fetch(`/api/domains/${selectedDomainId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingDefaultTargets: targets }),
      });
    } catch (e) {
      console.warn("[Teach] Failed to save persona tuning:", e);
    } finally {
      setSavingPersona(false);
    }
  }, [selectedDomainId]);

  // ── Render ────────────────────────────────────────

  return (
    <div className="dtw-page">
      {/* ── Header ── */}
      <div className="dtw-hero">
        <div className="dtw-hero-icon">
          <span>{config.headerEmoji}</span>
        </div>
        <h1 className="dtw-hero-title">
          {config.headerTitle}
        </h1>
        <p className="dtw-hero-subtitle">
          {config.fallbackSteps[currentStep]?.label ||
            `Prepare and launch a live ${t.session.toLowerCase()}.`}
        </p>
      </div>

      {/* ── Progress Stepper ── */}
      <div className="dtw-stepper">
        <ProgressStepper
          steps={(state?.steps ?? config.fallbackSteps).map((s, i) => ({
            label: s.label,
            completed: i < currentStep,
            active: i === currentStep,
            onClick: i < currentStep ? () => setStep(i) : undefined,
          }))}
        />
      </div>

      {/* ── Error banner ── */}
      {wizardError && (
        <div className="hf-banner hf-banner-error dtw-error-banner">
          <span>{wizardError}</span>
          <button
            onClick={clearWizardError}
            className="dtw-error-dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 0: Select Domain & Caller                  */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 0 && (
        <div className="dtw-section">
          <div className="dtw-section-label">{t.domain}</div>
          {loadingDomains ? (
            <div className="dtw-muted-text">
              Loading {t.domain.toLowerCase()}s...
            </div>
          ) : domainOptions.length === 0 ? (
            <div className="dtw-muted-text">
              No {t.domain.toLowerCase()}s found.{" "}
              <span
                className="dtw-inline-link"
                onClick={() => router.push("/x/quick-launch")}
              >
                Create one with Community
              </span>
            </div>
          ) : (
            <FancySelect
              value={selectedDomainId}
              onChange={setSelectedDomainId}
              options={domainOptions}
              placeholder={`Select ${
                t.domain.match(/^[aeiou]/i) ? "an" : "a"
              } ${t.domain.toLowerCase()}...`}
              searchable={domainOptions.length > 5}
            />
          )}

          {/* Caller selector (only when caller required upfront) */}
          {needsCallerUpfront && selectedDomainId && callerOptions.length > 0 && (
            <div className="dtw-caller-section">
              <div className="dtw-section-label">
                {callerOptions.length > 1
                  ? `Test ${t.caller}`
                  : t.caller}
              </div>
              {callerOptions.length === 1 ? (
                <div className="dtw-single-caller">
                  {callerOptions[0].label}
                </div>
              ) : (
                <FancySelect
                  value={selectedCallerId}
                  onChange={setSelectedCallerId}
                  options={callerOptions}
                  placeholder={`Select a ${t.caller.toLowerCase()}...`}
                  searchable={callerOptions.length > 5}
                />
              )}
            </div>
          )}

          {/* Zero-callers warning (only when caller required upfront) */}
          {needsCallerUpfront &&
            selectedDomainId &&
            !loadingDomains &&
            callerOptions.length === 0 && (
              <div className="dtw-warning-box">
                <div className="dtw-warning-title">
                  No learners found
                </div>
                <div className="dtw-warning-body">
                  This {t.domain.toLowerCase()} has no{" "}
                  {t.caller.toLowerCase()}s yet.{" "}
                  <span
                    className="dtw-inline-link"
                    onClick={() =>
                      router.push(
                        `/x/domains?id=${selectedDomainId}`,
                      )
                    }
                  >
                    Add a learner on the {t.domain} page
                  </span>
                </div>
              </div>
            )}

          {/* Step navigation */}
          <div className="dtw-nav">
            <button
              onClick={canAdvanceFromDomain ? handleNext : undefined}
              disabled={!canAdvanceFromDomain}
              className={`dtw-btn-next ${canAdvanceFromDomain ? "dtw-btn-next-enabled" : "dtw-btn-next-disabled"}`}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 1: Set Your Goal                           */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 1 && (
        <div className="dtw-section">
          <div className="dtw-section-label">Session Goal</div>
          <textarea
            className="dtw-textarea"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder={`What do you want to ${config.headerTitle.toLowerCase()}? e.g., Teach ${t.caller.toLowerCase()} about fractions using real-world examples`}
            rows={3}
            onBlur={() => {
              if (goalText.trim()) {
                fetchSuggestions(goalText.trim());
              }
            }}
          />

          {/* AI suggestions */}
          {(loadingSuggestions || suggestions.length > 0) && (
            <div className="dtw-suggestions">
              <div className="dtw-suggestions-label">
                Suggested goals
              </div>
              {loadingSuggestions ? (
                <div className="dtw-skeleton-row">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="dtw-skeleton-pill"
                      style={{ width: 120 + i * 20 }}
                    />
                  ))}
                </div>
              ) : (
                <div className="dtw-suggestion-list">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setGoalText(s)}
                      className="dtw-suggestion-chip"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Save as Goal button (only when caller exists upfront) */}
          {needsCallerUpfront && goalText.trim() && (
            <div className="dtw-save-goal-row">
              <button
                onClick={handleSaveAsGoal}
                disabled={savingGoal}
                className={`dtw-btn-save-goal ${savingGoal ? "dtw-btn-save-goal-saving" : ""}`}
              >
                <Plus size={14} />
                {savingGoal ? "Saving..." : "Save as Goal"}
              </button>
            </div>
          )}

          {/* ── Caller Goals (CRUD) — only when caller exists upfront ── */}
          {needsCallerUpfront && (callerGoals.length > 0 || loadingGoals) && (
            <div className="dtw-goals-section">
              <div className="dtw-goals-label">
                {t.caller}&apos;s Goals
              </div>
              {loadingGoals ? (
                <div className="dtw-goals-loading">
                  Loading goals...
                </div>
              ) : (
                <div className="dtw-goals-list">
                  {callerGoals.map((goal) => (
                    <div
                      key={goal.id}
                      className={`dtw-goal-row ${goalText === goal.name ? "dtw-goal-row-selected" : "dtw-goal-row-default"} ${editingGoalId === goal.id ? "dtw-goal-row-editing" : ""}`}
                      onClick={() => {
                        if (editingGoalId !== goal.id) {
                          setGoalText(goal.name);
                        }
                      }}
                    >
                      {/* Type emoji */}
                      <span className="dtw-goal-emoji">
                        {GOAL_TYPE_EMOJI[goal.type] || "\uD83C\uDFAF"}
                      </span>

                      {/* Name (inline edit or display) */}
                      {editingGoalId === goal.id ? (
                        <input
                          className="dtw-goal-edit-input"
                          value={editGoalName}
                          onChange={(e) => setEditGoalName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleUpdateGoal(goal.id);
                            if (e.key === "Escape") {
                              setEditingGoalId(null);
                              setEditGoalName("");
                            }
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="dtw-goal-name">
                          {goal.name}
                        </span>
                      )}

                      {/* Progress bar */}
                      {goal.progress > 0 && editingGoalId !== goal.id && (
                        <div className="dtw-goal-progress-track">
                          <div
                            className="dtw-goal-progress-fill"
                            style={{ width: `${goal.progress * 100}%` }}
                          />
                        </div>
                      )}

                      {/* Action buttons */}
                      {editingGoalId === goal.id ? (
                        <div
                          className="dtw-goal-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleUpdateGoal(goal.id)}
                            className="dtw-icon-btn dtw-icon-btn-success"
                            title="Save"
                          >
                            <Save size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingGoalId(null);
                              setEditGoalName("");
                            }}
                            className="dtw-icon-btn dtw-icon-btn-muted"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="dtw-goal-actions dtw-goal-actions-view"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setEditingGoalId(goal.id);
                              setEditGoalName(goal.name);
                            }}
                            className="dtw-icon-btn dtw-icon-btn-muted"
                            title="Edit goal"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteGoal(goal.id)}
                            className="dtw-icon-btn dtw-icon-btn-error"
                            title="Delete goal"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step navigation */}
          <div className="dtw-nav-between">
            <button onClick={handlePrev} className="dtw-btn-back">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={canAdvanceFromGoal ? handleNext : undefined}
              disabled={!canAdvanceFromGoal}
              className={`dtw-btn-next ${canAdvanceFromGoal ? "dtw-btn-next-enabled" : "dtw-btn-next-disabled"}`}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 2: Upload Content                           */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 2 && selectedDomainId && (
        <div className="dtw-section">
          <div className="dtw-section-label">Content</div>

          {/* Loading state */}
          {contentPhase === "loading" && (
            <div className="dtw-muted-text">Checking content...</div>
          )}

          {/* Content exists — summary */}
          {contentPhase === "has-content" && (
            <div className="dtw-content-summary">
              <div className="dtw-content-summary-icon"><CheckCircle2 size={20} /></div>
              <div className="dtw-content-summary-text">
                <div className="dtw-content-summary-title">Content Ready</div>
                <div className="dtw-content-summary-detail">
                  {contentCount} teaching point{contentCount !== 1 ? "s" : ""} extracted
                </div>
              </div>
            </div>
          )}

          {/* No content — select existing or upload new */}
          {(contentPhase === "no-content" || contentPhase === "error") && (
            <>
              {/* Mode toggle (only when existing sources available) */}
              {availableSources.length > 0 && (
                <div className="dtw-content-mode-toggle">
                  <button
                    className={`dtw-content-mode-tab ${contentMode === "select" ? "dtw-content-mode-tab--active" : ""}`}
                    onClick={() => setContentMode("select")}
                  >
                    <Library size={16} />
                    Select Existing
                  </button>
                  <button
                    className={`dtw-content-mode-tab ${contentMode === "upload" ? "dtw-content-mode-tab--active" : ""}`}
                    onClick={() => setContentMode("upload")}
                  >
                    <Upload size={16} />
                    Upload New
                  </button>
                </div>
              )}

              {/* SELECT EXISTING mode */}
              {contentMode === "select" && availableSources.length > 0 && (
                <div className="dtw-source-library">
                  {loadingSources ? (
                    <div className="dtw-muted-text">Loading content library...</div>
                  ) : (
                    <div className="dtw-source-list">
                      {availableSources.map((source) => {
                        const isSelected = selectedSourceId === source.id;
                        const linkedToDomain = source.subjects.some((ss) =>
                          ss.subject.domains.some((sd) => sd.domain.id === selectedDomainId)
                        );
                        return (
                          <button
                            key={source.id}
                            className={`dtw-source-card ${isSelected ? "dtw-source-card--selected" : ""} ${linkedToDomain ? "dtw-source-card--linked" : ""}`}
                            onClick={() => setSelectedSourceId(isSelected ? null : source.id)}
                          >
                            <div className="dtw-source-card-name">
                              {source.name}
                              {linkedToDomain && (
                                <span className="dtw-source-card-linked-badge">Already linked</span>
                              )}
                            </div>
                            <span className="dtw-source-card-pill">
                              {source._count.assertions} teaching point{source._count.assertions !== 1 ? "s" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* UPLOAD NEW mode (or fallback when no sources exist) */}
              {(contentMode === "upload" || availableSources.length === 0) && (
                <>
                  <div
                    className={`dtw-dropzone ${uploadDragOver ? "dtw-dropzone--active" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true); }}
                    onDragLeave={() => setUploadDragOver(false)}
                    onDrop={handleUploadDrop}
                    onClick={() => uploadFileRef.current?.click()}
                  >
                    <div className="dtw-dropzone-icon">
                      {uploadFile ? <FileText size={32} /> : <Upload size={32} />}
                    </div>
                    {uploadFile ? (
                      <div className="dtw-dropzone-filename">{uploadFile.name}</div>
                    ) : (
                      <>
                        <div className="dtw-dropzone-filename">
                          Drop a file here or click to browse
                        </div>
                        <div className="dtw-dropzone-hint">
                          PDF, TXT, MD, or JSON
                        </div>
                      </>
                    )}
                  </div>
                  <input
                    ref={uploadFileRef}
                    type="file"
                    className="dtw-file-input-hidden"
                    accept=".pdf,.txt,.md,.markdown,.json"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleUploadFile(e.target.files[0]);
                    }}
                  />
                </>
              )}

              {uploadError && (
                <div className="dtw-upload-error">{uploadError}</div>
              )}

              {/* Action buttons */}
              <div className="dtw-upload-actions">
                <button className="dtw-btn-skip" onClick={handleNext}>
                  Skip for now
                </button>
                {contentMode === "select" && selectedSourceId ? (
                  <button
                    className="dtw-btn-upload"
                    onClick={() => handleSelectExistingSource(selectedSourceId)}
                  >
                    Use Selected Content
                  </button>
                ) : contentMode === "upload" || availableSources.length === 0 ? (
                  <button
                    className="dtw-btn-upload"
                    disabled={!uploadFile}
                    onClick={handleStartUpload}
                  >
                    Upload &amp; Extract
                  </button>
                ) : null}
              </div>
            </>
          )}

          {/* Attaching existing source */}
          {contentPhase === "attaching-source" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Linking content source...</div>
              </div>
              <div className="dtw-progress-track">
                <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
              </div>
            </div>
          )}

          {/* Uploading */}
          {contentPhase === "uploading" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Uploading...</div>
              </div>
              <div className="dtw-progress-track">
                <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
              </div>
            </div>
          )}

          {/* Extracting */}
          {contentPhase === "extracting" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Extracting teaching points...</div>
                <div className="dtw-extract-elapsed">{extractElapsed}s</div>
              </div>
              <div className="dtw-progress-track">
                <div
                  className="dtw-progress-fill"
                  style={{
                    width: extractProgress.total > 0
                      ? `${Math.round((extractProgress.current / extractProgress.total) * 100)}%`
                      : undefined,
                  }}
                />
              </div>
              <div className="dtw-progress-labels">
                <span>{extractProgress.extracted} extracted</span>
                {extractProgress.total > 0 && (
                  <span>Chunk {extractProgress.current}/{extractProgress.total}</span>
                )}
              </div>
            </div>
          )}

          {/* Generating curriculum */}
          {contentPhase === "generating-curriculum" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Generating curriculum...</div>
              </div>
              <div className="dtw-progress-track">
                <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
              </div>
              <div className="dtw-progress-labels">
                <span>{contentCount} teaching points extracted</span>
                <span>Building modules</span>
              </div>
            </div>
          )}

          {/* Composing prompt */}
          {contentPhase === "composing-prompt" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Preparing your tutor...</div>
              </div>
              <div className="dtw-progress-track">
                <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
              </div>
              <div className="dtw-progress-labels">
                <span>{contentCount} teaching points</span>
                <span>Composing prompt</span>
              </div>
            </div>
          )}

          {/* Done */}
          {contentPhase === "done" && (
            <div className="dtw-content-summary">
              <div className="dtw-content-summary-icon"><CheckCircle2 size={20} /></div>
              <div className="dtw-content-summary-text">
                <div className="dtw-content-summary-title">
                  {autoWireResult ? "Content Ready" : "Extraction Complete"}
                </div>
                <div className="dtw-content-summary-detail">
                  {autoWireResult ? (
                    <>
                      {autoWireResult.moduleCount > 0
                        ? `${autoWireResult.moduleCount} module${autoWireResult.moduleCount !== 1 ? "s" : ""}, ${contentCount} teaching point${contentCount !== 1 ? "s" : ""} ready`
                        : `${contentCount} teaching point${contentCount !== 1 ? "s" : ""} extracted`}
                      {autoWireResult.promptComposed && " — tutor updated"}
                    </>
                  ) : (
                    <>{contentCount} teaching point{contentCount !== 1 ? "s" : ""} extracted from {uploadFile?.name}</>
                  )}
                </div>
                {autoWireResult?.warnings && autoWireResult.warnings.length > 0 && (
                  <div className="dtw-content-summary-detail" style={{ color: "var(--status-warning-text)", marginTop: 4, fontSize: 12 }}>
                    {autoWireResult.warnings.join("; ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step navigation */}
          {contentPhase !== "uploading" && contentPhase !== "extracting" && contentPhase !== "generating-curriculum" && contentPhase !== "composing-prompt" && contentPhase !== "attaching-source" && contentPhase !== "loading" && (
            <div className="dtw-nav-between" style={{ marginTop: 20 }}>
              <button onClick={handlePrev} className="dtw-btn-back">
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={handleNext}
                className={`dtw-btn-next ${contentPhase === "has-content" || contentPhase === "done" ? "dtw-btn-next-enabled" : "dtw-btn-next-enabled"}`}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 3: Readiness Checks                        */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 3 && selectedDomainId && (
        <div className={`dtw-section ${level === "ready" ? "dtw-section-ready" : ""}`}>
          {/* Status badge */}
          <div className="dtw-readiness-header">
            <div className="dtw-section-label">Course Readiness</div>
            <div className="dtw-readiness-badges">
              <div
                className="dtw-readiness-level-badge"
                style={{
                  color: levelColor,
                  background: `color-mix(in srgb, ${levelColor} 12%, transparent)`,
                }}
              >
                {levelLabel}
              </div>
              <div className="dtw-readiness-score">
                {score}%
              </div>
            </div>
          </div>

          {/* Check items */}
          {checksLoading && checks.length === 0 ? (
            <div className="dtw-muted-text">
              Loading checks...
            </div>
          ) : checks.length === 0 ? (
            <div className="dtw-muted-text">
              No readiness checks configured.
            </div>
          ) : (
            <div className="dtw-checks-list">
              {checks.map((check) => (
                <div
                  key={check.id}
                  className={`dtw-check-row ${check.passed ? "dtw-check-row-pass" : "dtw-check-row-pending"} ${check.fixAction?.href ? "dtw-check-row-clickable" : ""}`}
                  onClick={() => {
                    if (check.fixAction?.href)
                      router.push(check.fixAction.href);
                  }}
                >
                  <div
                    className={`dtw-check-circle ${check.passed ? "dtw-check-circle-pass" : check.severity === "critical" ? "dtw-check-circle-critical" : "dtw-check-circle-default"}`}
                  >
                    {check.passed
                      ? "\u2713"
                      : check.severity === "critical"
                        ? "!"
                        : "\u2022"}
                  </div>
                  <div className="dtw-check-content">
                    <div className="dtw-check-name">
                      {check.name}
                      {check.severity === "critical" && !check.passed && (
                        <span className="dtw-check-required">
                          REQUIRED
                        </span>
                      )}
                    </div>
                    <div className="dtw-check-detail">
                      {check.detail}
                    </div>
                  </div>
                  {check.fixAction?.href && (
                    <div className="dtw-check-fix">
                      {check.fixAction.label} &rarr;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step navigation */}
          {(() => {
            // When no caller upfront, allow advancing even if not fully ready
            // (caller-related checks will pass after auto-creation at launch)
            const canAdvanceReadiness = ready || !needsCallerUpfront;
            return (
              <div className="dtw-nav-between">
                <button onClick={handlePrev} className="dtw-btn-back">
                  <ChevronLeft size={16} /> Back
                </button>
                <button
                  onClick={canAdvanceReadiness ? handleNext : undefined}
                  disabled={!canAdvanceReadiness}
                  className={`dtw-btn-next ${canAdvanceReadiness ? "dtw-btn-next-enabled" : "dtw-btn-next-disabled"}`}
                  title={
                    !canAdvanceReadiness ? "Complete required checks above first" : undefined
                  }
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 4: Preview First Prompt                    */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 4 && selectedDomainId && (
        <div className="dtw-section">
          <div className="dtw-section-label">First Prompt Preview</div>
          <PromptPreviewContent
            domainId={selectedDomainId}
            domainName={selectedDomain?.name}
            callerId={selectedCallerId || undefined}
            open={currentStep === 4}
          />

          {/* Step navigation */}
          <div className="dtw-nav-between" style={{ marginTop: 24 }}>
            <button onClick={handlePrev} className="dtw-btn-back">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handleNext}
              className="dtw-btn-next dtw-btn-next-enabled"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 5: Launch                                  */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 5 && (
        <div className="dtw-section">
          <WizardSummary
            title={launching ? "Launching..." : "Ready to Go!"}
            subtitle={
              launching
                ? ({
                    idle: "Preparing...",
                    scaffolding: "Setting up course infrastructure...",
                    "creating-caller": "Creating test learner...",
                    "creating-goals": "Setting learning goals...",
                    "composing-prompt": "Preparing your tutor...",
                    redirecting: "Opening simulator...",
                  }[launchPhase])
                : ready
                  ? `All checks passed. Start your ${t.session.toLowerCase()}.`
                  : needsCallerUpfront
                    ? `${levelLabel} — ${score}% readiness`
                    : `Start your ${t.session.toLowerCase()} — a test learner will be created automatically.`
            }
            intent={{
              items: [
                {
                  icon: <Building2 className="w-4 h-4" />,
                  label: t.domain,
                  value: selectedDomain?.name || "—",
                },
                ...(needsCallerUpfront
                  ? [{
                      icon: <User className="w-4 h-4" />,
                      label: t.caller,
                      value: callers.find((c) => c.id === selectedCallerId)?.name || "—",
                    }]
                  : [{
                      icon: <User className="w-4 h-4" />,
                      label: "Test Learner",
                      value: "Created automatically at launch",
                    }]),
                ...(goalText
                  ? [
                      {
                        icon: <Target className="w-4 h-4" />,
                        label: "Goal",
                        value: goalText,
                      },
                    ]
                  : []),
              ],
            }}
            stats={[{ label: "Readiness", value: `${score}%` }]}
            primaryAction={{
              label: launching
                ? ({
                    idle: `Start ${t.session}`,
                    scaffolding: "Setting up...",
                    "creating-caller": "Creating learner...",
                    "creating-goals": "Setting goals...",
                    "composing-prompt": "Preparing tutor...",
                    redirecting: "Launching...",
                  }[launchPhase])
                : `Start ${t.session}`,
              icon: launching
                ? <div className="hf-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                : <PlayCircle className="w-5 h-5" />,
              onClick: handleStartLesson,
              disabled: launching || (needsCallerUpfront ? (!ready || !selectedCallerId) : !selectedDomainId),
            }}
            secondaryActions={[
              ...(selectedDomainId
                ? [
                    {
                      label: `View ${t.domain}`,
                      href: `/x/domains?id=${selectedDomainId}`,
                    },
                  ]
                : []),
              ...(needsCallerUpfront && selectedCallerId
                ? [
                    {
                      label: `View ${t.caller}`,
                      href: `/x/callers/${selectedCallerId}`,
                    },
                  ]
                : []),
            ]}
            onBack={handlePrev}
          />

          {/* ── Teaching Points (expandable) ── */}
          <div className="dtw-accordion-card">
            <button onClick={handleToggleTeachingPoints} className="dtw-accordion-toggle">
              {teachingPointsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Review Teaching Points</span>
              {teachingPointsLoading && (
                <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              )}
              {teachingPoints.length > 0 && (
                <span className="dtw-accordion-badge">{teachingPoints.length}</span>
              )}
            </button>
            {teachingPointsExpanded && (
              <div className="dtw-accordion-content">
                {teachingPointsLoading ? (
                  <div className="hf-flex hf-gap-sm" style={{ justifyContent: "center", padding: 24 }}>
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading teaching points...</span>
                  </div>
                ) : teachingPoints.length === 0 ? (
                  <div className="hf-text-sm hf-text-muted" style={{ padding: 16, textAlign: "center" }}>
                    No teaching points found. Upload content to extract key facts and concepts.
                  </div>
                ) : (
                  <div className="dtw-teaching-points">
                    {teachingPoints.map((point) => (
                      <div key={point.id} className="dtw-teaching-point">
                        <div className={`dtw-tp-indicator ${point.reviewed ? "dtw-tp-reviewed" : "dtw-tp-pending"}`}>
                          {point.reviewed ? "\u2713" : "\u2022"}
                        </div>
                        <div className="dtw-tp-text">{point.text}</div>
                        <span className="dtw-tp-type">{point.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Tune Persona (Boston Matrix) ── */}
          <div className="dtw-accordion-card">
            <button onClick={handleToggleTunePersona} className="dtw-accordion-toggle">
              {tunePersonaExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Tune Persona</span>
              {savingPersona && (
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>&mdash; saving...</span>
              )}
            </button>
            {tunePersonaExpanded && (
              <div className="dtw-accordion-content">
                {domainDetailLoading && !domainDetail ? (
                  <div className="hf-flex hf-gap-sm" style={{ justifyContent: "center", padding: 24 }}>
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading persona settings...</span>
                  </div>
                ) : (
                  <AgentTuningPanel
                    initialPositions={
                      (domainDetail?.onboardingDefaultTargets as any)?._matrixPositions
                    }
                    existingParams={
                      domainDetail?.onboardingDefaultTargets
                        ? Object.fromEntries(
                            Object.entries(domainDetail.onboardingDefaultTargets as Record<string, any>)
                              .filter(([k]) => !k.startsWith("_"))
                              .map(([k, v]) => [k, typeof v === "object" && v !== null ? (v as any).value : v])
                          )
                        : undefined
                    }
                    onChange={handlePersonaTuningChange}
                    compact
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Customise Onboarding (expandable) ── */}
          <div className="dtw-accordion-card">
            <button onClick={handleToggleOnboarding} className="dtw-accordion-toggle">
              {onboardingExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Customise Onboarding</span>
              {domainDetailLoading && !domainDetail && (
                <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              )}
            </button>
            {onboardingExpanded && (
              <div className="dtw-accordion-content">
                {domainDetailLoading && !domainDetail ? (
                  <div className="hf-flex hf-gap-sm" style={{ justifyContent: "center", padding: 24 }}>
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading configuration...</span>
                  </div>
                ) : domainDetail ? (
                  <OnboardingTabContent
                    domain={domainDetail}
                    onDomainRefresh={fetchDomainDetail}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Quick actions (visible on all steps) ── */}
      {selectedDomainId && (
        <div className="dtw-quick-actions">
          <button
            onClick={() => {
              router.push(`/x/domains?id=${selectedDomainId}`);
            }}
            className="dtw-btn-quick"
          >
            View {t.domain}
          </button>
          {selectedCallerId && (
            <button
              onClick={() => {
                router.push(`/x/callers/${selectedCallerId}`);
              }}
              className="dtw-btn-quick"
            >
              View {t.caller}
            </button>
          )}
          <button
            onClick={() => {
              router.push("/x/quick-launch");
            }}
            className="dtw-btn-quick"
          >
            Community
          </button>
        </div>
      )}
    </div>
  );
}
