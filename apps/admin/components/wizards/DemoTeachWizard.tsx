"use client";

/**
 * DemoTeachWizard — shared wizard for Demonstrate (4-step) and Teach (5-step) flows.
 *
 * Config-driven: the page wrapper passes a DemoTeachConfig that controls
 * flowId, labels, API filters, and terminology. All state, effects, and
 * rendering live here — the pages are thin wrappers.
 *
 * Steps: Select Institution [& Caller] → Set Your Goal → Add Content → [Plan Sessions (Teach only)] → Launch
 *
 * Preview First Prompt is an accordion within the Launch step, not a standalone step.
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
  RotateCcw,
} from "lucide-react";
import { PromptPreviewContent } from "@/app/x/domains/components/PromptPreviewModal";
import { OnboardingTabContent } from "@/app/x/domains/components/OnboardingTab";
import type { DomainDetail } from "@/app/x/domains/components/types";
import { AgentTuningPanel, type AgentTuningPanelOutput } from "@/components/shared/AgentTuningPanel";
import { AgentTuner } from "@/components/shared/AgentTuner";
import type { AgentTunerOutput, AgentTunerPill } from "@/lib/agent-tuner/types";
import type { MatrixPosition } from "@/lib/domain/agent-tuning";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { useWizardError } from "@/hooks/useWizardError";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { TeachPlanStep } from "@/components/wizards/TeachPlanStep";
import { CreateInstitutionModal } from "./CreateInstitutionModal";
import { archetypeToTeachingStyle } from "@/lib/institution-types/sector-config";
import { PackUploadStep } from "./PackUploadStep";
import type { PackUploadResult } from "./PackUploadStep";
import { POLL_TIMEOUT_MS, WIRING_FETCH_TIMEOUT_MS } from "@/lib/tasks/constants";
import { useTaskPoll } from "@/hooks/useTaskPoll";
import { useSession } from "next-auth/react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
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
  institution?: {
    type?: { slug: string; name: string; defaultArchetypeSlug?: string | null } | null;
  } | null;
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

type PersonaInfo = {
  slug: string;
  name: string;
  description: string | null;
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

// API response shapes (for typed .filter/.map/.reduce on untyped JSON)
type ApiWizardStep = { id: string; label: string; activeLabel?: string };
type ApiCaller = { id: string; name?: string; email?: string; domainId: string };
type ApiPlaybook = { id: string; name: string; status: string; config?: { teachingMode?: string } };
type ApiSubjectSource = { source?: { _count?: { assertions?: number } } };
type ApiSubjectDomain = { subject?: { id?: string; name?: string; sources?: ApiSubjectSource[] } };

const GOAL_TYPE_EMOJI: Record<string, string> = {
  LEARN: "\uD83D\uDCDA",
  ACHIEVE: "\uD83C\uDFC6",
  CHANGE: "\uD83D\uDD04",
  CONNECT: "\uD83E\uDD1D",
  SUPPORT: "\uD83D\uDCAA",
  CREATE: "\uD83C\uDFA8",
};

const FALLBACK_PERSONAS: PersonaInfo[] = [
  { slug: "tutor", name: "Tutor", description: "Patient, structured teaching" },
  { slug: "coach", name: "Coach", description: "Goal-driven, motivational" },
  { slug: "socratic", name: "Socratic", description: "Questioning and discovery" },
];

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
  const { data: sessionData } = useSession();
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

  // ── Step indices (teach flow has an extra "Plan Sessions" step at index 3) ──
  const isTeachFlow = config.flowId === "teach";
  const STEP_PLAN = isTeachFlow ? 3 : -1; // -1 = doesn't exist for demonstrate
  const STEP_LAUNCH = isTeachFlow ? 4 : 3;

  // ── State ──────────────────────────────────────────

  // Domain selector
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [domainOptions, setDomainOptions] = useState<FancySelectOption[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const canCreateInstitution = ["OPERATOR", "ADMIN", "SUPERADMIN"].includes(
    (sessionData?.user as { role?: string })?.role || "",
  );

  // Caller for selected domain
  const [callers, setCallers] = useState<CallerInfo[]>([]);
  const [selectedCallerId, setSelectedCallerId] = useState("");
  const [callerOptions, setCallerOptions] = useState<FancySelectOption[]>([]);

  // Goal text
  const [goalText, setGoalText] = useState("");

  // Persona selector (Teach flow only)
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [selectedPersona, setSelectedPersona] = useState("");

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
  const [suggestionsError, setSuggestionsError] = useState(false);
  const lastSuggestText = useRef("");
  const suggestFetchId = useRef(0);

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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState({ current: 0, total: 0, extracted: 0 });
  const [extractElapsed, setExtractElapsed] = useState(0);
  const [quickPreview, setQuickPreview] = useState<Array<{ text: string; category: string }>>([]);
  const [extractionTaskId, setExtractionTaskId] = useState<string | null>(null);

  // Content source selection (existing sources)
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Track sourceId/subjectId created during upload/select for readiness link resolution
  const [createdSourceId, setCreatedSourceId] = useState<string | null>(null);
  const [createdSubjectId, setCreatedSubjectId] = useState<string | null>(null);

  // Pack upload — existing courses for the selected domain
  type ExistingCourseInfo = { id: string; name: string; status: string; subjectCount: number; assertionCount: number; teachingMode?: string };
  const [existingCourses, setExistingCourses] = useState<ExistingCourseInfo[]>([]);

  // Subject picker — subjects with content for the selected domain (Teach flow)
  type ExistingSubjectInfo = { id: string; name: string; sourceCount: number; assertionCount: number };
  const [existingSubjects, setExistingSubjects] = useState<ExistingSubjectInfo[]>([]);

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
  const [teachingPoints, setTeachingPoints] = useState<Array<{ id: string; text: string; type: string; reviewed: boolean; chapter?: string }>>([]);
  const [teachingPointsLoading, setTeachingPointsLoading] = useState(false);
  const [tunePersonaExpanded, setTunePersonaExpanded] = useState(false);
  const [promptPreviewExpanded, setPromptPreviewExpanded] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);

  // Greeting preview + call flow phases (fetched from /api/onboarding)
  const [welcomeTemplate, setWelcomeTemplate] = useState("");
  const [customWelcome, setCustomWelcome] = useState("");
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [loadingGreeting, setLoadingGreeting] = useState(false);
  type FlowPhase = { phase: string; duration: string; priority?: string; goals: string[]; avoid?: string[] };
  const [flowPhases, setFlowPhases] = useState<FlowPhase[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);

  // Agent tuning (Boston Matrix + behavior pills)
  const [tunerPills, setTunerPills] = useState<AgentTunerPill[]>([]);
  const [behaviorTargets, setBehaviorTargets] = useState<Record<string, number>>({});
  const [matrixTargets, setMatrixTargets] = useState<Record<string, number>>({});
  const [matrixTraits, setMatrixTraits] = useState<string[]>([]);
  const [matrixPositions, setMatrixPositions] = useState<Record<string, MatrixPosition>>({});

  // Launch-time caller creation (when requireCallerUpfront === false)
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState<string>("");

  // Curriculum generation tracking (parent-level, survives step transitions)

  // Convenience flag
  const needsCallerUpfront = config.requireCallerUpfront !== false;

  // Warn on browser refresh/close when user has started filling in data
  useUnsavedGuard(goalText.trim().length > 0 || !!selectedDomainId);

  // Derived: launching is true when a launch task is in progress
  const launching = launchTaskId !== null;

  // ── Extraction polling via useTaskPoll ──────────────
  useTaskPoll({
    taskId: extractionTaskId,
    intervalMs: 2000,
    onProgress: (task) => {
      const ctx = task.context || {};
      setExtractProgress({
        current: ctx.currentChunk || 0,
        total: ctx.totalChunks || 0,
        extracted: ctx.extractedCount || 0,
      });
      if (ctx.quickPreview?.length > 0) {
        setQuickPreview((prev) => prev.length === 0 ? ctx.quickPreview : prev);
      }
    },
    onComplete: (task) => {
      const ctx = task.context || {};
      setExtractionTaskId(null);
      setQuickPreview([]);
      const count = ctx.importedCount || ctx.extractedCount || 0;
      setContentCount(count);
      runPostExtractionWiring(count);
    },
    onError: (msg) => {
      setExtractionTaskId(null);
      setUploadError(msg);
      setContentPhase("error");
    },
  });

  // ── Launch polling via useTaskPoll ──────────────────
  useTaskPoll({
    taskId: launchTaskId,
    intervalMs: 2000,
    onProgress: (task) => {
      const ctx = task.context || {};
      if (ctx.progress) setLaunchMessage(ctx.progress);
    },
    onComplete: (task) => {
      const ctx = task.context || {};
      setLaunchTaskId(null);
      endFlow();
      const params = new URLSearchParams();
      if (selectedDomainId) params.set("domainId", selectedDomainId);
      const goal = goalText.trim();
      if (goal) params.set("goal", goal);
      if (ctx.playbookId) params.set("playbookId", ctx.playbookId);
      if (selectedPersona) params.set("persona", selectedPersona);
      const qs = params.toString();
      router.push(`/x/sim/${ctx.callerId}${qs ? `?${qs}` : ""}`);
    },
    onError: (msg) => {
      setLaunchTaskId(null);
      setLaunchMessage("");
      setWizardError(msg);
    },
  });

  // ── Start Over (reset wizard to step 0) ───────────

  const handleStartOver = useCallback(() => {
    endFlow();
    // Reset all local state
    setSelectedDomainId("");
    setSelectedCallerId("");
    setGoalText("");
    setChecks([]);
    setReady(false);
    setScore(0);
    setLevel("incomplete");
    setSuggestions([]);
    setSuggestionsError(false);
    setCallerGoals([]);
    setSelectedPersona(personas.length > 0 ? personas[0].slug : "");
    setContentPhase("loading");
    setContentCount(0);
    setUploadError(null);
    setAutoWireResult(null);
    setAvailableSources([]);
    setSelectedSourceId(null);
    setCreatedSourceId(null);
    setCreatedSubjectId(null);
    setContentMode("select");
    setOnboardingExpanded(false);
    setTeachingPointsExpanded(false);
    setTunePersonaExpanded(false);
    setPromptPreviewExpanded(false);
    setDomainDetail(null);
    setTeachingPoints([]);
    setLaunchTaskId(null);
    setLaunchMessage("");
    setExtractionTaskId(null);
    setExtractElapsed(0);
    setShowCreateModal(false);
    setTunerPills([]);
    setBehaviorTargets({});
    setMatrixTargets({});
    setMatrixTraits([]);
    setMatrixPositions({});
    clearWizardError();
    domainsFetchedRef.current = false; // Allow domain refetch on restart
    setLoadingDomains(true);
    // Re-start the flow fresh
    startFlow({
      flowId: config.flowId,
      steps: config.fallbackSteps,
      returnPath: config.returnPath,
    });
  }, [endFlow, startFlow, config, clearWizardError]);

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
          stepsToUse = data.steps.map((s: ApiWizardStep) => ({
            id: s.id,
            label: s.label,
            activeLabel: s.activeLabel,
          }));
        }
      } catch {
        // Silent — use hardcoded fallback
      }

      if (!isActive || state?.flowId !== config.flowId) {
        // Start fresh — either no active flow, or a different wizard's flow is active
        startFlow({
          flowId: config.flowId,
          steps: stepsToUse,
          returnPath: config.returnPath,
        });
      } else {
        // Returning from a fix-action page — restore state from matching flow
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
        const savedPersona = getData<string>("persona");
        if (savedPersona) setSelectedPersona(savedPersona);
        const savedPills = getData<AgentTunerPill[]>("tunerPills");
        if (savedPills) setTunerPills(savedPills);
        // (Curriculum task state restored by TeachPlanStep on step 3 mount)
      }
    };
    initFlow();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // (Curriculum polling handled by TeachPlanStep internally — user stays on step 3 until accepted)

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
  const domainsFetchedRef = useRef(false);

  useEffect(() => {
    if (domainsFetchedRef.current) return; // Already loaded — don't refetch on searchParams changes
    (async () => {
      try {
        const filter = config.domainApiFilter || "";
        const res = await fetch(`/api/domains${filter}`);
        const data = await res.json();
        if (data.ok) {
          domainsFetchedRef.current = true;
          const list: DomainInfo[] = data.domains || [];
          setDomains(list);
          setDomainOptions(
            list.map((d) => ({
              value: d.id,
              label: d.name,
              subtitle: d.slug,
              badge: d.institution?.type?.name || (d.isDefault ? "Default" : undefined),
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

  // ── Load personas on mount (Teach flow only) ──────
  useEffect(() => {
    if (!isTeachFlow) {
      setPersonasLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/onboarding/personas")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok && data.personas?.length > 0) {
          const list: PersonaInfo[] = data.personas.map(
            (p: { slug: string; name: string; description?: string | null }) => ({
              slug: p.slug,
              name: p.name,
              description: p.description ?? null,
            }),
          );
          setPersonas(list);
          setSelectedPersona(data.defaultPersona || list[0].slug);
        } else {
          // API returned no personas — use fallback
          setPersonas(FALLBACK_PERSONAS);
          setSelectedPersona(FALLBACK_PERSONAS[0].slug);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[Teach] Failed to load personas:", e);
        setPersonas(FALLBACK_PERSONAS);
        setSelectedPersona(FALLBACK_PERSONAS[0].slug);
      })
      .finally(() => {
        if (!cancelled) setPersonasLoading(false);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-fill persona from institution type when domain changes ──
  useEffect(() => {
    if (!isTeachFlow || !selectedDomainId || personas.length === 0) return;
    const dom = domains.find((d) => d.id === selectedDomainId);
    const archetype = dom?.institution?.type?.defaultArchetypeSlug;
    if (archetype) {
      const style = archetypeToTeachingStyle(archetype);
      // Only pre-fill if the matching persona exists in the loaded list
      const match = personas.find((p) => p.slug === style);
      if (match) setSelectedPersona(match.slug);
    }
  }, [selectedDomainId, domains, personas.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
            (c: ApiCaller) => c.domainId === selectedDomainId,
          );
          const list: CallerInfo[] = domainCallers.map((c: ApiCaller) => ({
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
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        console.warn(`[${config.headerTitle}] Failed to load callers:`, e);
      }
    })();
    return () => controller.abort();
  }, [selectedDomainId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch AI goal suggestions ─────────────────────

  const suggestAbortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(
    async (forceText?: string) => {
      if (!selectedDomainId) return;
      if (needsCallerUpfront && !selectedCallerId) return;
      const text = forceText ?? goalText;
      if (text === lastSuggestText.current && suggestions.length > 0) return;
      lastSuggestText.current = text;
      const thisId = ++suggestFetchId.current;

      // Abort any in-flight request
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 12_000); // 12s client safety net (server: 10s)

      setLoadingSuggestions(true);
      setSuggestionsError(false);
      try {
        const params = new URLSearchParams({ domainId: selectedDomainId });
        if (selectedCallerId) params.set("callerId", selectedCallerId);
        if (text) params.set("currentGoal", text);
        const res = await fetch(`/api/demonstrate/suggest?${params}`, { signal: controller.signal });
        const data = await res.json();
        // Only update state from the most recent request (prevents race conditions)
        if (suggestFetchId.current !== thisId) return;
        if (data.ok && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        } else {
          console.warn("[Teach] Suggest API returned:", data);
          setSuggestionsError(true);
        }
      } catch (e) {
        if (suggestFetchId.current !== thisId) return;
        if ((e as Error).name !== "AbortError") {
          console.warn("[Teach] Suggest API failed:", e);
        }
        setSuggestionsError(true);
      } finally {
        clearTimeout(timeout);
        // Only clear loading if this is still the latest request
        if (suggestFetchId.current === thisId) {
          setLoadingSuggestions(false);
        }
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

  // ── Agent tuning handlers ────────────────────────

  const handleTunerChange = useCallback(({ pills, parameterMap }: AgentTunerOutput) => {
    setTunerPills(pills);
    setBehaviorTargets(parameterMap);
  }, []);

  const handleMatrixChange = useCallback(({ parameterMap, traits, matrixPositions: mp }: AgentTuningPanelOutput) => {
    setMatrixTargets(parameterMap);
    setMatrixTraits(traits);
    setMatrixPositions(mp);
  }, []);

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
      if (createdSourceId) params.set("sourceId", createdSourceId);
      if (createdSubjectId) params.set("subjectId", createdSubjectId);
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
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.warn(`[${config.headerTitle}] Readiness fetch failed:`, e);
    } finally {
      if (!controller.signal.aborted) setChecksLoading(false);
    }
  }, [selectedDomainId, selectedCallerId, createdSourceId, createdSubjectId, config.headerTitle]);

  // Fetch readiness when arriving at the Launch step
  useEffect(() => {
    if (currentStep === STEP_LAUNCH && selectedDomainId) fetchReadiness();
  }, [currentStep, STEP_LAUNCH, selectedDomainId, selectedCallerId, fetchReadiness]);

  // (Existing curriculum loaded by TeachPlanStep on step 3 mount)

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

  // Note: extraction + launch polling cleanup handled by useTaskPoll hooks

  // Elapsed time counter while extraction is running
  useEffect(() => {
    if (!extractionTaskId) return;
    const interval = setInterval(() => setExtractElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [extractionTaskId]);

  // Fetch available content sources + existing courses when entering no-content phase
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

    // Also fetch existing courses (playbooks) + subjects for this domain
    if (selectedDomainId) {
      (async () => {
        try {
          const res = await fetch(`/api/domains/${selectedDomainId}`);
          const data = await res.json();
          if (cancelled || !data.ok) return;
          const domain = data.domain;
          const playbooks = (domain.playbooks || [])
            .filter((pb: ApiPlaybook) => pb.status === "PUBLISHED")
            .map((pb: ApiPlaybook) => {
              const subjects = domain.subjects || [];
              const totalAssertions = subjects.reduce((sum: number, sd: ApiSubjectDomain) => {
                return sum + (sd.subject?.sources || []).reduce((s2: number, ss: ApiSubjectSource) =>
                  s2 + (ss.source?._count?.assertions || 0), 0);
              }, 0);
              return {
                id: pb.id,
                name: pb.name,
                status: pb.status,
                subjectCount: subjects.length,
                assertionCount: totalAssertions,
                teachingMode: pb.config?.teachingMode,
              };
            });
          if (!cancelled) setExistingCourses(playbooks);

          // For Teach flow: build subject list with content counts
          if (isTeachFlow) {
            const subjectsWithContent = (domain.subjects || [])
              .map((sd: ApiSubjectDomain) => {
                const subj = sd.subject;
                if (!subj?.id || !subj.name) return null;
                const sourceCount = (subj.sources || []).length;
                const assertionCount = (subj.sources || []).reduce(
                  (sum: number, ss: ApiSubjectSource) => sum + (ss.source?._count?.assertions || 0), 0
                );
                return { id: subj.id, name: subj.name, sourceCount, assertionCount };
              })
              .filter((s: ExistingSubjectInfo | null): s is ExistingSubjectInfo => s !== null && s.assertionCount > 0);
            if (!cancelled) setExistingSubjects(subjectsWithContent);
          }
        } catch {
          if (!cancelled) {
            setExistingCourses([]);
            setExistingSubjects([]);
          }
        }
      })();
    }

    return () => { cancelled = true; };
  }, [contentPhase, selectedDomainId]);


  // ── Post-extraction wiring ────────────────────────
  // After assertions are extracted, generate a content spec (curriculum)
  // and re-compose the caller's prompt so the first call has teaching content.
  // Mirrors Quick Launch steps 6 + 8.

  const runPostExtractionWiring = useCallback(async (extractedCount: number) => {
    const warnings: string[] = [];
    let moduleCount = 0;
    let contentSpecGenerated = false;
    let promptComposed = false;
    // Per-step timeout — prevents forever spinners on hanging fetches
    const timeout = () => AbortSignal.timeout(WIRING_FETCH_TIMEOUT_MS);

    // Phase 0: Ensure domain has a published playbook (idempotent scaffold)
    // Without this, generateContentSpec can't link the content spec to a playbook
    try {
      await fetch(`/api/domains/${selectedDomainId}/scaffold`, { method: "POST", signal: timeout() });
    } catch (e: unknown) {
      console.warn("[Teach] Scaffold failed (non-critical):", e);
      warnings.push("Domain scaffold failed — content spec may not be linked to playbook");
    }

    // Phase 1: Generate content spec from assertions
    // For Teach flow, skip auto-generation — the Plan Sessions step handles it
    if (!isTeachFlow) {
      setContentPhase("generating-curriculum");
      try {
        const specRes = await fetch(`/api/domains/${selectedDomainId}/generate-content-spec`, {
          method: "POST",
          signal: timeout(),
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
      } catch (e: unknown) {
        const msg = e instanceof Error && e.name === "TimeoutError" ? "Curriculum generation timed out" : "Curriculum generation failed";
        console.warn("[Teach] Content spec generation failed:", e);
        warnings.push(msg);
      }
    } else {
      // Teach flow: TPs extracted, curriculum will be generated in Plan Sessions step
      contentSpecGenerated = false;
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
          signal: timeout(),
        });
        const composeData = await composeRes.json();
        if (composeData.ok) {
          promptComposed = true;
        } else {
          warnings.push(`Prompt: ${composeData.error || "composition failed"}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error && e.name === "TimeoutError" ? "Prompt composition timed out" : "Prompt composition failed";
        console.warn("[Teach] Prompt composition failed:", e);
        warnings.push(msg);
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

  // ── Pack upload result handler ─────────────────────
  const handlePackResult = useCallback(async (result: PackUploadResult) => {
    if (result.mode === "skip") {
      handleNext();
      return;
    }

    if (result.mode === "existing-course") {
      // User picked an existing course — content is already extracted
      // Just mark as has-content and move forward
      setContentPhase("has-content");
      return;
    }

    if (result.mode === "existing-subject") {
      // User picked an existing subject with content — scope to that subject
      if (result.subjectId) {
        setData("subjectIds", [result.subjectId]);
        if (result.subjectName) setData("subjectNames", [result.subjectName]);
        setData("contentAvailable", true);
      }
      setContentPhase("has-content");
      return;
    }

    if (result.mode === "pack-upload") {
      // Fire-and-forget: extraction runs in background on the server.
      // The extract endpoint auto-triggers scaffolding + content spec when done.
      setContentCount(result.sourceCount || 0);
      setContentPhase("done");
      // Tell downstream steps that extraction is still in progress
      setData("extractionInProgress", true);
      setData("packSourceCount", result.sourceCount || 0);
      // Persist content availability for downstream steps (mirrors handleNext step 2)
      setData("contentAvailable", true);
      setData("contentCount", result.sourceCount || 0);
      // Persist subject IDs for course-scoped content (Teach flow)
      if (result.subjects?.length) {
        setData("subjectIds", result.subjects.map((s) => s.id));
        setData("subjectNames", result.subjects.map((s) => s.name));
      }
      // Advance past content step (step 2 → step 3)
      setStep(currentStep + 1);
    }
  }, [setData, setStep, currentStep]);


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

      setCreatedSubjectId(subjectId);
      setCreatedSourceId(sourceId);
      // Persist subject ID for course-scoped content (Teach flow)
      if (isTeachFlow) {
        setData("subjectIds", [subjectId]);
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
    } catch (e: unknown) {
      console.error("[Teach] Source selection failed:", e);
      setUploadError(e instanceof Error ? e.message : "Failed to attach material");
      setContentPhase("error");
      setSelectedSourceId(null);
    }
  }, [selectedDomainId, availableSources, runPostExtractionWiring, isTeachFlow, setData]);

  // ── Helpers ───────────────────────────────────────

  const selectedDomain = domains.find((d) => d.id === selectedDomainId);

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
      if (isTeachFlow && selectedPersona) {
        const sel = personas.find((p) => p.slug === selectedPersona);
        setData("persona", selectedPersona);
        setData("personaName", sel?.name || selectedPersona);
        setData("teachingStyle", selectedPersona);
      }
      // Persist agent tuning data
      if (isTeachFlow) {
        const mergedTargets = { ...matrixTargets, ...behaviorTargets };
        if (Object.keys(mergedTargets).length > 0) {
          setData("behaviorTargets", mergedTargets);
        }
        if (Object.keys(matrixPositions).length > 0) {
          setData("matrixPositions", matrixPositions);
        }
        if (tunerPills.length > 0) {
          setData("tunerPills", tunerPills);
        }
      }
    } else if (currentStep === 2) {
      // Persist content availability for downstream steps (e.g. Plan Sessions)
      const hasContent = contentPhase === "has-content" || contentPhase === "done";
      setData("contentAvailable", hasContent);
      setData("contentCount", contentCount);
      // extractionInProgress is already set by handlePackResult if applicable
    }
    setStep(currentStep + 1);
  };

  const handlePrev = () => {
    // Save context before navigating back
    if (currentStep === 1) {
      setData("goal", goalText.trim());
      if (isTeachFlow && selectedPersona) {
        setData("persona", selectedPersona);
      }
      // Save tuning data on back-navigate too
      if (isTeachFlow) {
        const mergedTargets = { ...matrixTargets, ...behaviorTargets };
        if (Object.keys(mergedTargets).length > 0) setData("behaviorTargets", mergedTargets);
        if (Object.keys(matrixPositions).length > 0) setData("matrixPositions", matrixPositions);
        if (tunerPills.length > 0) setData("tunerPills", tunerPills);
      }
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
      if (selectedPersona) params.set("persona", selectedPersona);
      const qs = params.toString();
      endFlow();
      router.push(`/x/sim/${selectedCallerId}${qs ? `?${qs}` : ""}`);
      return;
    }

    // New behavior: server-side launch via task polling
    if (!selectedDomainId || launching) return;
    clearWizardError();
    setLaunchMessage("Setting up your lesson...");

    try {
      const res = await fetch("/api/teach-wizard/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainId: selectedDomainId,
          goal: goalText.trim() || undefined,
          persona: selectedPersona || undefined,
          subjectIds: getData<string[]>("subjectIds") || undefined,
          behaviorTargets: getData<Record<string, number>>("behaviorTargets") || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok || !data.taskId) {
        throw new Error(data.error || "Failed to start launch");
      }
      setLaunchTaskId(data.taskId);
    } catch (e: unknown) {
      console.error("[Teach] Launch failed:", e);
      setWizardError(e instanceof Error ? e.message : "Failed to start lesson. Please try again.");
      setLaunchMessage("");
    }
  }, [needsCallerUpfront, selectedDomainId, selectedCallerId, goalText, selectedPersona, ready, launching, endFlow, router, clearWizardError, setWizardError, getData]);

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

  // Fetch domain detail eagerly when entering the Launch step
  useEffect(() => {
    if (currentStep === STEP_LAUNCH && selectedDomainId && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [currentStep, STEP_LAUNCH, selectedDomainId, domainDetail, domainDetailLoading, fetchDomainDetail]);

  // Fetch greeting + call flow phases when entering Launch step
  useEffect(() => {
    if (currentStep !== STEP_LAUNCH || !selectedPersona) return;
    // Restore saved custom welcome from data bag
    const saved = getData<string>("welcomeMessage");
    if (saved) setCustomWelcome(saved);
    let cancelled = false;
    setLoadingGreeting(true);
    (async () => {
      try {
        const res = await fetch(`/api/onboarding?persona=${encodeURIComponent(selectedPersona)}`);
        if (!res.ok) throw new Error("Failed to fetch persona config");
        const data = await res.json();
        if (!cancelled && data.ok) {
          setWelcomeTemplate(data.welcomeTemplate || "");
          if (data.firstCallFlow?.phases) {
            setFlowPhases(data.firstCallFlow.phases);
          }
        }
      } catch (e) {
        if (!cancelled) console.warn("[Teach] Failed to load greeting/flow:", e);
      } finally {
        if (!cancelled) setLoadingGreeting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentStep, STEP_LAUNCH, selectedPersona]);

  // Fetch teaching points for selected domain (direct query through subject chain)
  // Teach flow: scoped to course subjects. Demonstrate flow: domain-wide.
  const fetchTeachingPoints = useCallback(async () => {
    if (!selectedDomainId) return;
    setTeachingPointsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      const subjectIds = isTeachFlow ? getData<string[]>("subjectIds") : undefined;
      if (subjectIds?.length) {
        params.set("subjectIds", subjectIds.join(","));
      }
      const res = await fetch(`/api/domains/${selectedDomainId}/teaching-points?${params}`);
      const data = await res.json();
      if (data.ok) {
        setTeachingPoints(
          (data.teachingPoints || []).map((tp: { id: string; text: string; type?: string; reviewed?: boolean; chapter?: string }) => ({
            id: tp.id,
            text: tp.text,
            type: tp.type || "FACT",
            reviewed: !!tp.reviewed,
            chapter: tp.chapter || undefined,
          }))
        );
      }
    } catch (e) {
      console.warn("[Teach] Failed to fetch teaching points:", e);
    } finally {
      setTeachingPointsLoading(false);
    }
  }, [selectedDomainId, isTeachFlow, getData]);

  // Fetch teaching points when content becomes available on step 2
  useEffect(() => {
    if (currentStep === 2 && selectedDomainId && (contentPhase === "done" || contentPhase === "has-content")) {
      fetchTeachingPoints();
    }
  }, [currentStep, selectedDomainId, contentPhase, fetchTeachingPoints]);

  const handleToggleOnboarding = useCallback(() => {
    const willExpand = !onboardingExpanded;
    setOnboardingExpanded(willExpand);
    if (willExpand && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [onboardingExpanded, domainDetail, domainDetailLoading, fetchDomainDetail]);

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
      const targets: Record<string, unknown> = {};
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
          steps={(state?.steps ?? config.fallbackSteps).map((s, i) => {
            // Determine if this step is actively processing something
            const stepProcessing =
              (i === 0 && loadingDomains) ||
              (i === 1 && (loadingSuggestions || loadingGoals || savingGoal)) ||
              (i === 2 && ["uploading", "extracting", "generating-curriculum", "composing-prompt", "attaching-source"].includes(contentPhase)) ||
              (i === STEP_LAUNCH && (checksLoading || launching));
            return {
              label: s.label,
              completed: i < currentStep,
              active: i === currentStep,
              processing: stepProcessing,
              backgroundProcessing: false,
              onClick: i < currentStep ? () => setStep(i) : undefined,
            };
          })}
        />
      </div>

      {/* ── Start Over (shown when resuming a previous run) ── */}
      {currentStep > 0 && (
        <div className="dtw-start-over">
          <button onClick={handleStartOver} className="dtw-btn-start-over">
            <RotateCcw size={14} />
            Start Over
          </button>
        </div>
      )}

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
          <FieldHint label={t.domain} hint={WIZARD_HINTS["teach.institution"]} />
          {loadingDomains ? (
            <div className="dtw-muted-text dtw-loading-text">
              <span className="dtw-inline-spinner" />
              Loading {t.domain.toLowerCase()}s...
            </div>
          ) : domainOptions.length === 0 ? (
            <div className="dtw-muted-text">
              No {t.domain.toLowerCase()}s found.{" "}
              {canCreateInstitution ? (
                <span
                  className="dtw-inline-link"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create one now
                </span>
              ) : (
                <span
                  className="dtw-inline-link"
                  onClick={() => router.push("/x/quick-launch")}
                >
                  Create one with Quick Launch
                </span>
              )}
            </div>
          ) : (
            <div className="dtw-domain-row">
              <FancySelect
                value={selectedDomainId}
                onChange={setSelectedDomainId}
                options={domainOptions}
                placeholder={`Select ${
                  t.domain.match(/^[aeiou]/i) ? "an" : "a"
                } ${t.domain.toLowerCase()}...`}
                searchable={domainOptions.length > 5}
                style={{ flex: 1 }}
              />
              {canCreateInstitution && (
                <button
                  className="dtw-btn-create-new"
                  onClick={() => setShowCreateModal(true)}
                >
                  <Plus size={14} /> New
                </button>
              )}
            </div>
          )}

          <CreateInstitutionModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onCreated={async (newDomain) => {
              setShowCreateModal(false);
              setSelectedDomainId(newDomain.id);
              // Refetch domains from API to get full institution.type data (needed for persona pre-fill)
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
                      badge: d.institution?.type?.name || (d.isDefault ? "Default" : undefined),
                    })),
                  );
                }
              } catch {
                // Fallback: add partial entry so domain is at least selectable
                setDomains((prev) => [...prev, {
                  id: newDomain.id, slug: newDomain.slug, name: newDomain.name,
                  isDefault: false, callerCount: 0,
                }]);
                setDomainOptions((prev) => [
                  { value: newDomain.id, label: newDomain.name, subtitle: newDomain.slug },
                  ...prev,
                ]);
              }
            }}
          />

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
          <FieldHint label="Session Goal" hint={WIZARD_HINTS["teach.goal"]} aiEnhanced aiLoading={loadingSuggestions} />
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
          {(loadingSuggestions || suggestions.length > 0 || suggestionsError) && (
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
              ) : suggestions.length > 0 ? (
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
              ) : suggestionsError ? (
                <div className="dtw-suggestion-list">
                  <button
                    onClick={() => { lastSuggestText.current = ""; fetchSuggestions(""); }}
                    className="dtw-suggestion-chip"
                  >
                    Retry suggestions
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Persona selector (Teach flow only) */}
          {isTeachFlow && !personasLoading && personas.length > 1 && (
            <div className="dtw-persona-section">
              <div className="dtw-section-label">Guide Persona</div>
              <div className="dtw-persona-chips">
                {personas.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => setSelectedPersona(p.slug)}
                    className={`dtw-persona-chip ${selectedPersona === p.slug ? "dtw-persona-chip-selected" : ""}`}
                  >
                    <span className="dtw-persona-chip-name">{p.name}</span>
                    {p.description && (
                      <span className="dtw-persona-chip-desc">{p.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Agent tuning — Boston Matrix + behavior pills (Teach flow only) */}
          {isTeachFlow && (
            <div className="dtw-tuning-section">
              <div className="dtw-section-label">Teaching Style</div>
              <div className="dtw-tuning-hint">
                Place the dots to set your guide&apos;s personality. Click a preset to start from a known style.
              </div>
              <AgentTuningPanel
                onChange={handleMatrixChange}
                compact
              />
              <div className="dtw-tuner-wrapper">
                <AgentTuner
                  initialPills={tunerPills}
                  context={{
                    personaSlug: selectedPersona || undefined,
                    domainName: selectedDomain?.name || undefined,
                  }}
                  onChange={handleTunerChange}
                  label="Advanced: Fine-tune behavior"
                />
              </div>
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
              <FieldHint label={`${t.caller}'s Goals`} hint={WIZARD_HINTS["teach.objectives"]} labelClass="dtw-goals-label" />
              {loadingGoals ? (
                <div className="dtw-goals-loading dtw-loading-text">
                  <span className="dtw-inline-spinner" />
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
          <FieldHint label="Course Materials" hint={WIZARD_HINTS["teach.content"]} />

          {/* Loading state */}
          {contentPhase === "loading" && (
            <div className="dtw-muted-text dtw-loading-text"><span className="dtw-inline-spinner" /> Checking content...</div>
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
              {/* Extraction error banner (visible in both Teach + Demonstrate flows) */}
              {uploadError && contentPhase === "error" && (
                <div className="hf-banner hf-banner-error dtw-upload-error">
                  {uploadError}
                </div>
              )}

              {/* Teach flow: Pack upload with course selection + multi-file */}
              {isTeachFlow ? (
                <PackUploadStep
                  domainId={selectedDomainId}
                  courseName={goalText}
                  existingCourses={existingCourses}
                  existingSubjects={existingSubjects}
                  onResult={handlePackResult}
                  onBack={handlePrev}
                />
              ) : (
                <>
                  {/* Demonstrate flow: source library + drag zone (both visible) */}
                  {availableSources.length > 0 && (
                    <div className="dtw-source-library">
                      {loadingSources ? (
                        <div className="dtw-muted-text dtw-loading-text"><span className="dtw-inline-spinner" /> Loading content library...</div>
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
                      {selectedSourceId && (
                        <button
                          className="dtw-btn-upload"
                          onClick={() => handleSelectExistingSource(selectedSourceId)}
                        >
                          Use Selected Content
                        </button>
                      )}
                      <div className="pack-or-divider">or upload new</div>
                    </div>
                  )}

                  <PackUploadStep
                    domainId={selectedDomainId}
                    courseName={goalText}
                    onResult={handlePackResult}
                    onBack={handlePrev}
                  />

                  {uploadError && (
                    <div className="dtw-upload-error">{uploadError}</div>
                  )}
                </>
              )}
            </>
          )}

          {/* Attaching existing source */}
          {contentPhase === "attaching-source" && (
            <div>
              <div className="dtw-extract-status">
                <div className="dtw-pulse-dot" />
                <div className="dtw-extract-label">Linking material...</div>
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

          {/* Extracting — two-phase: quick preview + enrichment progress */}
          {contentPhase === "extracting" && (
            <div>
              {/* Quick preview rows (appear ~5s after upload) */}
              {quickPreview.length > 0 ? (
                <div className="dtw-quick-preview-wrap">
                  <div className="dtw-extract-status">
                    <div className="dtw-quick-preview-dot" />
                    <div className="dtw-extract-label">Quick scan — {quickPreview.length} key points found</div>
                  </div>
                  <div className="dtw-quick-preview-list">
                    {quickPreview.map((item, i) => (
                      <div key={i} className="dtw-teaching-point">
                        <div className="dtw-tp-indicator dtw-tp-pending">{i + 1}</div>
                        <div className="dtw-tp-text">{item.text}</div>
                        <div className="dtw-tp-type">{item.category}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="dtw-extract-status">
                  <div className="dtw-pulse-dot" />
                  <div className="dtw-extract-label">Scanning document...</div>
                  <div className="dtw-extract-elapsed">{extractElapsed}s</div>
                </div>
              )}

              {/* Enrichment progress (runs below quick preview) */}
              {quickPreview.length > 0 && (
                <div>
                  <div className="dtw-extract-status">
                    <div className="dtw-pulse-dot" />
                    <div className="dtw-extract-label">Enriching with full details...</div>
                    <div className="dtw-extract-elapsed">{extractElapsed}s</div>
                  </div>
                </div>
              )}
              <div className="dtw-progress-track">
                <div
                  className={`dtw-progress-fill${extractProgress.total === 0 && quickPreview.length === 0 ? " dtw-progress-fill--indeterminate" : ""}`}
                  style={{
                    width: extractProgress.total > 0
                      ? `${Math.round((extractProgress.current / extractProgress.total) * 100)}%`
                      : undefined,
                  }}
                />
              </div>
              <div className="dtw-progress-labels">
                <span>{extractProgress.extracted} teaching points extracted</span>
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
                    <>{contentCount} teaching point{contentCount !== 1 ? "s" : ""} extracted</>
                  )}
                </div>
                {autoWireResult?.warnings && autoWireResult.warnings.length > 0 && (
                  <div className="dtw-content-summary-detail dtw-warning-detail">
                    {autoWireResult.warnings.join("; ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Teaching points preview (after extraction or when content exists) */}
          {(contentPhase === "done" || contentPhase === "has-content") && (
            <div className="dtw-accordion-card dtw-tp-accordion">
              <button onClick={() => setTeachingPointsExpanded((v) => !v)} className="dtw-accordion-toggle">
                {teachingPointsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>Teaching Points</span>
                {teachingPointsLoading && (
                  <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                )}
                {teachingPoints.length > 0 && (
                  <span className="dtw-accordion-badge">{teachingPoints.length}{contentCount > teachingPoints.length ? "+" : ""}</span>
                )}
              </button>
              {teachingPointsExpanded && (
                <div className="dtw-accordion-content">
                  {teachingPointsLoading ? (
                    <div className="dtw-centered-loader">
                      <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                      <span className="hf-text-sm hf-text-muted">Loading teaching points...</span>
                    </div>
                  ) : teachingPoints.length === 0 ? (
                    <div className="hf-text-sm hf-text-muted dtw-empty-text">
                      No teaching points found.
                    </div>
                  ) : (
                    <div className="dtw-teaching-points">
                      {(() => {
                        // Group TPs by chapter, preserving API sort order
                        const groups: Array<{ chapter: string; points: typeof teachingPoints }> = [];
                        const seen = new Map<string, number>();
                        for (const tp of teachingPoints) {
                          const key = tp.chapter || "General";
                          const idx = seen.get(key);
                          if (idx !== undefined) {
                            groups[idx].points.push(tp);
                          } else {
                            seen.set(key, groups.length);
                            groups.push({ chapter: key, points: [tp] });
                          }
                        }

                        // If only one group, render flat (no headers needed)
                        if (groups.length <= 1) {
                          return teachingPoints.map((point) => (
                            <div key={point.id} className="dtw-teaching-point">
                              <div className={`dtw-tp-indicator ${point.reviewed ? "dtw-tp-reviewed" : "dtw-tp-pending"}`}>
                                {point.reviewed ? "\u2713" : "\u2022"}
                              </div>
                              <div className="dtw-tp-text">{point.text}</div>
                              <span className="dtw-tp-type">{point.type}</span>
                            </div>
                          ));
                        }

                        return groups.map((group) => (
                          <div key={group.chapter} className="dtw-tp-group">
                            <div className="dtw-tp-group-header">
                              <span>{group.chapter}</span>
                              <span className="dtw-tp-group-count">{group.points.length}</span>
                            </div>
                            {group.points.map((point) => (
                              <div key={point.id} className="dtw-teaching-point">
                                <div className={`dtw-tp-indicator ${point.reviewed ? "dtw-tp-reviewed" : "dtw-tp-pending"}`}>
                                  {point.reviewed ? "\u2713" : "\u2022"}
                                </div>
                                <div className="dtw-tp-text">{point.text}</div>
                                <span className="dtw-tp-type">{point.type}</span>
                              </div>
                            ))}
                          </div>
                        ));
                      })()}
                      {contentCount > teachingPoints.length && (
                        <div className="hf-text-sm hf-text-muted dtw-showing-count">
                          Showing {teachingPoints.length} of {contentCount}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step navigation */}
          {contentPhase !== "uploading" && contentPhase !== "extracting" && contentPhase !== "generating-curriculum" && contentPhase !== "composing-prompt" && contentPhase !== "attaching-source" && contentPhase !== "loading" && (
            <div className="dtw-nav-between dtw-nav-between--spaced">
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
      {/* STEP 3 (Teach only): Plan Sessions                */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === STEP_PLAN && isTeachFlow && selectedDomainId && (
        <TeachPlanStep
          domainId={selectedDomainId}
          setData={setData}
          getData={getData}
          onNext={handleNext}
          onPrev={handlePrev}
        />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 3/4: Launch                                 */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === STEP_LAUNCH && (
        <div className="dtw-section">
          <WizardSummary
            title={launching ? "Launching..." : "Ready to Go!"}
            subtitle={
              launching
                ? (launchMessage || "Preparing...")
                : ready
                  ? `All checks passed. Start your ${t.session.toLowerCase()}.`
                  : needsCallerUpfront
                    ? `${levelLabel} — ${score}% readiness`
                    : `Start your ${t.session.toLowerCase()} — a test caller will be created automatically.`
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
                      label: "Test Caller",
                      value: "Auto-named at launch (e.g. Elise Moreau)",
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
                ? (launchMessage || "Launching...")
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
          >
            {/* Compact config chips (Demonstrate flow only — Teach has full greeting card below) */}
            {!isTeachFlow && domainDetail ? (
              <div className="dtw-config-strip">
                <div className="dtw-config-chip">{"\uD83D\uDC64"} {domainDetail.onboardingIdentitySpec?.name || "Default persona"}</div>
                <div className="dtw-config-chip">{"\uD83D\uDCAC"} {domainDetail.onboardingWelcome ? "Custom welcome" : "Default welcome"}</div>
                <div className="dtw-config-chip">{"\uD83D\uDD04"} {(domainDetail.onboardingFlowPhases as { phases?: unknown[] })?.phases?.length ? `${(domainDetail.onboardingFlowPhases as { phases: unknown[] }).phases.length} phases` : "Default flow"}</div>
                <div className="dtw-config-chip">{"\u2699\uFE0F"} {domainDetail.onboardingDefaultTargets ? `${Object.keys(domainDetail.onboardingDefaultTargets as object).filter(k => !k.startsWith("_")).length} params` : "Default targets"}</div>
              </div>
            ) : !isTeachFlow && domainDetailLoading ? (
              <div className="dtw-config-strip">
                <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              </div>
            ) : null}
          </WizardSummary>

          {/* ── Greeting Preview Card (Teach flow only — needs persona) ── */}
          {isTeachFlow && <div className="hf-greeting-card" style={{ marginBottom: 20 }}>
            <FieldHint
              label="Greeting"
              hint={WIZARD_HINTS["course.welcome"]}
              labelClass="hf-section-title"
            />

            {/* Persona badge */}
            {selectedPersona && (
              <div className="hf-greeting-persona">
                <span className="hf-greeting-persona-icon">
                  {selectedPersona === "tutor" ? "\uD83E\uDDD1\u200D\uD83C\uDFEB" : selectedPersona === "coach" ? "\uD83D\uDCAA" : selectedPersona === "mentor" ? "\uD83E\uDD1D" : selectedPersona === "socratic" ? "\uD83E\uDD14" : "\uD83C\uDFAD"}
                </span>
                <span>{personas.find(p => p.slug === selectedPersona)?.name || selectedPersona}</span>
                {goalText && (
                  <>
                    <span style={{ color: "var(--text-muted)" }}>&middot;</span>
                    <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>{goalText.length > 40 ? goalText.slice(0, 40) + "..." : goalText}</span>
                  </>
                )}
              </div>
            )}

            {/* Welcome text */}
            {loadingGreeting ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                <div className="hf-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                <span style={{ fontSize: 13 }}>Loading greeting...</span>
              </div>
            ) : (
              <p className="hf-greeting-text">&ldquo;{customWelcome || welcomeTemplate || "Your AI will introduce itself..."}&rdquo;</p>
            )}

            {/* Collapse toggle for custom textarea */}
            <button
              className="hf-greeting-toggle"
              onClick={() => setGreetingOpen(!greetingOpen)}
            >
              <ChevronRight
                size={14}
                style={{
                  transition: "transform 0.15s ease",
                  transform: greetingOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
              Customize greeting
            </button>

            {greetingOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={customWelcome}
                  onChange={(e) => { setCustomWelcome(e.target.value); setData("welcomeMessage", e.target.value); }}
                  placeholder={welcomeTemplate || "Enter a custom welcome message..."}
                  rows={3}
                  className="hf-input"
                  style={{ resize: "vertical", minHeight: 80 }}
                />
                <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
                  Leave blank to use the default above
                </p>
              </div>
            )}
          </div>}

          {/* ── Call Flow Phases (Teach flow only) ── */}
          {isTeachFlow && <div style={{ marginBottom: 20 }}>
            <FieldHint
              label="Call Flow"
              hint={WIZARD_HINTS["course.callFlow"]}
              labelClass="hf-section-title"
            />
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              How the first {t.session.toLowerCase()} is structured &mdash; loaded from your {personas.find(p => p.slug === selectedPersona)?.name || "persona"} defaults
            </p>

            {flowPhases.length > 0 ? (
              <div className="hf-flow-card">
                {flowPhases.map((phase, i) => {
                  const isExpanded = expandedPhase === i;
                  const goalsSummary = phase.goals.slice(0, 2).join(" \u00B7 ");
                  return (
                    <div
                      key={`${phase.phase}-${i}`}
                      className="hf-flow-phase"
                      onClick={() => setExpandedPhase(isExpanded ? null : i)}
                    >
                      <span className="hf-flow-phase-num">{i + 1}</span>
                      <div className="hf-flow-phase-body">
                        <div className="hf-flow-phase-header">
                          <span className="hf-flow-phase-name">{phase.phase}</span>
                          <span className="hf-flow-phase-dur">{phase.duration}</span>
                        </div>

                        {!isExpanded && (
                          <div className="hf-flow-phase-goals">{goalsSummary}</div>
                        )}

                        {isExpanded && (
                          <div className="hf-flow-phase-detail">
                            <div className="hf-flow-phase-detail-section">
                              <div className="hf-flow-phase-detail-label">Goals</div>
                              <ul className="hf-flow-phase-detail-list">
                                {phase.goals.map((g, gi) => <li key={gi}>{g}</li>)}
                              </ul>
                            </div>
                            {phase.avoid && phase.avoid.length > 0 && (
                              <div className="hf-flow-phase-detail-section">
                                <div className="hf-flow-phase-detail-label">Avoid</div>
                                <ul className="hf-flow-phase-detail-list hf-flow-phase-avoid">
                                  {phase.avoid.map((a, ai) => <li key={ai}>{a}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight
                        size={14}
                        style={{
                          flexShrink: 0,
                          color: "var(--text-muted)",
                          transition: "transform 0.15s ease",
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          marginTop: 2,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : loadingGreeting ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", padding: "20px 0" }}>
                <div className="hf-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                <span style={{ fontSize: 13 }}>Loading call flow...</span>
              </div>
            ) : (
              <div style={{
                padding: "20px 16px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 13,
                borderRadius: 10,
                border: "1px dashed var(--border-default)",
              }}>
                No flow phases defined &mdash; the AI will use its default onboarding sequence.
              </div>
            )}
          </div>}

          {/* ── 1. Tune Persona (Boston Matrix) ── */}
          <div className="dtw-accordion-card">
            <button onClick={handleToggleTunePersona} className="dtw-accordion-toggle">
              {tunePersonaExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Tune Persona</span>
              {savingPersona && (
                <span className="dtw-saving-hint">&mdash; saving...</span>
              )}
            </button>
            {tunePersonaExpanded && (
              <div className="dtw-accordion-content">
                <FieldHint label="Persona Matrix" hint={WIZARD_HINTS["teach.persona"]} labelClass="hf-section-title" />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  Drag to position your AI along key behavioural dimensions
                </p>
                {domainDetailLoading && !domainDetail ? (
                  <div className="dtw-centered-loader">
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading persona settings...</span>
                  </div>
                ) : (
                  <AgentTuningPanel
                    initialPositions={
                      (domainDetail?.onboardingDefaultTargets as Record<string, unknown>)?._matrixPositions as
                        React.ComponentProps<typeof AgentTuningPanel>["initialPositions"]
                    }
                    existingParams={
                      domainDetail?.onboardingDefaultTargets
                        ? Object.fromEntries(
                            Object.entries(domainDetail.onboardingDefaultTargets as Record<string, unknown>)
                              .filter(([k]) => !k.startsWith("_"))
                              .map(([k, v]) => [k, typeof v === "object" && v !== null ? (v as Record<string, unknown>).value : v])
                          ) as Record<string, number>
                        : undefined
                    }
                    onChange={handlePersonaTuningChange}
                    compact
                  />
                )}
              </div>
            )}
          </div>

          {/* ── 2. Tune Onboarding ── */}
          <div className="dtw-accordion-card">
            <button onClick={handleToggleOnboarding} className="dtw-accordion-toggle">
              {onboardingExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Tune Onboarding</span>
              {domainDetailLoading && !domainDetail && onboardingExpanded && (
                <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              )}
            </button>
            {onboardingExpanded && (
              <div className="dtw-accordion-content">
                <FieldHint label="Onboarding" hint={WIZARD_HINTS["teach.onboarding"]} labelClass="hf-section-title" />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  Configure how the AI introduces itself and gathers context from the student
                </p>
                {domainDetailLoading && !domainDetail ? (
                  <div className="dtw-centered-loader">
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading onboarding configuration...</span>
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

          {/* ── 3. Preview First Prompt (lazy-load accordion) ── */}
          <div className="dtw-accordion-card">
            <button
              onClick={() => setPromptPreviewExpanded((v) => !v)}
              className="dtw-accordion-toggle"
            >
              {promptPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Preview First Prompt</span>
            </button>
            {promptPreviewExpanded && (
              <div className="dtw-accordion-content">
                <FieldHint label="System Prompt" hint={WIZARD_HINTS["teach.promptPreview"]} labelClass="hf-section-title" />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  The full prompt the AI will receive &mdash; read-only
                </p>
                <PromptPreviewContent
                  domainId={selectedDomainId}
                  domainName={selectedDomain?.name}
                  callerId={selectedCallerId || undefined}
                  open={promptPreviewExpanded}
                />
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
