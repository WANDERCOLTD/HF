"use client";

/**
 * TeachWizard — single-page progressive accordion for the Teach flow.
 *
 * 6 sections: institution → course (+ intent) → goal → content → lesson-plan → launch
 *
 * Design principles:
 * - SectionStatus state machine: locked / active / done
 * - CASCADE constant drives which sections re-lock when a prior section is edited
 * - All enum labels come from resolve-config.ts (no hardcodes in JSX)
 * - Bug fixes: A (no auto-advance after upload), B (5s poll during extraction),
 *   C (contentCount from assertions not sources), D (don't block lesson plan on extraction)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronRight,
  Plus,
  PlayCircle,
  Pencil,
  X as XIcon,
} from "lucide-react";
import { AgentTuner } from "@/components/shared/AgentTuner";
import type { AgentTunerOutput, AgentTunerPill } from "@/lib/agent-tuner/types";
import WizardSection, { type SectionStatus } from "@/components/shared/WizardSection";
import WizardProgress from "@/components/shared/WizardProgress";
import { PackUploadStep } from "./PackUploadStep";
import type { PackUploadResult } from "./PackUploadStep";
import { CreateInstitutionModal } from "./CreateInstitutionModal";
import {
  TEACHING_MODE_LABELS,
  TEACHING_MODE_ORDER,
  TEACH_METHOD_CONFIG,
  categoryToTeachMethod,
  intentCategoryWeights,
  type TeachingMode,
  type TeachMethod,
} from "@/lib/content-trust/resolve-config";
import "./teach-wizard.css";

// ── Constants ───────────────────────────────────────

const SECTION_ORDER = [
  "institution",
  "course",
  "goal",
  "content",
  "lesson-plan",
  "launch",
] as const;

type SectionId = (typeof SECTION_ORDER)[number];

const CASCADE: Record<SectionId, SectionId[]> = {
  institution: ["course", "goal", "content", "lesson-plan", "launch"],
  course: ["content", "lesson-plan"],
  goal: [],
  content: ["lesson-plan"],
  "lesson-plan": [],
  launch: [],
};

// ── Types ───────────────────────────────────────────

type DomainInfo = { id: string; slug: string; name: string };
type PlaybookInfo = {
  id: string;
  name: string;
  teachingMode?: TeachingMode;
};

type ContentGroup = {
  category: string;
  count: number;
  teachMethod: TeachMethod;
  included: boolean;
};

type LessonPlan = {
  id: string;
  title: string;
  method: TeachMethod;
  tpCount: number;
  durationMins: number;
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
  };
  return map[category] ?? "📌";
}

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function estimateDuration(tpCount: number): number {
  // ~3 min per teaching point
  return Math.max(10, Math.round((tpCount * 3) / 5) * 5);
}

// ── Component ───────────────────────────────────────

export default function TeachWizard() {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const canCreateInstitution = ["OPERATOR", "ADMIN", "SUPERADMIN"].includes(
    (sessionData?.user as { role?: string })?.role || ""
  );

  // ── Section status ─────────────────────────────────

  const [sectionStatus, setSectionStatus] = useState<Record<SectionId, SectionStatus>>({
    institution: "active",
    course: "locked",
    goal: "locked",
    content: "locked",
    "lesson-plan": "locked",
    launch: "locked",
  });

  const completeSection = useCallback((id: SectionId) => {
    setSectionStatus((prev) => {
      const next = { ...prev, [id]: "done" as SectionStatus };
      const idx = SECTION_ORDER.indexOf(id);
      if (idx < SECTION_ORDER.length - 1) {
        const nextId = SECTION_ORDER[idx + 1];
        next[nextId] = "active";
      }
      return next;
    });
  }, []);

  const editSection = useCallback((id: SectionId) => {
    setSectionStatus((prev) => {
      const next = { ...prev, [id]: "active" as SectionStatus };
      for (const dep of CASCADE[id]) {
        next[dep] = "locked";
      }
      return next;
    });
  }, []);

  // Derive the current active step number (1-indexed) for WizardProgress
  const activeStep =
    SECTION_ORDER.findIndex((s) => sectionStatus[s] === "active") + 1;

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
    fetch("/api/domains?onlyInstitution=true")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.domains) setDomains(data.domains);
      })
      .catch(() => {})
      .finally(() => setLoadingDomains(false));
  }, []);

  const handleSelectDomain = useCallback(
    (id: string) => {
      setSelectedDomainId(id);
      completeSection("institution");
    },
    [completeSection]
  );

  // ── Section 2 — Course + Intent ────────────────────

  const [playbooks, setPlaybooks] = useState<PlaybookInfo[]>([]);
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(false);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [showNewCourseForm, setShowNewCourseForm] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [teachingMode, setTeachingMode] = useState<TeachingMode>("recall");
  const [existingCourses, setExistingCourses] = useState<ExistingCourseInfo[]>([]);
  const [existingSubjects, setExistingSubjects] = useState<ExistingSubjectInfo[]>([]);

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

  const selectedDomain = domains.find((d) => d.id === selectedDomainId);

  const handleSelectPlaybook = useCallback(
    (pb: PlaybookInfo) => {
      setSelectedPlaybookId(pb.id);
      if (pb.teachingMode) setTeachingMode(pb.teachingMode);
      setShowNewCourseForm(false);
      completeSection("course");
    },
    [completeSection]
  );

  const handleNewCourseConfirm = useCallback(() => {
    if (!newCourseName.trim()) return;
    setSelectedPlaybookId(null); // will be created at launch
    completeSection("course");
  }, [newCourseName, completeSection]);

  const selectedPlaybook = playbooks.find((p) => p.id === selectedPlaybookId);

  const courseSummary = selectedPlaybookId
    ? `${selectedPlaybook?.name ?? "Course"} · ${TEACHING_MODE_LABELS[teachingMode].label}`
    : newCourseName
      ? `New: ${newCourseName} · ${TEACHING_MODE_LABELS[teachingMode].label}`
      : null;

  // ── Section 3 — Goal ──────────────────────────────

  const [goalText, setGoalText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [tunerPills, setTunerPills] = useState<AgentTunerPill[]>([]);
  const lastSuggestText = useRef("");
  const suggestFetchId = useRef(0);

  const fetchSuggestions = useCallback(
    async (text: string) => {
      if (!selectedDomainId || text.length < 10) return;
      if (text === lastSuggestText.current) return;
      lastSuggestText.current = text;
      const id = ++suggestFetchId.current;
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/api/domains/${selectedDomainId}/goal-suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (id === suggestFetchId.current && data.ok && data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch {
        // silent
      } finally {
        if (id === suggestFetchId.current) setLoadingSuggestions(false);
      }
    },
    [selectedDomainId]
  );

  const handleTunerChange = useCallback((output: AgentTunerOutput) => {
    setTunerPills(output.pills);
  }, []);

  // ── Section 4 — Content ────────────────────────────

  const [contentDone, setContentDone] = useState(false);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [extractionInProgress, setExtractionInProgress] = useState(false);
  const [contentGroups, setContentGroups] = useState<ContentGroup[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const extractPollRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for extraction completion then load categories (Bug Fix B: every 5s)
  const startExtractionPoll = useCallback(
    (domainId: string, sIds: string[]) => {
      if (extractPollRef.current) clearInterval(extractPollRef.current);

      const checkExtraction = async () => {
        try {
          const qs = sIds.length ? `?subjectIds=${sIds.join(",")}` : "";
          const res = await fetch(`/api/domains/${domainId}/content-stats${qs}`);
          const data = await res.json();
          if (data.allExtracted) {
            clearInterval(extractPollRef.current!);
            extractPollRef.current = null;
            setExtractionInProgress(false);
            loadCategoryGroups(domainId, sIds);
          } else if (data.assertionCount > 0) {
            // Have some TPs already — show partial groups
            loadCategoryGroups(domainId, sIds);
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
                teachMethod: method,
                included: weight >= 2, // checked by default if weight ≥ medium
              };
            });
          // Sort: included first, then by count desc
          groups.sort((a, b) => {
            if (a.included !== b.included) return a.included ? -1 : 1;
            return b.count - a.count;
          });
          setContentGroups(groups);
          setContentTotal(data.total);
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

  const handlePackResult = useCallback(
    (result: PackUploadResult) => {
      if (result.mode === "skip") {
        completeSection("content");
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

      if (result.mode === "pack-upload") {
        // Bug Fix A: do NOT auto-advance. Stay on Section 4.
        // Bug Fix B: start polling for extraction
        setExtractionInProgress(true);
        if (selectedDomainId) {
          startExtractionPoll(selectedDomainId, newSubjectIds);
        }
      } else {
        // existing course or subject — content already extracted
        if (selectedDomainId) {
          loadCategoryGroups(selectedDomainId, newSubjectIds);
        }
      }
    },
    [selectedDomainId, completeSection, startExtractionPoll, loadCategoryGroups]
  );

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

  const includedGroups = contentGroups.filter((g) => g.included);
  const canContinueContent = includedGroups.length > 0;

  // Bug Fix C: count from assertions, not source count
  const totalIncludedTPs = includedGroups.reduce((s, g) => s + g.count, 0);

  const contentSummary = contentGroups.length > 0
    ? `${totalIncludedTPs} teaching point${totalIncludedTPs !== 1 ? "s" : ""} · ${includedGroups.length} group${includedGroups.length !== 1 ? "s" : ""} included`
    : "No content selected";

  // ── Section 5 — Lesson Plan ────────────────────────

  const [lessonPlan, setLessonPlan] = useState<LessonPlan[]>([]);

  // Generate lesson plan from included groups
  const generateLessonPlan = useCallback(() => {
    const included = contentGroups.filter((g) => g.included);

    // Group by teachMethod for each lesson
    const methodGroups: Record<TeachMethod, ContentGroup[]> = {} as Record<
      TeachMethod,
      ContentGroup[]
    >;
    for (const g of included) {
      if (!methodGroups[g.teachMethod]) methodGroups[g.teachMethod] = [];
      methodGroups[g.teachMethod].push(g);
    }

    const lessons: LessonPlan[] = Object.entries(methodGroups).map(
      ([method, groups], i) => {
        const tpCount = groups.reduce((s, g) => s + g.count, 0);
        const methodCfg = TEACH_METHOD_CONFIG[method as TeachMethod];
        return {
          id: `lesson-${i + 1}`,
          title: methodCfg?.label ?? method,
          method: method as TeachMethod,
          tpCount,
          durationMins: estimateDuration(tpCount),
          editing: false,
        };
      }
    );

    setLessonPlan(lessons);
  }, [contentGroups]);

  // Auto-generate when section 5 becomes active (Bug Fix D: don't block on extraction)
  useEffect(() => {
    if (sectionStatus["lesson-plan"] === "active" && lessonPlan.length === 0) {
      generateLessonPlan();
    }
  }, [sectionStatus, generateLessonPlan, lessonPlan.length]);

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
            config: { teachingMode },
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

      // 4. Create caller
      setLaunchPhase("Creating learner profile...");
      const callerRes = await fetch(`/api/callers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: learnerName.trim() || "Learner",
          email: learnerEmail.trim() || undefined,
          domainId: selectedDomainId,
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
        await fetch(`/api/callers/${callerId}/goals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: goalText.trim(),
            type: "LEARN",
          }),
        }).catch(() => {}); // non-critical

        // Write teaching_mode as BehaviorTarget
        await fetch(`/api/callers/${callerId}/behavior-targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targets: { teaching_mode: teachingMode },
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
    newCourseName,
    teachingMode,
    subjectIds,
    learnerName,
    learnerEmail,
    goalText,
    tunerPills,
    launching,
    router,
  ]);

  // ── Render ─────────────────────────────────────────

  const activeStepLabel =
    activeStep > 0
      ? SECTION_ORDER[activeStep - 1]
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : "";

  return (
    <div className="tw-page">
      {/* Hero */}
      <div className="tw-hero">
        <span className="tw-hero-icon">👨‍🏫</span>
        <h1 className="tw-hero-title">Teach</h1>
      </div>

      {/* Progress bar */}
      <WizardProgress
        current={activeStep || 1}
        total={SECTION_ORDER.length}
        stepName={activeStepLabel}
      />

      <div className="tw-sections">
        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 1 — Where are you teaching?       */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="institution"
          stepNumber={1}
          status={sectionStatus.institution}
          title="Where are you teaching?"
          hint="Choose the school or organisation you're teaching in."
          summaryLabel="Institution"
          summary={selectedDomain?.name ?? newDomainName}
          onEdit={() => editSection("institution")}
        >
          {loadingDomains ? (
            <div className="tw-loading">
              <span className="tw-spinner" /> Loading institutions...
            </div>
          ) : domains.length === 0 ? (
            <p className="tw-hint" style={{ marginTop: 8 }}>
              No institutions yet.{" "}
              {canCreateInstitution
                ? "Create one to get started."
                : "Ask your admin to set one up."}
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="tw-input"
                style={{ maxWidth: 400 }}
                value={selectedDomainId}
                onChange={(e) => {
                  if (e.target.value) handleSelectDomain(e.target.value);
                }}
              >
                <option value="">Select an institution…</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {canCreateInstitution && (
                <button
                  className="tw-chip tw-chip-new"
                  onClick={() => setShowCreateModal(true)}
                  type="button"
                >
                  <Plus size={14} /> New institution
                </button>
              )}
            </div>
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
              completeSection("institution");
            }}
          />
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 2 — What are you teaching?        */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
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
                    return (
                      <button
                        key={pb.id}
                        className={`tw-chip ${selectedPlaybookId === pb.id && !showNewCourseForm ? "tw-chip-selected" : ""}`}
                        onClick={() => handleSelectPlaybook(pb)}
                        type="button"
                      >
                        {pb.name}
                        <span className="tw-intent-badge">
                          {modeLabel.icon} {modeLabel.label}
                        </span>
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
                    <p className="tw-label">What kind of course is this?</p>
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
                  </div>

                  <div className="ws-continue-row">
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

                  <div className="ws-continue-row">
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
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 3 — What do students need to achieve? */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="goal"
          stepNumber={3}
          status={sectionStatus.goal}
          title="What do students need to achieve?"
          hint="Describe the learning objective. AI will suggest refinements."
          summaryLabel="Goal"
          summary={goalText || undefined}
          onEdit={() => editSection("goal")}
        >
          <textarea
            className="tw-textarea"
            rows={3}
            placeholder="e.g. Understand and recall the key concepts of cell biology, including organelles and their functions"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            onBlur={() => {
              if (goalText.trim().length >= 10) fetchSuggestions(goalText.trim());
            }}
          />

          {/* AI suggestions */}
          {(loadingSuggestions || suggestions.length > 0) && (
            <div>
              <p className="tw-hint" style={{ marginBottom: 6 }}>
                Suggestions:
              </p>
              {loadingSuggestions ? (
                <div className="tw-loading">
                  <span className="tw-spinner" /> Generating suggestions...
                </div>
              ) : (
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
              )}
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
              label="Teaching style (optional)"
            />
          </div>

          <div className="ws-continue-row">
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
        {/* SECTION 4 — What are you teaching from?   */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="content"
          stepNumber={4}
          status={sectionStatus.content}
          title="What are you teaching from?"
          hint="Upload or select your teaching materials. We'll extract teaching points and organise them by type."
          summaryLabel="Content"
          summary={contentSummary}
          onEdit={() => editSection("content")}
        >
          {/* PackUploadStep handles file selection + upload */}
          {!contentDone && selectedDomainId && (
            <PackUploadStep
              domainId={selectedDomainId}
              domainSlug={selectedDomain?.slug}
              courseName={
                selectedPlaybook?.name ?? newCourseName ?? goalText ?? "Course"
              }
              existingCourses={existingCourses}
              existingSubjects={existingSubjects}
              onResult={handlePackResult}
            />
          )}

          {/* Extraction in progress (Bug Fix B: 5s poll already running) */}
          {contentDone && extractionInProgress && (
            <div className="tw-banner-info" style={{ marginBottom: 12 }}>
              <span className="tw-spinner" style={{ marginTop: 1 }} />
              <span>
                Extracting teaching points from your materials...{" "}
                {contentGroups.length > 0 && (
                  <strong>
                    {contentTotal} found so far
                  </strong>
                )}
              </span>
            </div>
          )}

          {/* Category group review (after extraction has started) */}
          {contentDone && contentGroups.length > 0 && (
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

              <div className="tw-group-list">
                {contentGroups.map((g) => {
                  const methodCfg = TEACH_METHOD_CONFIG[g.teachMethod];
                  return (
                    <div
                      key={g.category}
                      className={`tw-group-row ${!g.included ? "tw-group-row-unchecked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="tw-group-check"
                        checked={g.included}
                        onChange={() => toggleGroup(g.category)}
                      />
                      <span className="tw-group-icon">{categoryIcon(g.category)}</span>
                      <span className="tw-group-name">{categoryLabel(g.category)}</span>
                      <span className="tw-group-count">
                        {g.count} TP{g.count !== 1 ? "s" : ""}
                      </span>
                      <div className="tw-group-method">
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
                    </div>
                  );
                })}
              </div>

              {!canContinueContent && (
                <div className="tw-banner-warning" style={{ marginTop: 8 }}>
                  Select at least one group to continue.
                </div>
              )}

              {/* Overall intent re-selector */}
              <p className="tw-hint" style={{ marginTop: 12 }}>
                Overall approach:{" "}
                {TEACHING_MODE_ORDER.map((mode) => {
                  const cfg = TEACHING_MODE_LABELS[mode];
                  return (
                    <button
                      key={mode}
                      style={{
                        marginRight: 6,
                        padding: "3px 8px",
                        borderRadius: 5,
                        border: "1px solid var(--border-default)",
                        background:
                          teachingMode === mode
                            ? "var(--accent-primary)"
                            : "transparent",
                        color: teachingMode === mode ? "#fff" : "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                      onClick={() => {
                        setTeachingMode(mode);
                        // Re-derive groups with new intent
                        setContentGroups((prev) =>
                          prev.map((g) => ({
                            ...g,
                            teachMethod: categoryToTeachMethod(g.category, mode),
                            included:
                              (intentCategoryWeights[mode][g.category] ?? 1) >= 2,
                          }))
                        );
                      }}
                      type="button"
                    >
                      {cfg.icon} {cfg.label}
                    </button>
                  );
                })}
              </p>

              <div className="ws-continue-row">
                <button
                  className="tw-btn-continue"
                  disabled={!canContinueContent}
                  onClick={() => completeSection("content")}
                  type="button"
                >
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}

          {/* Content done, no categories yet + not extracting */}
          {contentDone && !extractionInProgress && contentGroups.length === 0 && !loadingCategories && (
            <div className="tw-banner-warning" style={{ marginTop: 8 }}>
              No teaching points found in this content. Try a different file.
            </div>
          )}

          {loadingCategories && (
            <div className="tw-loading" style={{ marginTop: 8 }}>
              <span className="tw-spinner" /> Loading content breakdown...
            </div>
          )}
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 5 — How should lessons be structured? */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="lesson-plan"
          stepNumber={5}
          status={sectionStatus["lesson-plan"]}
          title="How should lessons be structured?"
          hint="Here's a suggested lesson plan based on your content. Rename or remove lessons as needed."
          summaryLabel="Lessons"
          summary={lessonSummary}
          onEdit={() => editSection("lesson-plan")}
        >
          {lessonPlan.length === 0 ? (
            <div className="tw-loading">
              <span className="tw-spinner" /> Generating lesson plan...
            </div>
          ) : (
            <>
              <div className="tw-lesson-list">
                {lessonPlan.map((lesson, i) => (
                  <div key={lesson.id} className="tw-lesson-row">
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
                      <div className="tw-lesson-meta">
                        {lesson.durationMins} min · {lesson.tpCount} teaching point{lesson.tpCount !== 1 ? "s" : ""}
                      </div>
                    </div>
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
                ))}
              </div>

              {lessonPlan.length === 0 && (
                <div className="tw-banner-warning" style={{ marginTop: 8 }}>
                  No lessons generated.{" "}
                  <button
                    style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                    onClick={() => editSection("content")}
                    type="button"
                  >
                    ← Back to content
                  </button>
                </div>
              )}

              <div className="ws-continue-row">
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
        </WizardSection>

        {/* ═══════════════════════════════════════════ */}
        {/* SECTION 6 — Ready to teach                */}
        {/* ═══════════════════════════════════════════ */}
        <WizardSection
          id="launch"
          stepNumber={6}
          status={sectionStatus.launch}
          title="Ready to teach"
          hint="Review your choices and launch. Add an optional learner name to personalise the session."
        >
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
              <span className="tw-summary-key">Content</span>
              <span className="tw-summary-val">{contentSummary}</span>
            </div>
            <div className="tw-summary-row">
              <span className="tw-summary-key">Lessons</span>
              <span className="tw-summary-val">{lessonSummary}</span>
            </div>
          </div>

          {/* Learner details (optional) */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <p className="tw-label">Learner name (optional)</p>
              <input
                className="tw-input"
                type="text"
                placeholder="e.g. Alex"
                value={learnerName}
                onChange={(e) => setLearnerName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
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
            <div className="tw-banner-error" style={{ marginBottom: 12 }}>
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
        </WizardSection>
      </div>
    </div>
  );
}
