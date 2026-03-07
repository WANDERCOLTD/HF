"use client";

/**
 * TeachWizard — single-page progressive accordion for Teach and Demonstrate flows.
 *
 * Two modes:
 *   teach: institution → course → goal → upload → review → lesson-plan → launch
 *   demo:  institution (+ caller) → goal → upload → review → launch
 *
 * Design principles:
 * - SectionStatus state machine: locked / active / done
 * - CASCADE constant drives which sections re-lock when a prior section is edited
 * - All enum labels come from resolve-config.ts (no hardcodes in JSX)
 * - Upload auto-advances to Review — teacher never blocked
 * - Review shows two-phase extraction progress (quick preview + enrichment)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { randomFakeName } from "@/lib/fake-names";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  PlayCircle,
  Pencil,
  X as XIcon,
  User,
  Building2,
  Target,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { AgentTuner } from "@/components/shared/AgentTuner";
import type { AgentTunerOutput, AgentTunerPill } from "@/lib/agent-tuner/types";
import WizardSection, { type SectionStatus } from "@/components/shared/WizardSection";
import { PackUploadStep } from "./PackUploadStep";
import type { PackUploadResult } from "./PackUploadStep";
import { suggestInteractionPattern } from "@/lib/content-trust/resolve-config";
import { CreateInstitutionModal } from "./CreateInstitutionModal";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { WIRING_FETCH_TIMEOUT_MS } from "@/lib/tasks/constants";
import { PromptPreviewContent } from "@/app/x/domains/components/PromptPreviewModal";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useTerminology } from "@/contexts/TerminologyContext";
import {
  TEACHING_MODE_LABELS,
  TEACHING_MODE_ORDER,
  TEACH_METHOD_CONFIG,
  categoryToTeachMethod,
  intentCategoryWeights,
  suggestTeachingMode,
  type TeachingMode,
  type TeachMethod,
} from "@/lib/content-trust/resolve-config";
import { getDocTypeInfo, DOC_TYPE_INFO } from "@/lib/doc-type-icons";
import {
  suggestTeachingProfile,
  getTeachingProfile,
} from "@/lib/content-trust/teaching-profiles";
import KnowledgeMapTree, { type SourceTree, type KnowledgeMapStats } from "@/components/shared/KnowledgeMapTree";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import "./teach-wizard.css";

// ── Constants ───────────────────────────────────────

type SectionId = "institution" | "course" | "goal" | "upload" | "review" | "lesson-plan" | "launch";

const SECTION_ORDER_TEACH: SectionId[] = [
  "institution", "course", "goal", "upload", "review", "lesson-plan", "launch",
];

const SECTION_ORDER_DEMO: SectionId[] = [
  "institution", "goal", "upload", "review", "launch",
];

function buildCascade(sections: SectionId[]): Record<SectionId, SectionId[]> {
  const base: Record<SectionId, SectionId[]> = {
    institution: [], course: [], goal: [], upload: [], review: [], "lesson-plan": [], launch: [],
  };
  // institution re-locks everything after it
  base.institution = sections.filter((s) => s !== "institution");
  // course re-locks upload forward (teach mode only)
  base.course = sections.filter((s) => ["upload", "review", "lesson-plan"].includes(s));
  // upload re-locks review + lesson-plan
  base.upload = sections.filter((s) => ["review", "lesson-plan"].includes(s));
  // review re-locks lesson-plan
  base.review = sections.filter((s) => s === "lesson-plan");
  return base;
}

type CallerInfo = { id: string; name: string | null; email: string | null };

type CourseCheck = {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
};

type AutoWireResult = {
  moduleCount: number;
  contentSpecGenerated: boolean;
  promptComposed: boolean;
  warnings: string[];
};

// ── Types ───────────────────────────────────────────

type DomainInfo = {
  id: string;
  slug: string;
  name: string;
  institution?: {
    type?: { slug?: string; name?: string; defaultArchetypeSlug?: string | null } | null;
  } | null;
};
type PlaybookInfo = {
  id: string;
  name: string;
  teachingMode?: TeachingMode;
};

type ContentItem = {
  id: string;
  text: string;
  excluded: boolean;
  meta?: string;
};

type ContentGroup = {
  category: string;
  count: number;
  originalCount: number;
  teachMethod: TeachMethod;
  included: boolean;
  groupType: "assertion" | "question" | "vocabulary" | "visual_aid";
  expanded: boolean;
  items: ContentItem[] | null; // null = not loaded, [] = loaded but empty
  loadingItems: boolean;
  itemError: string | null;
};

type LessonPlanItem = {
  id: string;
  sessionNumber: number;
  title: string;
  sessionType: "introduce" | "deepen" | "review" | "assess" | "consolidate";
  tpCount: number;
  tpIds: string[];
  durationMins: number;
  objectives: string[];
  editing: boolean;
};

type ExistingCourseInfo = {
  id: string;
  name: string;
  status: string;
  subjectCount: number;
  assertionCount: number;
};

type ExistingSubjectInfo = {
  id: string;
  name: string;
  sourceCount: number;
  assertionCount: number;
};

// ── Helpers ─────────────────────────────────────────

function categoryIcon(category: string): string {
  const map: Record<string, string> = {
    fact: "📚",
    concept: "💡",
    key_term: "🔤",
    vocabulary: "🔤",
    reading_passage: "📄",
    comprehension_task: "✔️",
    open_task: "💬",
    activity: "✏️",
    worksheet: "📝",
    worked_example: "🔢",
    definition: "📖",
    example: "🔍",
    process: "🔄",
    rule: "📏",
    threshold: "⚠️",
    // Question types
    mcq: "🔘",
    true_false: "✔️",
    matching: "🔗",
    short_answer: "✍️",
    open: "💬",
    tutor_question: "🎯",
    information: "ℹ️",
    // Visual aids
    visual_aid: "🖼️",
  };
  return map[category] ?? "📌";
}

function countLabel(g: ContentGroup): string {
  if (g.groupType === "vocabulary") return g.count === 1 ? "term" : "terms";
  if (g.groupType === "question") return g.count === 1 ? "Q" : "Qs";
  if (g.groupType === "visual_aid") return g.count === 1 ? "figure" : "figures";
  return g.count === 1 ? "TP" : "TPs";
}

function questionTypeToTeachMethod(qt: string): TeachMethod {
  const map: Record<string, TeachMethod> = {
    TRUE_FALSE: "true_false",
    MCQ: "recall_quiz",
    MATCHING: "matching_task",
    SHORT_ANSWER: "guided_discussion",
    OPEN: "guided_discussion",
    TUTOR_QUESTION: "guided_discussion",
  };
  return map[qt] ?? "recall_quiz";
}

const SESSION_TYPE_STYLES: Record<string, { label: string; className: string }> = {
  introduce: { label: "Introduce", className: "tw-badge-introduce" },
  deepen: { label: "Deepen", className: "tw-badge-deepen" },
  review: { label: "Review", className: "tw-badge-review" },
  assess: { label: "Assess", className: "tw-badge-assess" },
  consolidate: { label: "Consolidate", className: "tw-badge-consolidate" },
};

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function estimateDuration(tpCount: number): number {
  // ~3 min per teaching point
  return Math.max(10, Math.round((tpCount * 3) / 5) * 5);
}

// ── Component ───────────────────────────────────────

export default function TeachWizard({ mode = "teach" }: { mode?: "teach" | "demo" }) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const canCreateInstitution = ["OPERATOR", "ADMIN", "SUPERADMIN"].includes(
    (sessionData?.user as { role?: string })?.role || ""
  );

  const isDemo = mode === "demo";
  const sectionOrder = isDemo ? SECTION_ORDER_DEMO : SECTION_ORDER_TEACH;
  const cascade = useMemo(() => buildCascade(sectionOrder), [sectionOrder]);
  const { terms } = useTerminology();

  // ── Section status ─────────────────────────────────

  const [sectionStatus, setSectionStatus] = useState<Record<SectionId, SectionStatus>>(() => {
    const initial: Record<SectionId, SectionStatus> = {
      institution: "active", course: "locked", goal: "locked",
      upload: "locked", review: "locked", "lesson-plan": "locked", launch: "locked",
    };
    return initial;
  });

  const completeSection = useCallback((id: SectionId) => {
    setSectionStatus((prev) => {
      const next = { ...prev, [id]: "done" as SectionStatus };
      const idx = sectionOrder.indexOf(id);
      if (idx < sectionOrder.length - 1) {
        const nextId = sectionOrder[idx + 1];
        next[nextId] = "active";
      }
      return next;
    });
  }, [sectionOrder]);

  const editSection = useCallback((id: SectionId) => {
    setSectionStatus((prev) => {
      const next = { ...prev, [id]: "active" as SectionStatus };
      for (const dep of cascade[id]) {
        next[dep] = "locked";
      }
      return next;
    });

    // Reset review state when re-editing upload
    if (id === "upload") {
      setContentDone(false);
      setContentGroups([]);
      setContentTotal(0);
      setExtractionInProgress(false);
      setExtractionTaskId(null);
      setExtractionTimedOut(false);
      setQuickPreview([]);
      setExtractProgress({ current: 0, total: 0, extracted: 0 });
      setExtractElapsed(0);
      setContentError(null);
      setUploadSourceCount(0);
      setKnowledgeMapSources(null);
      setKnowledgeMapStats(null);
      knowledgeMapFetchedRef.current = false;
      if (extractPollRef.current) {
        clearInterval(extractPollRef.current);
        extractPollRef.current = null;
      }
    }
  }, []);

  // ── Section 1 — Institution ────────────────────────

  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const domainsFetched = useRef(false);

  useEffect(() => {
    if (domainsFetched.current) return;
    domainsFetched.current = true;
    fetch("/api/domains")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.domains) setDomains(data.domains);
      })
      .catch(() => {})
      .finally(() => setLoadingDomains(false));
  }, []);

  // ── Caller selection (demo mode only) ───────────────

  const [callers, setCallers] = useState<CallerInfo[]>([]);
  const [loadingCallers, setLoadingCallers] = useState(false);
  const [selectedCallerId, setSelectedCallerId] = useState("");

  // Fetch callers when domain changes in demo mode
  useEffect(() => {
    if (!isDemo || !selectedDomainId) {
      setCallers([]);
      setSelectedCallerId("");
      return;
    }
    setLoadingCallers(true);
    fetch(`/api/callers?scope=ALL&domainId=${selectedDomainId}`)
      .then((r) => r.json())
      .then((data) => {
        const list: CallerInfo[] = (data.callers ?? data.data ?? []).map(
          (c: { id: string; name?: string | null; email?: string | null }) => ({
            id: c.id, name: c.name ?? null, email: c.email ?? null,
          })
        );
        setCallers(list);
        // Auto-select first caller if only one
        if (list.length === 1) setSelectedCallerId(list[0].id);
      })
      .catch(() => setCallers([]))
      .finally(() => setLoadingCallers(false));
  }, [isDemo, selectedDomainId]);

  const handleSelectDomain = useCallback(
    (id: string) => {
      setSelectedDomainId(id);
      // In demo mode, don't complete institution until caller is also selected
      if (!isDemo) completeSection("institution");
    },
    [completeSection, isDemo]
  );

  const handleSelectCaller = useCallback(
    (id: string) => {
      setSelectedCallerId(id);
    },
    []
  );

  const handleCompleteInstitution = useCallback(() => {
    if (isDemo && !selectedCallerId) return;
    completeSection("institution");
  }, [isDemo, selectedCallerId, completeSection]);

  // ── Demo-mode: auto-wiring + readiness ──────────────

  const [autoWireResult, setAutoWireResult] = useState<AutoWireResult | null>(null);
  const [autoWiring, setAutoWiring] = useState(false);

  // Readiness
  const [checks, setChecks] = useState<CourseCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [checksLoading, setChecksLoading] = useState(false);
  const [readinessScore, setReadinessScore] = useState(0);
  const [readinessLevel, setReadinessLevel] = useState<"ready" | "almost" | "incomplete">("incomplete");
  const readinessAbort = useRef<AbortController | null>(null);

  // Prompt preview accordion (demo launch)
  const [promptPreviewExpanded, setPromptPreviewExpanded] = useState(false);

  // ── Section 2 — Course + Intent ────────────────────

  const [playbooks, setPlaybooks] = useState<PlaybookInfo[]>([]);
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(false);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [showNewCourseForm, setShowNewCourseForm] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [subjectDiscipline, setSubjectDiscipline] = useState("");
  const [subjectCatalog, setSubjectCatalog] = useState<Array<{ label: string; category: string; value: string }>>([]);
  const [subjectAllowFreeText, setSubjectAllowFreeText] = useState(true);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [subjectDropdownOpen, setSubjectDropdownOpen] = useState(false);
  const subjectsFetched = useRef(false);
  const subjectDropdownRef = useRef<HTMLDivElement>(null);
  const [teachingMode, setTeachingMode] = useState<TeachingMode>("recall");
  const [suggestedMode, setSuggestedMode] = useState<TeachingMode | null>(null);
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [existingCourses, setExistingCourses] = useState<ExistingCourseInfo[]>([]);
  const [existingSubjects, setExistingSubjects] = useState<ExistingSubjectInfo[]>([]);

  // Fetch subject catalog from SystemSettings
  useEffect(() => {
    if (subjectsFetched.current) return;
    subjectsFetched.current = true;
    fetch("/api/subjects-catalog")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.catalog) {
          setSubjectCatalog(data.catalog);
          setSubjectAllowFreeText(data.allowFreeText ?? true);
        }
      })
      .catch(() => { /* fallback: empty catalog, free text still works */ });
  }, []);

  // Close subject dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (subjectDropdownRef.current && !subjectDropdownRef.current.contains(e.target as Node)) {
        setSubjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!selectedDomainId || sectionStatus.course !== "active") return;
    setLoadingPlaybooks(true);

    // Load playbooks + subjects for domain
    Promise.all([
      fetch(`/api/playbooks?domainId=${selectedDomainId}`).then((r) => r.json()),
      fetch(`/api/domains/${selectedDomainId}`)
        .then((r) => r.json())
        .then((data) => data.domain?.subjects || []),
    ])
      .then(([pbData, subjects]) => {
        if (pbData.ok && pbData.playbooks) {
          const pbs: PlaybookInfo[] = pbData.playbooks.map(
            (pb: { id: string; name: string; config?: { teachingMode?: TeachingMode } }) => ({
              id: pb.id,
              name: pb.name,
              teachingMode: pb.config?.teachingMode,
            })
          );
          setPlaybooks(pbs);

          // Derive ExistingCourseInfo for PackUploadStep
          setExistingCourses(
            pbData.playbooks.map(
              (pb: {
                id: string;
                name: string;
                status: string;
                subjects?: Array<{ subject?: { _count?: { sources?: number; assertions?: number } } }>;
              }) => ({
                id: pb.id,
                name: pb.name,
                status: pb.status,
                subjectCount: pb.subjects?.length ?? 0,
                assertionCount:
                  pb.subjects?.reduce(
                    (sum: number, s: { subject?: { _count?: { assertions?: number } } }) =>
                      sum + (s.subject?._count?.assertions ?? 0),
                    0
                  ) ?? 0,
              })
            )
          );
        }

        // Build ExistingSubjectInfo
        const subjList: ExistingSubjectInfo[] = subjects.map(
          (s: {
            subject?: {
              id?: string;
              name?: string;
              sources?: Array<{ source?: { _count?: { assertions?: number } } }>;
            };
          }) => ({
            id: s.subject?.id ?? "",
            name: s.subject?.name ?? "Untitled",
            sourceCount: s.subject?.sources?.length ?? 0,
            assertionCount:
              s.subject?.sources?.reduce(
                (sum: number, src: { source?: { _count?: { assertions?: number } } }) =>
                  sum + (src.source?._count?.assertions ?? 0),
                0
              ) ?? 0,
          })
        );
        setExistingSubjects(subjList.filter((s) => s.id));

        // If no playbooks, jump straight to new-course form
        if (!pbData.playbooks || pbData.playbooks.length === 0) {
          setShowNewCourseForm(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPlaybooks(false));
  }, [selectedDomainId, sectionStatus.course]);

  // ── Course type suggestion from name ──────────────────
  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    const name = newCourseName.trim();
    if (name.length < 3) { setSuggestedMode(null); return; }

    // Instant keyword match
    const keywordHit = suggestTeachingMode(name);
    if (keywordHit) { setSuggestedMode(keywordHit); return; }

    // AI fallback — debounce 600ms, only for longer names
    if (name.length < 10) { setSuggestedMode(null); return; }
    suggestTimerRef.current = setTimeout(() => {
      fetch("/api/courses/suggest-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseName: name }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.mode && data.confidence >= 0.5) {
            setSuggestedMode(data.mode);
          } else {
            setSuggestedMode(null);
          }
        })
        .catch(() => setSuggestedMode(null));
    }, 600);

    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current); };
  }, [newCourseName]);

  // Auto-select the suggested mode so the recommended item is pre-selected
  useEffect(() => {
    if (suggestedMode) setTeachingMode(suggestedMode);
  }, [suggestedMode]);

  const selectedDomain = domains.find((d) => d.id === selectedDomainId);

  const handleSelectPlaybook = useCallback(
    (pb: PlaybookInfo) => {
      setSelectedPlaybookId(pb.id);
      if (pb.teachingMode) setTeachingMode(pb.teachingMode);
      setShowNewCourseForm(false);
    },
    []
  );

  const handleDeselectPlaybook = useCallback(() => {
    setSelectedPlaybookId(null);
    setShowNewCourseForm(false);
  }, []);

  const handleNewCourseConfirm = useCallback(() => {
    if (!newCourseName.trim()) return;
    setSelectedPlaybookId(null); // will be created at launch
    completeSection("course");
  }, [newCourseName, completeSection]);

  const selectedPlaybook = playbooks.find((p) => p.id === selectedPlaybookId);

  const courseSummary = selectedPlaybookId
    ? `${selectedPlaybook?.name ?? "Course"} · ${TEACHING_MODE_LABELS[teachingMode].label}`
    : newCourseName
      ? `New: ${newCourseName}${subjectDiscipline ? ` · ${subjectDiscipline}` : ""} · ${TEACHING_MODE_LABELS[teachingMode].label}`
      : null;

  // ── Section 3 — Goal ──────────────────────────────

  const [goalText, setGoalText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const [tunerPills, setTunerPills] = useState<AgentTunerPill[]>([]);
  useUnsavedGuard(goalText.trim().length > 0 || !!selectedDomainId);
  const lastSuggestText = useRef("");
  const suggestFetchId = useRef(0);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(
    async (text: string) => {
      if (!selectedDomainId || text.length < 10) return;
      if (text === lastSuggestText.current && suggestions.length > 0) return;
      lastSuggestText.current = text;
      const id = ++suggestFetchId.current;

      // Abort any in-flight request
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 12_000); // 12s client safety net (server: 10s)

      setLoadingSuggestions(true);
      setSuggestionsError(false);
      try {
        const params = new URLSearchParams({ domainId: selectedDomainId, currentGoal: text });
        const res = await fetch(`/api/demonstrate/suggest?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (id !== suggestFetchId.current) return;
        if (data.ok && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        } else {
          setSuggestionsError(true);
        }
      } catch (e) {
        if (id !== suggestFetchId.current) return;
        if ((e as Error).name !== "AbortError") {
          console.warn("[TeachWizard] Suggest API failed:", e);
        }
        setSuggestionsError(true);
      } finally {
        clearTimeout(timeout);
        if (id === suggestFetchId.current) setLoadingSuggestions(false);
      }
    },
    [selectedDomainId, suggestions.length]
  );

  const handleTunerChange = useCallback((output: AgentTunerOutput) => {
    setTunerPills(output.pills);
  }, []);

  // ── Section 4 (Upload) + Section 5 (Review) ───────

  const [contentDone, setContentDone] = useState(false);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [extractionInProgress, setExtractionInProgress] = useState(false);
  const [extractionTimedOut, setExtractionTimedOut] = useState(false);
  const [contentGroups, setContentGroups] = useState<ContentGroup[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const extractPollRef = useRef<NodeJS.Timeout | null>(null);
  const extractionStartRef = useRef<number>(0);
  const lastPollCountRef = useRef<number>(0);

  // Two-phase extraction (task-based polling, two-phase)
  const [extractionTaskId, setExtractionTaskId] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState({ current: 0, total: 0, extracted: 0 });
  const [extractElapsed, setExtractElapsed] = useState(0);
  const [quickPreview, setQuickPreview] = useState<Array<{ text: string; category: string }>>([]);
  const [uploadSourceCount, setUploadSourceCount] = useState(0);

  // Classification state (from analyze manifest)
  const [classifications, setClassifications] = useState<
    Array<{ fileName: string; documentType: string; confidence: number; reasoning: string }>
  >([]);
  const [classificationCorrected, setClassificationCorrected] = useState(false);

  // Knowledge Map (progressive — appears when structuring completes)
  const [knowledgeMapSources, setKnowledgeMapSources] = useState<SourceTree[] | null>(null);
  const [knowledgeMapStats, setKnowledgeMapStats] = useState<KnowledgeMapStats | null>(null);
  const knowledgeMapFetchedRef = useRef(false);

  // Poll for extraction completion then load categories (Bug Fix B: every 5s)
  const startExtractionPoll = useCallback(
    (domainId: string, sIds: string[]) => {
      if (extractPollRef.current) clearInterval(extractPollRef.current);
      extractionStartRef.current = Date.now();
      lastPollCountRef.current = 0;
      setExtractionTimedOut(false);

      const checkExtraction = async () => {
        // Client-side timeout: 3 minutes max poll
        const elapsed = Date.now() - extractionStartRef.current;
        if (elapsed > 3 * 60_000) {
          clearInterval(extractPollRef.current!);
          extractPollRef.current = null;
          setExtractionTimedOut(true);
          // Don't clear extractionInProgress — UI shows timeout escape
          return;
        }

        try {
          const qs = sIds.length ? `?subjectIds=${sIds.join(",")}` : "";
          const res = await fetch(`/api/domains/${domainId}/content-stats${qs}`);
          const data = await res.json();
          const totalCount = (data.assertionCount || 0) + (data.questionCount || 0) + (data.vocabularyCount || 0) + (data.mediaCount || 0);
          if (data.allExtracted) {
            clearInterval(extractPollRef.current!);
            extractPollRef.current = null;
            setExtractionInProgress(false);
            lastPollCountRef.current = totalCount;
            loadCategoryGroups(domainId, sIds);
          } else if (totalCount > 0 && totalCount !== lastPollCountRef.current) {
            // New content found — reload groups (skip if count unchanged to prevent jumping)
            lastPollCountRef.current = totalCount;
            loadCategoryGroups(domainId, sIds);
          }
          // Update the live point count even without reloading groups
          if (totalCount > 0) setContentTotal(totalCount);

          // Check for structured content (pyramid) — fetch knowledge map once
          if (data.structuredSourceCount > 0 && !knowledgeMapFetchedRef.current) {
            knowledgeMapFetchedRef.current = true;
            fetch(`/api/domains/${domainId}/knowledge-map${qs}`)
              .then((r) => r.json())
              .then((km) => {
                if (km.ok && km.sources?.length > 0) {
                  setKnowledgeMapSources(km.sources);
                  setKnowledgeMapStats(km.stats);
                }
              })
              .catch(() => {}); // Non-critical — fail silently
          }
        } catch {
          // keep polling
        }
      };

      checkExtraction();
      extractPollRef.current = setInterval(checkExtraction, 5000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teachingMode]
  );

  const loadCategoryGroups = useCallback(
    async (domainId: string, sIds: string[]) => {
      setLoadingCategories(true);
      try {
        const qs = sIds.length ? `?subjectIds=${sIds.join(",")}` : "";
        const res = await fetch(`/api/domains/${domainId}/content-categories${qs}`);
        const data = await res.json();
        if (data.ok && data.categories) {
          const groups: ContentGroup[] = data.categories
            .filter((c: { category: string; count: number }) => c.count > 0)
            .map((c: { category: string; count: number }) => {
              const method = categoryToTeachMethod(c.category, teachingMode);
              const weight = intentCategoryWeights[teachingMode][c.category] ?? 1;
              return {
                category: c.category,
                count: c.count,
                originalCount: c.count,
                teachMethod: method,
                included: weight >= 2,
                groupType: "assertion" as const,
                expanded: false,
                items: null,
                loadingItems: false,
                itemError: null,
              };
            });

          // Add question groups (one per questionType)
          if (data.questions?.length) {
            for (const q of data.questions as Array<{ questionType: string; count: number }>) {
              if (q.count > 0) {
                groups.push({
                  category: q.questionType.toLowerCase(),
                  count: q.count,
                  originalCount: q.count,
                  teachMethod: questionTypeToTeachMethod(q.questionType),
                  included: true,
                  groupType: "question",
                  expanded: false,
                  items: null,
                  loadingItems: false,
                  itemError: null,
                });
              }
            }
          }

          // Add vocabulary group
          if (data.vocabularyCount > 0) {
            groups.push({
              category: "vocabulary",
              count: data.vocabularyCount,
              originalCount: data.vocabularyCount,
              teachMethod: "definition_matching" as TeachMethod,
              included: true,
              groupType: "vocabulary",
              expanded: false,
              items: null,
              loadingItems: false,
              itemError: null,
            });
          }

          // Add visual aids group (extracted figures/diagrams)
          if (data.mediaCount > 0) {
            groups.push({
              category: "visual_aid",
              count: data.mediaCount,
              originalCount: data.mediaCount,
              teachMethod: "direct_instruction" as TeachMethod,
              included: true,
              groupType: "visual_aid",
              expanded: false,
              items: null,
              loadingItems: false,
              itemError: null,
            });
          }

          // Sort: included first, then by count desc
          groups.sort((a, b) => {
            if (a.included !== b.included) return a.included ? -1 : 1;
            return b.count - a.count;
          });
          setContentGroups(groups);
          setContentTotal(data.total + (data.vocabularyCount ?? 0));
        }
      } catch {
        setContentError("Could not load content categories — try refreshing");
      } finally {
        setLoadingCategories(false);
      }
    },
    [teachingMode]
  );

  // Clean up poll on unmount
  useEffect(() => {
    return () => {
      if (extractPollRef.current) clearInterval(extractPollRef.current);
    };
  }, []);

  // ── Extraction polling via useTaskPoll (two-phase, two-phase) ──
  useTaskPoll({
    taskId: extractionTaskId,
    intervalMs: 2000,
    onProgress: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      setExtractProgress({
        current: ctx.currentChunk || 0,
        total: ctx.totalChunks || 0,
        extracted: ctx.extractedCount || 0,
      });
      if (ctx.quickPreview?.length > 0) {
        setQuickPreview((prev) => prev.length === 0 ? ctx.quickPreview : prev);
      }
    }, []),
    onComplete: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      setExtractionTaskId(null);
      setQuickPreview([]);
      const count = ctx.importedCount || ctx.extractedCount || 0;
      setContentTotal(count);

      // Update subjectIds from task context (response had empty subjects
      // because they're created inside backgroundRun after the 202 response)
      const taskSubjectIds: string[] = ctx.subjects?.length
        ? ctx.subjects.map((s: { id: string }) => s.id)
        : subjectIds;
      if (ctx.subjects?.length) {
        setSubjectIds(taskSubjectIds);
      }

      // The ingest task tracks upload + source creation, but extraction
      // runs fire-and-forget per file. Start content-stats poll to wait
      // for assertions to actually appear in the DB.
      if (selectedDomainId) {
        startExtractionPoll(selectedDomainId, taskSubjectIds);
      } else {
        setExtractionInProgress(false);
      }
    }, [selectedDomainId, subjectIds, startExtractionPoll]),
    onError: useCallback((msg: string) => {
      setExtractionTaskId(null);
      setExtractionInProgress(false);
      setContentError(msg);
    }, []),
  });

  // Elapsed time counter while extraction task is running
  useEffect(() => {
    if (!extractionTaskId) { setExtractElapsed(0); return; }
    const interval = setInterval(() => setExtractElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [extractionTaskId]);

  // ── Post-extraction wiring (demo mode) ──────────────
  // After assertions are extracted, scaffold domain → generate content spec → compose prompt
  const runPostExtractionWiring = useCallback(async () => {
    if (!selectedDomainId) return;
    setAutoWiring(true);
    const warnings: string[] = [];
    let moduleCount = 0;
    let contentSpecGenerated = false;
    let promptComposed = false;
    const timeout = () => AbortSignal.timeout(WIRING_FETCH_TIMEOUT_MS);

    // Scaffold (idempotent — ensures playbook exists)
    try {
      await fetch(`/api/domains/${selectedDomainId}/scaffold`, { method: "POST", signal: timeout() });
    } catch (e: unknown) {
      console.warn("[TeachWizard] Scaffold failed (non-critical):", e);
      warnings.push("Domain scaffold failed — content spec may not be linked to playbook");
    }

    // Generate content spec (demo mode only — teach mode uses lesson plan step)
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
        warnings.push(...specData.result.skipped);
        contentSpecGenerated = true;
      } else if (specData.error) {
        warnings.push(`Curriculum: ${specData.error}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error && e.name === "TimeoutError" ? "Curriculum generation timed out" : "Curriculum generation failed";
      console.warn("[TeachWizard] Content spec generation failed:", e);
      warnings.push(msg);
    }

    // Compose prompt (even if spec generation failed — per-turn RAG can still find assertions)
    if (selectedCallerId) {
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
        console.warn("[TeachWizard] Prompt composition failed:", e);
        warnings.push(msg);
      }
    }

    setAutoWireResult({ moduleCount, contentSpecGenerated, promptComposed, warnings });
    setAutoWiring(false);
  }, [selectedDomainId, selectedCallerId]);

  // Trigger auto-wiring when extraction finishes in demo mode
  const prevExtracting = useRef(false);
  useEffect(() => {
    const wasExtracting = prevExtracting.current;
    prevExtracting.current = extractionInProgress;
    if (isDemo && wasExtracting && !extractionInProgress && contentTotal > 0) {
      runPostExtractionWiring();
    }
  }, [isDemo, extractionInProgress, contentTotal, runPostExtractionWiring]);

  // ── Fetch readiness (demo mode launch) ─────────────
  const fetchReadiness = useCallback(async () => {
    if (!selectedDomainId) return;
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
        setReadinessScore(data.score ?? 0);
        setReadinessLevel(data.level ?? "incomplete");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.warn("[TeachWizard] Readiness fetch failed:", e);
    } finally {
      if (!controller.signal.aborted) setChecksLoading(false);
    }
  }, [selectedDomainId, selectedCallerId]);

  // Fetch readiness when launch section activates in demo mode
  useEffect(() => {
    if (isDemo && sectionStatus.launch === "active" && selectedDomainId) {
      fetchReadiness();
    }
  }, [isDemo, sectionStatus.launch, selectedDomainId, fetchReadiness]);

  // ── handlePackResult — auto-advances from Upload to Review ──
  const handlePackResult = useCallback(
    (result: PackUploadResult) => {
      if (result.mode === "skip") {
        // Skip both upload AND review — go straight to next section
        setSectionStatus((prev) => ({
          ...prev,
          upload: "done" as SectionStatus,
          review: "done" as SectionStatus,
          [isDemo ? "launch" : "lesson-plan"]: "active" as SectionStatus,
        }));
        return;
      }

      const newSubjectIds: string[] = [];
      if (result.subjectId) newSubjectIds.push(result.subjectId);
      if (result.subjects?.length) {
        result.subjects.forEach((s) => {
          if (!newSubjectIds.includes(s.id)) newSubjectIds.push(s.id);
        });
      }
      setSubjectIds(newSubjectIds);
      setContentDone(true);
      setUploadSourceCount(result.sourceCount ?? 0);

      // Capture classification info for the review card
      if (result.classifications?.length) {
        setClassifications(result.classifications);
        setClassificationCorrected(false);
      }

      if (result.mode === "pack-upload") {
        // Start extraction: prefer task-based polling (two-phase UI)
        setExtractionInProgress(true);
        if (result.taskId) {
          setExtractionTaskId(result.taskId);
        } else if (selectedDomainId) {
          // Fallback: no taskId, use content-stats polling
          startExtractionPoll(selectedDomainId, newSubjectIds);
        }
      } else {
        // existing course or subject — content already extracted
        if (selectedDomainId) {
          loadCategoryGroups(selectedDomainId, newSubjectIds);
        }
      }

      // Auto-advance: complete upload, open review
      completeSection("upload");
    },
    [selectedDomainId, completeSection, startExtractionPoll, loadCategoryGroups]
  );

  // ── Method badge strip state ──────────────────────
  const [focusedMethod, setFocusedMethod] = useState<TeachMethod | null>(null);
  const [hoveredMethod, setHoveredMethod] = useState<TeachMethod | null>(null);

  type MethodBadge = {
    method: TeachMethod;
    label: string;
    icon: string;
    count: number;        // total items across matching groups
    groupCount: number;   // how many groups use this method
    active: boolean;      // at least one included group uses this method
  };

  const methodBadges = useMemo<MethodBadge[]>(() => {
    if (contentGroups.length === 0) return [];
    const map = new Map<TeachMethod, { count: number; groupCount: number; active: boolean }>();
    for (const g of contentGroups) {
      const cfg = TEACH_METHOD_CONFIG[g.teachMethod];
      if (!cfg) continue; // skip invalid methods (e.g. direct_instruction)
      const prev = map.get(g.teachMethod) || { count: 0, groupCount: 0, active: false };
      map.set(g.teachMethod, {
        count: prev.count + g.count,
        groupCount: prev.groupCount + 1,
        active: prev.active || g.included,
      });
    }
    return Array.from(map.entries())
      .map(([method, { count, groupCount, active }]) => ({
        method,
        label: TEACH_METHOD_CONFIG[method].label,
        icon: TEACH_METHOD_CONFIG[method].icon,
        count,
        groupCount,
        active,
      }))
      .sort((a, b) => b.count - a.count);
  }, [contentGroups]);

  type MethodPopover = {
    method: TeachMethod;
    label: string;
    icon: string;
    totalCount: number;
    categories: Array<{ label: string; icon: string; count: number }>;
    preview: string[];    // first 3 items (text) from loaded groups
  };

  const methodPopoverData = useMemo<MethodPopover | null>(() => {
    if (!hoveredMethod) return null;
    const cfg = TEACH_METHOD_CONFIG[hoveredMethod];
    if (!cfg) return null;
    const matchingGroups = contentGroups.filter((g) => g.teachMethod === hoveredMethod);
    const categories = matchingGroups.map((g) => ({
      label: categoryLabel(g.category),
      icon: categoryIcon(g.category),
      count: g.count,
    }));
    const totalCount = matchingGroups.reduce((sum, g) => sum + g.count, 0);
    const preview: string[] = [];
    for (const g of matchingGroups) {
      if (preview.length >= 3) break;
      if (g.items) {
        for (const item of g.items) {
          if (preview.length >= 3) break;
          if (!item.excluded) preview.push(item.text.length > 80 ? item.text.slice(0, 80) + "\u2026" : item.text);
        }
      }
    }
    return { method: hoveredMethod, label: cfg.label, icon: cfg.icon, totalCount, categories, preview };
  }, [hoveredMethod, contentGroups]);

  const toggleMethodFocus = useCallback((method: TeachMethod) => {
    setFocusedMethod((prev) => (prev === method ? null : method));
  }, []);

  const toggleGroup = useCallback((category: string) => {
    setContentGroups((prev) =>
      prev.map((g) =>
        g.category === category ? { ...g, included: !g.included } : g
      )
    );
  }, []);

  const setGroupMethod = useCallback((category: string, method: TeachMethod) => {
    setContentGroups((prev) =>
      prev.map((g) => (g.category === category ? { ...g, teachMethod: method } : g))
    );
  }, []);

  // Expandable row handlers
  const fetchGroupItems = useCallback(
    async (category: string, groupType: string) => {
      setContentGroups((prev) =>
        prev.map((g) =>
          g.category === category ? { ...g, loadingItems: true, itemError: null } : g
        )
      );
      try {
        const qs = new URLSearchParams({
          ...(subjectIds.length ? { subjectIds: subjectIds.join(",") } : {}),
          groupType,
          category,
          limit: "100",
        });
        const res = await fetch(`/api/domains/${selectedDomainId}/content-detail?${qs}`);
        const data = await res.json();
        if (data.ok) {
          setContentGroups((prev) =>
            prev.map((g) =>
              g.category === category
                ? {
                    ...g,
                    items: (data.items as Array<{ id: string; term?: string; definition?: string; text?: string; questionType?: string; partOfSpeech?: string; figureRef?: string; pageNumber?: number; url?: string }>).map(
                      (item) => ({
                        id: item.id,
                        text:
                          groupType === "vocabulary"
                            ? `${item.term} — ${item.definition || ""}`
                            : item.text || "",
                        excluded: false,
                        meta:
                          groupType === "visual_aid"
                            ? item.pageNumber ? `p.${item.pageNumber}` : undefined
                            : item.questionType || item.partOfSpeech || undefined,
                      })
                    ),
                    loadingItems: false,
                  }
                : g
            )
          );
        } else {
          throw new Error(data.error || "Failed to load");
        }
      } catch {
        setContentGroups((prev) =>
          prev.map((g) =>
            g.category === category
              ? { ...g, loadingItems: false, itemError: "Couldn't load items" }
              : g
          )
        );
      }
    },
    [subjectIds, selectedDomainId]
  );

  const toggleExpand = useCallback(
    (category: string) => {
      setContentGroups((prev) =>
        prev.map((g) => {
          if (g.category !== category) return g;
          if (g.expanded) return { ...g, expanded: false };
          // Fetch items if not loaded
          if (g.items === null) fetchGroupItems(g.category, g.groupType);
          return { ...g, expanded: true };
        })
      );
    },
    [fetchGroupItems]
  );

  const toggleItemExclude = useCallback((category: string, itemId: string) => {
    setContentGroups((prev) =>
      prev.map((g) => {
        if (g.category !== category || !g.items) return g;
        const updatedItems = g.items.map((item) =>
          item.id === itemId ? { ...item, excluded: !item.excluded } : item
        );
        const excludedCount = updatedItems.filter((i) => i.excluded).length;
        return {
          ...g,
          items: updatedItems,
          count: g.originalCount - excludedCount,
        };
      })
    );
  }, []);

  const includedGroups = contentGroups.filter((g) => g.included);
  const canContinueContent = includedGroups.length > 0;

  // Bug Fix C: count from assertions, not source count
  const totalIncludedTPs = includedGroups.reduce((s, g) => s + g.count, 0);

  const visualAidGroup = includedGroups.find((g) => g.groupType === "visual_aid");
  const visualAidSuffix = visualAidGroup ? `, ${visualAidGroup.count} visual aid${visualAidGroup.count !== 1 ? "s" : ""}` : "";
  const contentSummary = contentGroups.length > 0
    ? `${totalIncludedTPs} item${totalIncludedTPs !== 1 ? "s" : ""}${visualAidSuffix} · ${includedGroups.length} group${includedGroups.length !== 1 ? "s" : ""} included`
    : "No content selected";

  // ── Section 5 — Lesson Plan ────────────────────────

  const [lessonPlan, setLessonPlan] = useState<LessonPlanItem[]>([]);
  const [lessonPlanLoading, setLessonPlanLoading] = useState(false);
  const [lessonPlanError, setLessonPlanError] = useState<string | null>(null);
  const lessonPlanLoadingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [expandedLessons, setExpandedLessons] = useState<Set<string>>(new Set());

  const toggleLessonExpand = useCallback((id: string) => {
    setExpandedLessons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build lookup map: assertion/question/vocab ID → display text
  const tpLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of contentGroups) {
      if (!g.items) continue;
      for (const item of g.items) {
        if (!item.excluded) map.set(item.id, item.text);
      }
    }
    return map;
  }, [contentGroups]);

  // Fallback: naive generation from included groups (escape route)
  const fallbackGenerateLessonPlan = useCallback(() => {
    const included = contentGroups.filter((g) => g.included);
    const methodGroups: Record<TeachMethod, ContentGroup[]> = {} as Record<
      TeachMethod,
      ContentGroup[]
    >;
    for (const g of included) {
      if (!methodGroups[g.teachMethod]) methodGroups[g.teachMethod] = [];
      methodGroups[g.teachMethod].push(g);
    }
    const lessons: LessonPlanItem[] = Object.entries(methodGroups).map(
      ([method, groups], i) => {
        const tpCount = groups.reduce((s, g) => s + g.count, 0);
        const tpIds = groups.flatMap((g) =>
          g.items?.filter((item) => !item.excluded).map((item) => item.id) ?? []
        );
        const methodCfg = TEACH_METHOD_CONFIG[method as TeachMethod];
        return {
          id: `lesson-${i + 1}`,
          sessionNumber: i + 1,
          title: methodCfg?.label ?? method,
          sessionType: "introduce" as const,
          tpCount,
          tpIds,
          durationMins: estimateDuration(tpCount),
          objectives: [],
          editing: false,
        };
      }
    );
    setLessonPlan(lessons);
  }, [contentGroups]);

  // API-backed lesson plan generation
  const fetchLessonPlan = useCallback(async () => {
    if (!subjectIds.length) {
      fallbackGenerateLessonPlan();
      return;
    }
    // Delay spinner by 300ms to prevent flash on fast responses
    clearTimeout(lessonPlanLoadingTimer.current);
    lessonPlanLoadingTimer.current = setTimeout(() => setLessonPlanLoading(true), 300);
    setLessonPlanError(null);
    try {
      const res = await fetch("/api/lesson-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectIds, sessionLength: 15, lessonPlanModel }),
      });
      const data = await res.json();
      if (
        data.ok &&
        data.plan?.sessions?.length
      ) {
        setLessonPlan(
          data.plan.sessions.map(
            (s: { sessionNumber: number; title: string; sessionType: string; assertionIds?: string[]; questionIds?: string[]; vocabularyIds?: string[]; estimatedMinutes: number; objectives?: string[] }, i: number) => {
              const ids = [
                ...(s.assertionIds ?? []),
                ...(s.questionIds ?? []),
                ...(s.vocabularyIds ?? []),
              ];
              return {
                id: `lesson-${i + 1}`,
                sessionNumber: s.sessionNumber,
                title: s.title,
                sessionType:
                  s.sessionType === "practice"
                    ? "deepen"
                    : (s.sessionType as LessonPlanItem["sessionType"]),
                tpCount: ids.length || (s.assertionIds?.length ?? 0) + (s.questionIds?.length ?? 0),
                tpIds: ids,
                durationMins: s.estimatedMinutes,
                objectives: s.objectives ?? [],
                editing: false,
              };
            }
          )
        );
      } else {
        // API returned no sessions — fall back to naive
        fallbackGenerateLessonPlan();
      }
    } catch {
      setLessonPlanError(
        "Couldn't generate lesson plan — using simple grouping"
      );
      fallbackGenerateLessonPlan();
    } finally {
      clearTimeout(lessonPlanLoadingTimer.current);
      setLessonPlanLoading(false);
    }
  }, [subjectIds, lessonPlanModel, fallbackGenerateLessonPlan]);

  // Auto-generate when section 5 becomes active
  useEffect(() => {
    if (
      sectionStatus["lesson-plan"] === "active" &&
      lessonPlan.length === 0 &&
      !lessonPlanLoading
    ) {
      fetchLessonPlan();
    }
  }, [sectionStatus, fetchLessonPlan, lessonPlan.length, lessonPlanLoading]);

  const updateLessonTitle = useCallback(
    (id: string, title: string) => {
      setLessonPlan((prev) =>
        prev.map((l) => (l.id === id ? { ...l, title } : l))
      );
    },
    []
  );

  const toggleLessonEdit = useCallback((id: string) => {
    setLessonPlan((prev) =>
      prev.map((l) => (l.id === id ? { ...l, editing: !l.editing } : l))
    );
  }, []);

  const removeLesson = useCallback((id: string) => {
    setLessonPlan((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const addLesson = useCallback(() => {
    setLessonPlan((prev) => [
      ...prev,
      {
        id: `lesson-new-${Date.now()}`,
        sessionNumber: prev.length + 1,
        title: "New lesson",
        sessionType: "introduce" as const,
        tpCount: 0,
        tpIds: [],
        durationMins: 15,
        objectives: [],
        editing: true,
      },
    ]);
  }, []);

  const lessonSummary =
    lessonPlan.length > 0
      ? `${lessonPlan.length} lesson${lessonPlan.length !== 1 ? "s" : ""} · ${totalIncludedTPs} teaching point${totalIncludedTPs !== 1 ? "s" : ""}`
      : "No lessons planned";

  // ── Section 6 — Launch ─────────────────────────────

  const [learnerName, setLearnerName] = useState("");
  const [learnerEmail, setLearnerEmail] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchPhase, setLaunchPhase] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);

  const handleLaunch = useCallback(async () => {
    if (!selectedDomainId || launching) return;
    setLaunching(true);
    setLaunchError(null);

    try {
      // 1. Scaffold domain (idempotent — ensures playbook exists)
      setLaunchPhase("Setting up course...");
      const scaffoldRes = await fetch(
        `/api/domains/${selectedDomainId}/scaffold`,
        { method: "POST" }
      );
      const scaffoldData = await scaffoldRes.json().catch(() => null);
      let playbookId =
        selectedPlaybookId ?? scaffoldData?.result?.playbook?.id ?? null;

      // 2. If new course: create Playbook + link
      if (!selectedPlaybookId && newCourseName.trim()) {
        setLaunchPhase("Creating course...");
        const res = await fetch("/api/playbooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newCourseName.trim(),
            domainId: selectedDomainId,
            config: {
              teachingMode,
              subjectDiscipline: subjectDiscipline.trim().toLowerCase() || null,
            },
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to create course");
        playbookId = data.playbook?.id ?? playbookId;
      } else if (selectedPlaybookId) {
        // Update teachingMode on existing playbook if changed
        setLaunchPhase("Updating course intent...");
        await fetch(`/api/playbooks/${selectedPlaybookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { teachingMode } }),
        }).catch(() => {}); // non-critical
      }

      // 3. Link subjects to playbook
      if (playbookId && subjectIds.length > 0) {
        await fetch(`/api/playbooks/${playbookId}/subjects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectIds }),
        }).catch(() => {});
      }

      // 3b. Persist lesson plan to curriculum (non-blocking, non-fatal)
      if (subjectIds.length > 0 && lessonPlan.length > 0) {
        try {
          setLaunchPhase("Saving curriculum...");
          const currRes = await fetch(`/api/curricula?subjectId=${subjectIds[0]}`);
          const currData = await currRes.json();
          let curriculumId = currData.curricula?.[0]?.id;

          if (!curriculumId) {
            const createRes = await fetch("/api/curricula", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: `${newCourseName || selectedPlaybook?.name || "Course"} Curriculum`,
                subjectId: subjectIds[0],
                domainId: selectedDomainId,
              }),
            });
            const createData = await createRes.json();
            curriculumId = createData.curriculum?.id;
          }

          if (curriculumId) {
            await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entries: lessonPlan.map((l, i) => ({
                  session: i + 1,
                  type: l.sessionType,
                  moduleId: null,
                  moduleLabel: l.title,
                  label: l.title,
                  estimatedDurationMins: l.durationMins,
                  assertionCount: l.tpCount,
                })),
              }),
            });
          }
        } catch {
          // Curriculum save failed — not fatal, sim still works
          console.warn("[TeachWizard] Failed to persist curriculum — continuing");
        }
      }

      // 4. Create caller
      setLaunchPhase("Creating learner profile...");
      const callerRes = await fetch(`/api/callers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: learnerName.trim() || randomFakeName(),
          email: learnerEmail.trim() || undefined,
          domainId: selectedDomainId,
          ...(playbookId && { playbookId }),
        }),
      });
      const callerData = await callerRes.json();
      if (!callerData.ok || !callerData.caller?.id) {
        throw new Error(callerData.error || "Failed to create learner");
      }
      const callerId = callerData.caller.id;

      // 5. Create goal
      if (goalText.trim()) {
        setLaunchPhase("Saving goal...");
        await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callerId,
            name: goalText.trim(),
            type: "LEARN",
          }),
        }).catch(() => {}); // non-critical
      }

      // 6. Open sim
      setLaunchPhase("Opening simulator...");
      const params = new URLSearchParams();
      params.set("domainId", selectedDomainId);
      if (goalText.trim()) params.set("goal", goalText.trim());
      if (playbookId) params.set("playbookId", playbookId);
      if (tunerPills.length > 0) {
        params.set("tunerPills", JSON.stringify(tunerPills));
      }
      router.push(`/x/sim/${callerId}?${params.toString()}`);
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
      setLaunching(false);
      setLaunchPhase("");
    }
  }, [
    selectedDomainId,
    selectedPlaybookId,
    selectedPlaybook,
    newCourseName,
    teachingMode,
    subjectIds,
    lessonPlan,
    learnerName,
    learnerEmail,
    goalText,
    tunerPills,
    launching,
    router,
  ]);

  // Demo launch: redirect to sim with existing caller (no creation)
  const handleDemoLaunch = useCallback(() => {
    if (!selectedCallerId || !selectedDomainId) return;
    const params = new URLSearchParams();
    params.set("domainId", selectedDomainId);
    if (goalText.trim()) params.set("goal", goalText.trim());
    router.push(`/x/sim/${selectedCallerId}?${params.toString()}`);
  }, [selectedCallerId, selectedDomainId, goalText, router]);

  // ── Start Over ────────────────────────────────────
  const hasMadeProgress = sectionStatus.institution === "done";
  const handleStartOver = useCallback(() => {
    setSectionStatus({
      institution: "active", course: "locked", goal: "locked",
      upload: "locked", review: "locked", "lesson-plan": "locked", launch: "locked",
    });
    setSelectedDomainId("");
    setNewDomainName("");
    setSelectedCallerId("");
    setCallers([]);
    setGoalText("");
    setSelectedPlaybookId(null);
    setShowNewCourseForm(false);
    setNewCourseName("");
    setSubjectIds([]);
    setContentDone(false);
    setContentGroups([]);
    setContentTotal(0);
    setExtractionInProgress(false);
    setExtractionTaskId(null);
    setExtractionTimedOut(false);
    setQuickPreview([]);
    setExtractProgress({ current: 0, total: 0, extracted: 0 });
    setExtractElapsed(0);
    setContentError(null);
    setUploadSourceCount(0);
    setKnowledgeMapSources(null);
    setAutoWireResult(null);
    setChecks([]);
    setReady(false);
    setReadinessScore(0);
    setReadinessLevel("incomplete");
    setLaunchError(null);
    setLaunching(false);
    setLaunchPhase("");
    setLearnerName("");
    setLearnerEmail("");
    setPromptPreviewExpanded(false);
  }, []);

  // ── Render ─────────────────────────────────────────

  return (
    <div className="tw-page">
      {/* Hero */}
      <div className="tw-hero">
        <span className="tw-hero-icon">{isDemo ? "🎬" : "👨‍🏫"}</span>
        <h1 className="tw-hero-title">{isDemo ? "Demonstrate" : "Teach"}</h1>
        {hasMadeProgress && (
          <button className="tw-start-over" onClick={handleStartOver} type="button">
            Start Over
          </button>
        )}
      </div>

      <div className="tw-sections">
        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 1 — Where are you teaching?       */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="institution"
          stepNumber={1}
          status={sectionStatus.institution}
          title={isDemo ? "Where are you demonstrating?" : "Where are you teaching?"}
          hint={isDemo
            ? "Choose the institution and caller for this demonstration."
            : "Choose the school or organisation you're teaching in."}
          summaryLabel="Institution"
          summary={
            isDemo && selectedCallerId
              ? `${selectedDomain?.name ?? newDomainName} · ${callers.find((c) => c.id === selectedCallerId)?.name ?? "Caller"}`
              : selectedDomain?.name ?? newDomainName
          }
          onEdit={() => editSection("institution")}
        >
          <FieldHint label={terms.domain} hint={WIZARD_HINTS["teach.institution"]} />
          {loadingDomains ? (
            <div className="tw-loading">
              <span className="tw-spinner" /> Loading institutions...
            </div>
          ) : domains.length === 0 ? (
            <div className="tw-empty-state">
              <p className="tw-hint">
                No institutions yet.{" "}
                {canCreateInstitution
                  ? "Create one to get started."
                  : "Ask your admin to set one up."}
              </p>
              {canCreateInstitution && (
                <button
                  className="tw-chip tw-chip-new tw-mt-sm"
                  onClick={() => setShowCreateModal(true)}
                  type="button"
                >
                  <Plus size={14} /> New institution
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="tw-domain-row">
                <FancySelect
                  options={domains.map((d): FancySelectOption => ({
                    value: d.id,
                    label: d.name,
                    subtitle: d.institution?.type?.name ?? d.slug,
                  }))}
                  value={selectedDomainId}
                  onChange={(val) => { if (val) handleSelectDomain(val); }}
                  placeholder="Select an institution..."
                  searchable={domains.length > 5}
                />
                {canCreateInstitution && (
                  <button
                    className="tw-chip tw-chip-new"
                    onClick={() => setShowCreateModal(true)}
                    type="button"
                  >
                    <Plus size={14} /> New
                  </button>
                )}
              </div>

              {/* Caller selection — demo mode only */}
              {isDemo && selectedDomainId && (
                <div className="tw-caller-row">
                  <label className="tw-label">
                    <User size={14} /> Test Caller
                  </label>
                  {loadingCallers ? (
                    <div className="tw-loading">
                      <span className="tw-spinner" /> Loading callers...
                    </div>
                  ) : callers.length === 0 ? (
                    <p className="tw-hint">No callers in this institution yet.</p>
                  ) : (
                    <FancySelect
                      options={callers.map((c): FancySelectOption => ({
                        value: c.id,
                        label: c.name ?? c.email ?? "Unknown",
                        subtitle: c.email ?? undefined,
                      }))}
                      value={selectedCallerId}
                      onChange={(val) => { if (val) handleSelectCaller(val); }}
                      placeholder="Select a caller..."
                      searchable={callers.length > 5}
                    />
                  )}
                </div>
              )}

              {/* Continue button for demo mode (need both domain + caller) */}
              {isDemo && selectedDomainId && selectedCallerId && (
                <button
                  className="tw-btn tw-btn-primary tw-mt-md"
                  onClick={handleCompleteInstitution}
                  type="button"
                >
                  Continue <ChevronRight size={16} />
                </button>
              )}
            </>
          )}

          <CreateInstitutionModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onCreated={(newDomain) => {
              setDomains((prev) => [
                ...prev,
                { id: newDomain.id, slug: newDomain.slug, name: newDomain.name },
              ]);
              setNewDomainName(newDomain.name);
              setSelectedDomainId(newDomain.id);
              setShowCreateModal(false);
              if (!isDemo) completeSection("institution");
            }}
          />
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 2 — What are you teaching? (Teach mode only) */}
        {/* ═══════════════════════════════════════════ */}
        {!isDemo && <WizardSection
          id="course"
          stepNumber={2}
          status={sectionStatus.course}
          title="What are you teaching?"
          hint="Choose an existing course or create a new one. Tell us what kind of course it is — this shapes how content is organised and how lessons are structured."
          summaryLabel="Course"
          summary={courseSummary}
          onEdit={() => editSection("course")}
        >
          {loadingPlaybooks ? (
            <div className="tw-loading">
              <span className="tw-spinner" /> Loading courses...
            </div>
          ) : (
            <>
              {playbooks.length > 0 && (
                <div className="tw-chip-grid">
                  {playbooks.map((pb) => {
                    const mode = pb.teachingMode ?? "recall";
                    const modeLabel = TEACHING_MODE_LABELS[mode];
                    const isSelected = selectedPlaybookId === pb.id && !showNewCourseForm;
                    return (
                      <button
                        key={pb.id}
                        className={`tw-chip ${isSelected ? "tw-chip-selected" : ""}`}
                        onClick={() => isSelected ? handleDeselectPlaybook() : handleSelectPlaybook(pb)}
                        type="button"
                      >
                        {pb.name}
                        <span className="tw-intent-badge">
                          {modeLabel.icon} {modeLabel.label}
                        </span>
                        {isSelected && (
                          <span
                            className="tw-chip-remove"
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleDeselectPlaybook(); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); handleDeselectPlaybook(); } }}
                            aria-label="Remove course selection"
                          >
                            <XIcon size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    className="tw-chip tw-chip-new"
                    onClick={() => {
                      setShowNewCourseForm(true);
                      setSelectedPlaybookId(null);
                    }}
                    type="button"
                  >
                    <Plus size={14} /> New course
                  </button>
                </div>
              )}

              {/* New course form */}
              {(showNewCourseForm || playbooks.length === 0) && (
                <div className="tw-inline-form">
                  <div>
                    <p className="tw-label">Course name</p>
                    <input
                      className="tw-input"
                      type="text"
                      placeholder="e.g. GCSE Biology, Year 9 History..."
                      value={newCourseName}
                      onChange={(e) => setNewCourseName(e.target.value)}
                    />
                  </div>

                  <div>
                    <p className="tw-label">Subject area <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span></p>
                    {/* Quick-pick chips: first 6 from catalog */}
                    {subjectCatalog.length > 0 && (
                      <div className="tw-chip-grid" style={{ marginBottom: 8 }}>
                        {subjectCatalog.slice(0, 6).map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={`tw-chip${subjectDiscipline === s.value ? " tw-chip-selected" : ""}`}
                            onClick={() => {
                              setSubjectDiscipline((prev) => (prev === s.value ? "" : s.value));
                              setSubjectSearch("");
                              setSubjectDropdownOpen(false);
                            }}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Searchable subject picker */}
                    <div ref={subjectDropdownRef} style={{ position: "relative" }}>
                      <input
                        className="tw-input"
                        type="text"
                        placeholder={subjectDiscipline
                          ? (subjectCatalog.find((s) => s.value === subjectDiscipline)?.label || subjectDiscipline)
                          : "Search subjects..."}
                        value={subjectSearch}
                        onChange={(e) => {
                          setSubjectSearch(e.target.value);
                          setSubjectDropdownOpen(true);
                        }}
                        onFocus={() => setSubjectDropdownOpen(true)}
                      />
                      {subjectDiscipline && !subjectSearch && (
                        <button
                          type="button"
                          onClick={() => { setSubjectDiscipline(""); setSubjectSearch(""); }}
                          style={{
                            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                            background: "none", border: "none", cursor: "pointer",
                            color: "var(--text-muted)", padding: 4, lineHeight: 1,
                          }}
                        >
                          <XIcon size={14} />
                        </button>
                      )}
                      {subjectDropdownOpen && (() => {
                        const query = subjectSearch.toLowerCase().trim();
                        const filtered = query
                          ? subjectCatalog.filter((s) =>
                              s.label.toLowerCase().includes(query) ||
                              s.category.toLowerCase().includes(query))
                          : subjectCatalog;
                        const grouped = new Map<string, typeof subjectCatalog>();
                        for (const s of filtered) {
                          const list = grouped.get(s.category) ?? [];
                          list.push(s);
                          grouped.set(s.category, list);
                        }
                        const hasExactMatch = filtered.some((s) => s.value === query || s.label.toLowerCase() === query);
                        return (
                          <div className="tw-subject-dropdown">
                            {filtered.length === 0 && !subjectAllowFreeText && (
                              <div className="tw-subject-empty">No matching subjects</div>
                            )}
                            {Array.from(grouped.entries()).map(([category, items]) => (
                              <div key={category}>
                                <div className="tw-subject-category">{category}</div>
                                {items.map((s) => (
                                  <button
                                    key={s.value}
                                    type="button"
                                    className={`tw-subject-option${subjectDiscipline === s.value ? " tw-subject-option-selected" : ""}`}
                                    onClick={() => {
                                      setSubjectDiscipline(s.value);
                                      setSubjectSearch("");
                                      setSubjectDropdownOpen(false);
                                    }}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            ))}
                            {subjectAllowFreeText && query && !hasExactMatch && (
                              <button
                                type="button"
                                className="tw-subject-option tw-subject-free-text"
                                onClick={() => {
                                  setSubjectDiscipline(query);
                                  setSubjectSearch("");
                                  setSubjectDropdownOpen(false);
                                }}
                              >
                                Use &ldquo;{subjectSearch.trim()}&rdquo; as subject
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Subject Teaching Profile banner */}
                  {(() => {
                    const profileKey = suggestTeachingProfile(subjectDiscipline || newCourseName);
                    const profile = profileKey ? getTeachingProfile(profileKey) : null;
                    if (!profile) return null;
                    return (
                      <div className="hf-banner hf-banner-info hf-mb-sm" style={{ marginTop: 8 }}>
                        <div className="hf-text-sm hf-text-bold hf-mb-xs">
                          Subject Teaching Approach: {profile.key}
                        </div>
                        <div className="hf-text-sm hf-mb-xs">
                          {profile.description}
                        </div>
                        <div className="hf-text-xs hf-text-muted">
                          This comes from the subject. You can override it below with the Agent Tuner.
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <p className="tw-label">What kind of course is this?</p>
                    <div className="tw-intent-picker">
                      {TEACHING_MODE_ORDER.map((mode) => {
                        const cfg = TEACHING_MODE_LABELS[mode];
                        const isSuggested = suggestedMode === mode && teachingMode !== mode;
                        return (
                          <button
                            key={mode}
                            className={`tw-intent-card ${teachingMode === mode ? "tw-intent-card-selected" : ""} ${isSuggested ? "tw-intent-card-suggested" : ""}`}
                            onClick={() => setTeachingMode(mode)}
                            type="button"
                          >
                            <div className="tw-intent-card-icon">{cfg.icon}</div>
                            <div className="tw-intent-card-label">
                              {cfg.label}
                              {suggestedMode === mode && <span className="tw-suggested-badge">Suggested</span>}
                            </div>
                            <div className="tw-intent-card-examples">{cfg.examples}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="tw-label" style={{ marginTop: 16 }}>Lesson plan model</p>
                    <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
                  </div>

                  <div className="tw-continue-row">
                    <button
                      className="tw-btn-continue"
                      onClick={handleNewCourseConfirm}
                      disabled={!newCourseName.trim()}
                      type="button"
                    >
                      Confirm course <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* For existing course: allow changing intent for this session */}
              {selectedPlaybookId && !showNewCourseForm && (
                <div style={{ marginTop: 12 }}>
                  <p className="tw-label">Teaching approach for this session</p>
                  <div className="tw-intent-picker">
                    {TEACHING_MODE_ORDER.map((mode) => {
                      const cfg = TEACHING_MODE_LABELS[mode];
                      return (
                        <button
                          key={mode}
                          className={`tw-intent-card ${teachingMode === mode ? "tw-intent-card-selected" : ""}`}
                          onClick={() => setTeachingMode(mode)}
                          type="button"
                        >
                          <div className="tw-intent-card-icon">{cfg.icon}</div>
                          <div className="tw-intent-card-label">{cfg.label}</div>
                          <div className="tw-intent-card-examples">{cfg.examples}</div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <p className="tw-label">Lesson plan model</p>
                    <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
                  </div>

                  <div className="tw-continue-row">
                    <button
                      className="tw-btn-continue"
                      onClick={() => completeSection("course")}
                      type="button"
                    >
                      Confirm <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </WizardSection>}

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 3 — What do students need to achieve? */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="goal"
          stepNumber={isDemo ? 2 : 3}
          status={sectionStatus.goal}
          title="What do students need to achieve?"
          hint="What should students be able to do or understand by the end? We'll suggest goals based on your content."
          summaryLabel="Goal"
          summary={goalText || undefined}
          onEdit={() => editSection("goal")}
          aiEnhanced
          aiLoading={loadingSuggestions}
        >
          <FieldHint label="Session Goal" hint={WIZARD_HINTS["teach.goal"]} />
          <textarea
            className="tw-textarea"
            rows={3}
            placeholder="e.g. Students can recall the key facts and vocabulary from this topic"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            onBlur={() => {
              if (goalText.trim().length >= 10) fetchSuggestions(goalText.trim());
            }}
          />

          {/* AI suggestions */}
          {(loadingSuggestions || suggestions.length > 0 || suggestionsError) && (
            <div>
              <p className="tw-hint" style={{ marginBottom: 6 }}>
                Suggestions:
              </p>
              {loadingSuggestions ? (
                <div className="tw-loading">
                  <span className="tw-spinner" /> Generating suggestions...
                </div>
              ) : suggestions.length > 0 ? (
                <div className="tw-suggestions">
                  {suggestions.slice(0, 4).map((s, i) => (
                    <button
                      key={i}
                      className="tw-suggestion-chip"
                      onClick={() => setGoalText(s)}
                      type="button"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : suggestionsError ? (
                <div className="tw-suggestions">
                  <button
                    className="tw-suggestion-chip"
                    onClick={() => { lastSuggestText.current = ""; fetchSuggestions(goalText.trim()); }}
                    type="button"
                  >
                    Retry suggestions
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* AgentTuner (behavior pills — no Boston Matrix) */}
          <div style={{ marginTop: 16 }}>
            <AgentTuner
              initialPills={tunerPills}
              context={{
                domainName: selectedDomain?.name,
              }}
              onChange={handleTunerChange}
              label="AI personality (optional)"
            />
          </div>

          <div className="tw-continue-row">
            <button
              className="tw-btn-continue"
              onClick={() => completeSection("goal")}
              disabled={!goalText.trim()}
              type="button"
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 4 — Upload source materials        */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="upload"
          stepNumber={isDemo ? 3 : 4}
          status={sectionStatus.upload}
          title="Add your source materials"
          hint="Upload a textbook chapter, worksheet, or lesson notes. You can skip this and add materials later."
          summaryLabel="Upload"
          summary={
            uploadSourceCount > 0
              ? `${uploadSourceCount} file${uploadSourceCount !== 1 ? "s" : ""} uploaded`
              : subjectIds.length > 0
                ? "Content selected"
                : undefined
          }
          onEdit={() => editSection("upload")}
        >
          <FieldHint label="Course Materials" hint={WIZARD_HINTS["teach.content"]} />
          {selectedDomainId && (
            <PackUploadStep
              domainId={selectedDomainId}
              domainSlug={selectedDomain?.slug}
              courseName={
                selectedPlaybook?.name ?? newCourseName ?? goalText ?? "Course"
              }
              interactionPattern={suggestInteractionPattern(selectedPlaybook?.name ?? newCourseName ?? goalText ?? "") ?? undefined}
              teachingMode={teachingMode}
              subjectDiscipline={subjectDiscipline || undefined}
              existingCourses={existingCourses}
              existingSubjects={existingSubjects}
              onResult={handlePackResult}
            />
          )}
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 5 — Review your content            */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="review"
          stepNumber={isDemo ? 4 : 5}
          status={sectionStatus.review}
          title="Review your content"
          hint="Check what we found in your materials. Toggle groups on/off and choose how each should be taught."
          summaryLabel="Content"
          summary={contentSummary}
          onEdit={() => editSection("review")}
        >
          {/* Classification card — shows what AI identified the files as */}
          {classifications.length > 0 && (
            <div className="tw-classify-card">
              {classifications.map((c, idx) => {
                const info = getDocTypeInfo(c.documentType);
                const Icon = info.icon;
                const confPct = Math.round(c.confidence * 100);
                const confLevel = confPct >= 80 ? "high" : confPct >= 50 ? "medium" : "low";
                return (
                  <div key={idx} className="tw-classify-item">
                    <div className={`tw-classify-icon-box tw-classify-icon--${confLevel}`}>
                      <Icon size={20} />
                    </div>
                    <div className="tw-classify-body">
                      <div className="tw-classify-header">
                        <span className="tw-classify-type-label">{info.label}</span>
                        <span className={`tw-classify-confidence tw-classify-conf--${confLevel}`}>
                          {confPct}%
                        </span>
                      </div>
                      <div className="tw-classify-file">{c.fileName}</div>
                      <div className="tw-classify-desc">{info.description}</div>
                    </div>
                    <div className="tw-classify-actions">
                      <select
                        className="tw-classify-select"
                        value={c.documentType}
                        onChange={(e) => {
                          setClassifications(prev =>
                            prev.map((cl, i) =>
                              i === idx
                                ? { ...cl, documentType: e.target.value, confidence: 1.0, reasoning: "Corrected by teacher" }
                                : cl
                            )
                          );
                          setClassificationCorrected(true);
                        }}
                      >
                        {Object.entries(DOC_TYPE_INFO).map(([value, typeInfo]) => (
                          <option key={value} value={value}>{typeInfo.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
              {classificationCorrected && (
                <div className="tw-classify-corrected-note">
                  Classification corrected — this will be used for extraction.
                </div>
              )}
            </div>
          )}

          {/* Two-phase extraction progress (task-based, pack-upload path) */}
          {extractionInProgress && extractionTaskId && !extractionTimedOut && (
            <div className="tw-extraction-progress">
              {quickPreview.length > 0 ? (
                <div className="tw-quick-preview-wrap">
                  <div className="tw-extract-status">
                    <div className="tw-quick-preview-dot" />
                    <span className="tw-extract-label">
                      Quick scan — {quickPreview.length} key points found
                    </span>
                  </div>
                  <div className="tw-quick-preview-list">
                    {quickPreview.map((item, i) => (
                      <div key={i} className="tw-quick-preview-item">
                        <span className="tw-quick-preview-num">{i + 1}</span>
                        <span className="tw-quick-preview-text">{item.text}</span>
                        <span className="tw-quick-preview-cat">{item.category}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="tw-extract-status">
                  <span className="tw-spinner" />
                  <span className="tw-extract-label">Scanning document...</span>
                  <span className="tw-extract-elapsed">{extractElapsed}s</span>
                </div>
              )}

              {quickPreview.length > 0 && (
                <div className="tw-extract-status" style={{ marginTop: 8 }}>
                  <span className="tw-spinner" />
                  <span className="tw-extract-label">Enriching with full details...</span>
                  <span className="tw-extract-elapsed">{extractElapsed}s</span>
                </div>
              )}
              <div className="tw-progress-track">
                <div
                  className={`tw-progress-fill${
                    extractProgress.total === 0 && quickPreview.length === 0
                      ? " tw-progress-fill--indeterminate"
                      : ""
                  }`}
                  style={{
                    width: extractProgress.total > 0
                      ? `${Math.round((extractProgress.current / extractProgress.total) * 100)}%`
                      : undefined,
                  }}
                />
              </div>
              <div className="tw-progress-labels">
                <span>{extractProgress.extracted} teaching points extracted</span>
                {extractProgress.total > 0 && (
                  <span>Chunk {extractProgress.current}/{extractProgress.total}</span>
                )}
              </div>
            </div>
          )}

          {/* Fallback extraction progress (content-stats polling, no taskId) */}
          {extractionInProgress && !extractionTaskId && !extractionTimedOut && (
            <div className="tw-banner-info" style={{ marginBottom: 12 }}>
              <span className="tw-spinner" style={{ marginTop: 1 }} />
              <span>
                Extracting teaching points from your materials...{" "}
                {contentTotal > 0 && (
                  <strong>{contentTotal} found so far</strong>
                )}
              </span>
            </div>
          )}

          {/* Extraction timeout escape */}
          {extractionTimedOut && (
            <div className="tw-banner-warning" style={{ marginBottom: 12 }}>
              <div>
                Extraction is taking longer than expected.
                {contentGroups.length > 0 && (
                  <span> We found {contentTotal} teaching points so far.</span>
                )}
              </div>
              <div className="tw-timeout-actions">
                <button
                  className="tw-btn-continue"
                  style={{ fontSize: 12, padding: "6px 12px" }}
                  onClick={() => {
                    setExtractionInProgress(false);
                    setExtractionTimedOut(false);
                  }}
                  type="button"
                >
                  Continue with what we have
                </button>
                <button
                  className="tw-btn-back"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    setExtractionTimedOut(false);
                    if (selectedDomainId) {
                      startExtractionPoll(selectedDomainId, subjectIds);
                    }
                  }}
                  type="button"
                >
                  Keep waiting
                </button>
              </div>
            </div>
          )}

          {/* Category group review */}
          {contentGroups.length > 0 && (
            <>
              {contentError && (
                <div className="tw-banner-error" style={{ marginBottom: 8 }}>
                  {contentError}
                </div>
              )}

              <p className="tw-hint" style={{ marginBottom: 8, marginTop: extractionInProgress ? 0 : 12 }}>
                What are you teaching from this content? Tick the groups to include
                in your lesson plan.
              </p>

              {/* ── Method badge strip ───────────────────── */}
              {methodBadges.length > 1 && (
                <div className="tw-method-strip">
                  <span className="tw-method-strip-label">Filter by method:</span>
                  {methodBadges.map((b) => {
                    const isFocused = focusedMethod === b.method;
                    const isDimmed = focusedMethod !== null && !isFocused;
                    return (
                      <div
                        key={b.method}
                        className="tw-method-badge-wrap"
                        onMouseEnter={() => setHoveredMethod(b.method)}
                        onMouseLeave={() => setHoveredMethod(null)}
                      >
                        <button
                          type="button"
                          className={[
                            "tw-method-badge",
                            b.active ? "tw-method-badge--active" : "tw-method-badge--inactive",
                            isFocused ? "tw-method-badge--focused" : "",
                            isDimmed ? "tw-method-badge--dimmed" : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => toggleMethodFocus(b.method)}
                        >
                          <span className="tw-method-badge-icon">{b.icon}</span>
                          <span className="tw-method-badge-label">{b.label}</span>
                          <span className="tw-method-badge-count">{b.count}</span>
                        </button>

                        {/* Popover on hover */}
                        {hoveredMethod === b.method && methodPopoverData && (
                          <div className="tw-method-popover">
                            <div className="tw-method-popover-header">
                              <span>{methodPopoverData.icon}</span>
                              <strong>{methodPopoverData.label}</strong>
                              <span className="tw-method-popover-total">{methodPopoverData.totalCount} items</span>
                            </div>
                            {methodPopoverData.categories.length > 0 && (
                              <div className="tw-method-popover-cats">
                                {methodPopoverData.categories.map((cat) => (
                                  <div key={cat.label} className="tw-method-popover-cat">
                                    <span>{cat.icon}</span>
                                    <span>{cat.label}</span>
                                    <span className="tw-method-popover-cat-count">{cat.count}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {methodPopoverData.preview.length > 0 && (
                              <div className="tw-method-popover-preview">
                                {methodPopoverData.preview.map((text, i) => (
                                  <div key={i} className="tw-method-popover-preview-item">
                                    <span className="tw-method-popover-preview-num">{i + 1}</span>
                                    <span>{text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {methodPopoverData.preview.length === 0 && (
                              <div className="tw-method-popover-hint">
                                Expand a group below to see items
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {focusedMethod && (
                    <button
                      type="button"
                      className="tw-method-badge tw-method-badge--clear"
                      onClick={() => setFocusedMethod(null)}
                    >
                      <XIcon size={12} />
                      <span className="tw-method-badge-label">Clear</span>
                    </button>
                  )}
                </div>
              )}

              <div className="tw-group-list">
                {contentGroups.map((g) => {
                  const matchesFocus = focusedMethod === null || g.teachMethod === focusedMethod;
                  return (
                  <div key={g.category}>
                    <div
                      className={[
                        "tw-group-row",
                        !g.included ? "tw-group-row-unchecked" : "",
                        focusedMethod && matchesFocus ? "tw-group-row-focused" : "",
                        focusedMethod && !matchesFocus ? "tw-group-row-dimmed" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => toggleExpand(g.category)}
                      style={{ cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        className="tw-group-check"
                        checked={g.included}
                        onChange={(e) => { e.stopPropagation(); toggleGroup(g.category); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="tw-group-icon">{categoryIcon(g.category)}</span>
                      <span className="tw-group-name">{categoryLabel(g.category)}</span>
                      <span className="tw-group-count">
                        {g.count} {countLabel(g)}
                      </span>
                      <div className="tw-group-method" onClick={(e) => e.stopPropagation()}>
                        <select
                          className="tw-method-select"
                          value={g.teachMethod}
                          onChange={(e) =>
                            setGroupMethod(g.category, e.target.value as TeachMethod)
                          }
                          disabled={!g.included}
                        >
                          {(
                            Object.entries(TEACH_METHOD_CONFIG) as [
                              TeachMethod,
                              (typeof TEACH_METHOD_CONFIG)[TeachMethod],
                            ][]
                          ).map(([method, cfg]) => (
                            <option key={method} value={method}>
                              {cfg.icon} {cfg.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={`hf-chevron--sm${g.expanded ? " hf-chevron--open" : ""}`}>
                        <ChevronRight size={14} />
                      </div>
                    </div>

                    {/* Expanded items */}
                    {g.expanded && (
                      <div className="tw-group-items">
                        {g.loadingItems && (
                          <div className="tw-group-items-loading">
                            <span className="tw-spinner" /> Loading...
                          </div>
                        )}
                        {g.itemError && (
                          <div className="tw-banner-error tw-group-items-error">
                            {g.itemError}
                          </div>
                        )}
                        {g.items && g.items.length === 0 && (
                          <div className="tw-group-items-empty">No items found</div>
                        )}
                        {g.items && g.items.length > 0 && (
                          <div className="tw-group-items-scroll">
                            {g.items.map((item) => (
                              <div
                                key={item.id}
                                className={`tw-group-item ${item.excluded ? "tw-group-item-excluded" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={!item.excluded}
                                  onChange={() => toggleItemExclude(g.category, item.id)}
                                  className="tw-group-item-check"
                                />
                                <span className="tw-group-item-text">{item.text}</span>
                                {item.meta && (
                                  <span className="tw-group-item-meta">{item.meta}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              {/* Knowledge Map — appears progressively when structuring completes */}
              {knowledgeMapSources && knowledgeMapSources.length > 0 && (
                <KnowledgeMapAccordion
                  sources={knowledgeMapSources}
                  stats={knowledgeMapStats}
                />
              )}

              {!canContinueContent && (
                <div className="tw-banner-warning" style={{ marginTop: 8 }}>
                  Select at least one group to continue.
                </div>
              )}
            </>
          )}

          {/* No categories yet + not extracting */}
          {!extractionInProgress && contentGroups.length === 0 && !loadingCategories && (
            <div className="tw-banner-warning" style={{ marginTop: 8 }}>
              No teaching points found yet. Try a different file or wait for extraction.
            </div>
          )}

          {loadingCategories && (
            <div className="tw-loading" style={{ marginTop: 8 }}>
              <span className="tw-spinner" /> Loading content breakdown...
            </div>
          )}

          {/* Continue — always available, even during extraction */}
          <div className="tw-continue-row">
            {extractionInProgress && contentGroups.length > 0 && (
              <span className="tw-hint" style={{ marginRight: "auto" }}>
                You can continue now — extraction will finish in the background.
              </span>
            )}
            <button
              className="tw-btn-continue"
              disabled={!canContinueContent && !extractionInProgress}
              onClick={() => completeSection("review")}
              type="button"
            >
              {extractionInProgress && contentGroups.length > 0
                ? <>Continue with what we have <ChevronRight size={16} /></>
                : <>Continue <ChevronRight size={16} /></>}
            </button>
          </div>
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 6 — How should lessons be structured? (Teach mode only) */}
        {/* ═══════════════════════════════════════════ */}
        {!isDemo && <WizardSection
          id="lesson-plan"
          stepNumber={6}
          status={sectionStatus["lesson-plan"]}
          title="How should lessons be structured?"
          hint="Here's a suggested lesson plan based on your content. Rename or remove lessons as needed."
          summaryLabel="Lessons"
          summary={lessonSummary}
          onEdit={() => editSection("lesson-plan")}
        >
          {lessonPlanLoading ? (
            <div className="tw-loading">
              <span className="tw-spinner" /> Generating lesson plan from your content...
            </div>
          ) : lessonPlan.length === 0 ? (
            <div className="tw-banner-warning" style={{ marginTop: 8 }}>
              No content to build lessons from.{" "}
              <button
                style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                onClick={() => editSection("upload")}
                type="button"
              >
                Back to content
              </button>
            </div>
          ) : (
            <>
              {lessonPlanError && (
                <div className="tw-banner-warning" style={{ marginBottom: 8 }}>
                  {lessonPlanError}
                </div>
              )}

              <div className="tw-lesson-list">
                {lessonPlan.map((lesson, i) => {
                  const badge = SESSION_TYPE_STYLES[lesson.sessionType];
                  const isExpanded = expandedLessons.has(lesson.id);
                  const resolvedTps = lesson.tpIds
                    .map((id) => tpLookup.get(id))
                    .filter((t): t is string => !!t);
                  const hasExpandableTps = resolvedTps.length > 0;
                  return (
                    <div key={lesson.id} className="tw-lesson-item">
                      <div className="tw-lesson-row">
                        <div className="tw-lesson-number">{i + 1}</div>
                        <div className="tw-lesson-title-wrap">
                          {lesson.editing ? (
                            <input
                              className="tw-lesson-title-input"
                              value={lesson.title}
                              onChange={(e) =>
                                updateLessonTitle(lesson.id, e.target.value)
                              }
                              onBlur={() => toggleLessonEdit(lesson.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape")
                                  toggleLessonEdit(lesson.id);
                              }}
                              autoFocus
                            />
                          ) : (
                            <div className="tw-lesson-title">{lesson.title}</div>
                          )}
                          <button
                            className={`tw-lesson-meta${hasExpandableTps ? " tw-lesson-meta-expandable" : ""}`}
                            onClick={() => hasExpandableTps && toggleLessonExpand(lesson.id)}
                            type="button"
                          >
                            {lesson.durationMins} min · {lesson.tpCount} teaching point{lesson.tpCount !== 1 ? "s" : ""}
                            {hasExpandableTps && (
                              <span className={`hf-chevron--sm${isExpanded ? " hf-chevron--open" : ""}`}>
                                <ChevronRight size={12} />
                              </span>
                            )}
                          </button>
                          {lesson.objectives.length > 0 && (
                            <div className="tw-lesson-objectives">
                              {lesson.objectives.slice(0, 2).join("; ")}
                            </div>
                          )}
                        </div>
                        {badge && (
                          <span className={`tw-session-badge ${badge.className}`}>
                            {badge.label}
                          </span>
                        )}
                        <button
                          className="tw-lesson-edit-btn"
                          onClick={() => toggleLessonEdit(lesson.id)}
                          title="Rename"
                          type="button"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="tw-lesson-remove-btn"
                          onClick={() => removeLesson(lesson.id)}
                          title="Remove lesson"
                          type="button"
                        >
                          <XIcon size={13} />
                        </button>
                      </div>
                      {isExpanded && hasExpandableTps && (
                        <ul className="tw-lesson-tp-list">
                          {resolvedTps.map((text, j) => (
                            <li key={j} className="tw-lesson-tp-item">{text}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                className="tw-add-lesson-btn"
                onClick={addLesson}
                type="button"
              >
                <Plus size={14} /> Add lesson
              </button>

              <div className="tw-continue-row">
                <button
                  className="tw-btn-continue"
                  disabled={lessonPlan.length === 0}
                  onClick={() => completeSection("lesson-plan")}
                  type="button"
                >
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </WizardSection>}

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 7 — Ready                         */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="launch"
          stepNumber={isDemo ? 5 : 7}
          status={sectionStatus.launch}
          title={isDemo ? "Ready to demonstrate" : "Ready to teach"}
          hint={isDemo
            ? "Review your choices and start the demonstration."
            : "Review your choices and launch. Add an optional learner name to personalise the session."}
        >
          {isDemo ? (
            /* ── Demo mode launch ─────────────────────── */
            <>
              {/* Summary strip */}
              <div className="tw-summary-grid">
                <div className="tw-summary-row">
                  <span className="tw-summary-key"><Building2 size={14} /> Institution</span>
                  <span className="tw-summary-val">{selectedDomain?.name ?? "—"}</span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key"><User size={14} /> Caller</span>
                  <span className="tw-summary-val">
                    {callers.find((c) => c.id === selectedCallerId)?.name ?? "—"}
                  </span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key"><Target size={14} /> Goal</span>
                  <span className="tw-summary-val">{goalText || "—"}</span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Content</span>
                  <span className="tw-summary-val">{contentSummary}</span>
                </div>
              </div>

              {/* Auto-wiring progress */}
              {autoWiring && (
                <div className="tw-launch-phase">
                  <span className="tw-spinner" />
                  Preparing demonstration...
                </div>
              )}

              {/* Auto-wire result */}
              {autoWireResult && autoWireResult.warnings.length > 0 && (
                <div className="tw-banner-warning tw-mt-sm">
                  {autoWireResult.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

              {/* Readiness */}
              {checksLoading ? (
                <div className="tw-loading tw-mt-md">
                  <span className="tw-spinner" /> Checking readiness...
                </div>
              ) : checks.length > 0 && (
                <div className="tw-readiness tw-mt-md">
                  <div className="tw-readiness-header">
                    <span className={`tw-readiness-badge tw-readiness-badge--${readinessLevel}`}>
                      {readinessScore}%
                    </span>
                    <span className="tw-readiness-label">
                      {readinessLevel === "ready" ? "Ready" : readinessLevel === "almost" ? "Almost Ready" : "Incomplete"}
                    </span>
                  </div>
                  <div className="tw-readiness-checks">
                    {checks.map((check) => (
                      <div key={check.id} className="tw-readiness-check">
                        {check.passed
                          ? <CheckCircle2 size={14} className="tw-readiness-icon--pass" />
                          : <AlertTriangle size={14} className="tw-readiness-icon--fail" />}
                        <span className="tw-readiness-check-name">{check.name}</span>
                        <span className="tw-readiness-check-detail">{check.detail}</span>
                        {!check.passed && check.fixAction && (
                          <a href={check.fixAction.href} className="tw-readiness-fix">
                            {check.fixAction.label}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt preview accordion */}
              <div className="tw-prompt-preview-accordion tw-mt-md">
                <button
                  className="tw-prompt-preview-toggle"
                  onClick={() => setPromptPreviewExpanded((p) => !p)}
                  type="button"
                >
                  {promptPreviewExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Preview First Prompt
                </button>
                {selectedDomainId && (
                  <div className={`tw-prompt-preview-body${promptPreviewExpanded ? "" : " tw-hidden"}`}>
                    <PromptPreviewContent
                      domainId={selectedDomainId}
                      callerId={selectedCallerId || undefined}
                      open={promptPreviewExpanded}
                    />
                  </div>
                )}
              </div>

              {/* Demo launch button */}
              <button
                className="tw-btn-launch tw-mt-md"
                onClick={handleDemoLaunch}
                disabled={!selectedCallerId || !selectedDomainId || autoWiring}
                type="button"
              >
                <PlayCircle size={20} />
                {autoWiring ? "Preparing..." : "Start Lesson →"}
              </button>
            </>
          ) : (
            /* ── Teach mode launch ────────────────────── */
            <>
              {/* Summary */}
              <div className="tw-summary-grid">
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Institution</span>
                  <span className="tw-summary-val">
                    {selectedDomain?.name ?? newDomainName ?? "—"}
                  </span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Course</span>
                  <span className="tw-summary-val">
                    {courseSummary ?? "—"}
                  </span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Goal</span>
                  <span className="tw-summary-val">{goalText || "—"}</span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Upload</span>
                  <span className="tw-summary-val">
                    {uploadSourceCount > 0
                      ? `${uploadSourceCount} file${uploadSourceCount !== 1 ? "s" : ""}`
                      : subjectIds.length > 0 ? "Existing content" : "Skipped"}
                  </span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Content</span>
                  <span className="tw-summary-val">{contentSummary}</span>
                </div>
                <div className="tw-summary-row">
                  <span className="tw-summary-key">Lessons</span>
                  <span className="tw-summary-val">{lessonSummary}</span>
                </div>
              </div>

              {/* Learner details (optional) */}
              <div className="tw-learner-row">
                <div className="tw-learner-field">
                  <p className="tw-label">Learner name (optional)</p>
                  <input
                    className="tw-input"
                    type="text"
                    placeholder="e.g. Alex"
                    value={learnerName}
                    onChange={(e) => setLearnerName(e.target.value)}
                  />
                </div>
                <div className="tw-learner-field">
                  <p className="tw-label">Email (optional)</p>
                  <input
                    className="tw-input"
                    type="email"
                    placeholder="alex@example.com"
                    value={learnerEmail}
                    onChange={(e) => setLearnerEmail(e.target.value)}
                  />
                </div>
              </div>

              {launchError && (
                <div className="tw-banner-error tw-mt-sm">
                  {launchError}
                </div>
              )}

              {launchPhase && launching && (
                <div className="tw-launch-phase">
                  <span className="tw-spinner" />
                  {launchPhase}
                </div>
              )}

              <button
                className="tw-btn-launch"
                onClick={handleLaunch}
                disabled={!selectedDomainId || launching}
                type="button"
              >
                <PlayCircle size={20} />
                {launching ? launchPhase || "Launching..." : "Launch lesson →"}
              </button>
            </>
          )}
        </WizardSection>
      </div>
    </div>
  );
}

// ── Knowledge Map Accordion ─────────────────────────

function KnowledgeMapAccordion({
  sources,
  stats,
}: {
  sources: SourceTree[];
  stats: KnowledgeMapStats | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const topicCount = stats?.totalTopics ?? 0;

  return (
    <div className="tw-km-accordion" style={{ marginTop: 12 }}>
      <div
        className="tw-group-row"
        onClick={() => setExpanded((prev) => !prev)}
        style={{ cursor: "pointer" }}
      >
        <span className="tw-group-icon">🗺️</span>
        <span className="tw-group-name">Knowledge Map</span>
        <span className="tw-group-count">
          {topicCount} topic{topicCount !== 1 ? "s" : ""}
        </span>
        <div className={`hf-chevron--sm${expanded ? " hf-chevron--open" : ""}`}>
          <ChevronRight size={14} />
        </div>
      </div>
      {expanded && (
        <div className="tw-group-items" style={{ padding: 12 }}>
          <KnowledgeMapTree
            sources={sources}
            stats={stats ?? undefined}
            initialExpandDepth={1}
          />
        </div>
      )}
    </div>
  );
}
