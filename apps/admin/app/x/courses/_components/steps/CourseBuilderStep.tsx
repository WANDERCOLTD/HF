"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Upload,
  Loader2,
  CheckCircle,
  Info,
} from "lucide-react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import {
  INTERACTION_PATTERN_ORDER,
  INTERACTION_PATTERN_LABELS,
  suggestInteractionPattern,
  type InteractionPattern,
  TEACHING_MODE_ORDER,
  TEACHING_MODE_LABELS,
  suggestTeachingMode,
  type TeachingMode,
} from "@/lib/content-trust/resolve-config";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { PackUploadStep } from "@/components/wizards/PackUploadStep";
import type { PackUploadResult } from "@/components/wizards/PackUploadStep";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepRenderProps } from "@/components/wizards/types";
import { DraftSection, DraftBadge } from "../DraftSection";
import { OutcomesEditor } from "../OutcomesEditor";
import { PlanSummary, type PlanSession, type PlanSummaryState } from "../PlanSummary";
import { DURATIONS, EMPHASIS_OPTIONS, ASSESSMENT_OPTIONS } from "../plan-constants";

// ── CourseBuilderStep ─────────────────────────────────
//
// Single-screen course builder (v3). Three zones:
// 1. Seed zone — course name, domain, file drop, Build button
// 2. Draft zone — outcomes, plan, content, advanced (appears after Build)
// 3. Launch zone — sticky bar at bottom
//
// AI tasks fire in parallel on Build click. Teacher edits immediately.

/** @system-constant course-setup — Launch API timeout in ms (2 minutes) */
const LAUNCH_TIMEOUT_MS = 120_000;

interface DomainOption {
  id: string;
  name: string;
}

interface TaskSummary {
  domain?: { id: string; name: string; slug: string };
  playbook?: { id: string; name: string };
  warnings?: string[];
}

export function CourseBuilderStep({
  setData,
  getData,
  onNext,
  endFlow,
}: StepRenderProps) {
  const router = useRouter();
  const { taskId: wizardTaskId } = useStepFlow();
  const { addCourseSetupJob } = useBackgroundTaskQueue();

  // ── Seed zone state ────────────────────────────────
  const [courseName, setCourseName] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [draftVisible, setDraftVisible] = useState(false);
  const [buildFired, setBuildFired] = useState(false);

  // Pre-set domain from URL context
  const presetDomainId = getData<string>("domainId");

  // ── Outcomes state ─────────────────────────────────
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiOriginSet, setAiOriginSet] = useState<Set<string>>(new Set());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestTaskFired = useRef(false);

  // ── Plan state ─────────────────────────────────────
  const [planSessions, setPlanSessions] = useState<PlanSession[]>([]);
  const [planState, setPlanState] = useState<PlanSummaryState>("waiting");
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const planFired = useRef(false);
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [curriculumId, setCurriculumId] = useState<string | undefined>();

  // ── Content state ──────────────────────────────────
  const [contentMode, setContentMode] = useState<"none" | "uploading" | "done">("none");
  const [packResult, setPackResult] = useState<PackUploadResult | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [seedFiles, setSeedFiles] = useState<File[]>([]);
  const [seedDragOver, setSeedDragOver] = useState(false);
  const seedFileInputRef = useRef<HTMLInputElement>(null);

  // ── Teaching Style state ───────────────────────────
  const [pattern, setPattern] = useState<InteractionPattern | undefined>();
  const [suggestedPattern, setSuggestedPattern] = useState<InteractionPattern | null>(null);
  const [hoveredPattern, setHoveredPattern] = useState<InteractionPattern | null>(null);
  const [teachingMode, setTeachingMode] = useState<TeachingMode>("recall");
  const [suggestedTeachingMode, setSuggestedTeachingMode] = useState<TeachingMode | null>(null);
  const [hoveredMode, setHoveredMode] = useState<TeachingMode | null>(null);
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");
  const suggestModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Plan Settings state ────────────────────────────
  const [sessionCount, setSessionCount] = useState<number | null>(6);
  const [durationMins, setDurationMins] = useState(15);
  const [emphasis, setEmphasis] = useState("balanced");
  const [assessments, setAssessments] = useState("light");

  // ── First Call state ───────────────────────────────
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const welcomeDirty = useRef(false);

  // ── Launch state ───────────────────────────────────
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const launchAbortRef = useRef<AbortController | null>(null);

  // ── Resolved defaults ──────────────────────────────
  const [resolvedDefaults, setResolvedDefaults] = useState<{
    sessionCount: number;
    durationMins: number;
    emphasis: string;
    assessments: string;
    lessonPlanModel: string;
  } | null>(null);

  // ── Load domains on mount ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/domains");
        const data = await res.json();
        if (data.ok && data.domains) {
          setDomains(data.domains);
          if (presetDomainId) {
            setSelectedDomainId(presetDomainId);
          } else if (data.domains.length === 1) {
            setSelectedDomainId(data.domains[0].id);
          }
        }
      } catch {
        // Non-critical
      } finally {
        setLoadingDomains(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load cascade defaults when domain selected ─────
  useEffect(() => {
    if (!selectedDomainId) return;
    (async () => {
      try {
        const res = await fetch(`/api/lesson-plan-defaults?domainId=${selectedDomainId}`);
        const data = await res.json();
        if (data.ok && data.defaults) {
          setResolvedDefaults(data.defaults);
          setSessionCount(data.defaults.sessionCount);
          setDurationMins(data.defaults.durationMins);
          setEmphasis(data.defaults.emphasis);
          setAssessments(data.defaults.assessments);
          setLessonPlanModel(data.defaults.lessonPlanModel as LessonPlanModel);
        }
      } catch {
        // Falls back to hardcoded defaults
      }
    })();
  }, [selectedDomainId]);

  // ── Auto-suggest pattern from course name ──────────
  useEffect(() => {
    if (!pattern) {
      setSuggestedPattern(suggestInteractionPattern(courseName));
    }
  }, [courseName, pattern]);

  // ── Auto-suggest teaching mode from course name ───
  useEffect(() => {
    if (suggestModeTimerRef.current) clearTimeout(suggestModeTimerRef.current);
    const name = courseName.trim();
    if (name.length < 3) { setSuggestedTeachingMode(null); return; }
    const hit = suggestTeachingMode(name);
    if (hit) {
      setSuggestedTeachingMode(hit);
      setTeachingMode(hit);
      return;
    }
    if (name.length < 10) { setSuggestedTeachingMode(null); return; }
    suggestModeTimerRef.current = setTimeout(() => {
      fetch("/api/courses/suggest-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseName: name }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.mode && data.confidence >= 0.5) {
            setSuggestedTeachingMode(data.mode);
            setTeachingMode(data.mode);
          }
        })
        .catch(() => {});
    }, 600);
    return () => { if (suggestModeTimerRef.current) clearTimeout(suggestModeTimerRef.current); };
  }, [courseName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-draft welcome message on outcomes arrival ─
  useEffect(() => {
    if (welcomeDirty.current) return;
    if (outcomes.length === 0) return;
    const outcomesText = outcomes.slice(0, 3).join(", ");
    const name = courseName.trim();
    const draft = name
      ? `Welcome to ${name}! We'll be exploring ${outcomesText}. Let's get started.`
      : `Welcome! We'll be working on ${outcomesText}. Let's get started.`;
    setWelcomeMessage(draft);
  }, [outcomes, courseName]);

  // ── Auto-fire generate-plan when first outcome arrives ─
  useEffect(() => {
    if (planFired.current || outcomes.length === 0 || !buildFired) return;
    planFired.current = true;
    firePlanGeneration();
  }, [outcomes, buildFired]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll plan task ─────────────────────────────────
  useTaskPoll({
    taskId: planTaskId,
    onProgress: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      // Skeleton detection
      if (ctx.skeletonReady && ctx.skeletonPlan) {
        setPlanSessions(ctx.skeletonPlan);
        setPlanState("ready");
        if (ctx.subjectId) setSubjectId(ctx.subjectId);
        if (ctx.curriculumId) setCurriculumId(ctx.curriculumId);
      }
    }, []),
    onComplete: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.plan) setPlanSessions(ctx.plan);
      if (ctx.subjectId) setSubjectId(ctx.subjectId);
      if (ctx.curriculumId) setCurriculumId(ctx.curriculumId);
      setPlanState("ready");
      setPlanTaskId(null);
    }, []),
    onError: useCallback((msg: string) => {
      setPlanError(msg);
      setPlanState("ready"); // Show error but don't block
      setPlanTaskId(null);
    }, []),
  });

  // ── Poll launch task ───────────────────────────────
  useTaskPoll({
    taskId: launchTaskId,
    onProgress: useCallback(() => {}, []),
    onComplete: useCallback((task: PollableTask) => {
      const summary = task.context?.summary || null;
      setTaskSummary(summary);
      setCompleted(true);
      setLaunching(false);
      setLaunchTaskId(null);
    }, []),
    onError: useCallback((msg: string) => {
      setLaunchError(msg);
      setLaunching(false);
      setLaunchTaskId(null);
    }, []),
  });

  // ── Actions ────────────────────────────────────────

  const fireOutcomeSuggestions = async (name: string) => {
    if (suggestTaskFired.current) return;
    suggestTaskFired.current = true;
    setSuggestionsLoading(true);
    try {
      const res = await fetch("/api/courses/suggest-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseName: name }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.outcomes)) {
        // If teacher hasn't typed any outcomes, auto-accept AI ones
        if (outcomes.length === 0) {
          setOutcomes(data.outcomes);
          setAiOriginSet(new Set(data.outcomes));
        } else {
          // Show as suggestions alongside teacher's outcomes
          const existing = new Set(outcomes);
          const newSuggestions = data.outcomes.filter((o: string) => !existing.has(o));
          setAiSuggestions(newSuggestions);
        }
      }
    } catch {
      // Non-critical — teacher can type their own
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const firePlanGeneration = async () => {
    setPlanState("generating");
    setPlanError(null);
    try {
      const effectivePattern = pattern || suggestedPattern || "directive";
      const res = await fetch("/api/courses/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName: courseName.trim(),
          learningOutcomes: outcomes.filter((o) => o.trim()),
          teachingStyle: "tutor",
          interactionPattern: effectivePattern,
          sessionCount: sessionCount ?? 6,
          durationMins,
          emphasis,
          assessments,
          lessonPlanModel,
        }),
      });
      const data = await res.json();
      if (data.ok && data.taskId) {
        setPlanTaskId(data.taskId);
      } else {
        setPlanError(data.error || "Failed to start plan generation");
        setPlanState("ready");
      }
    } catch {
      setPlanError("Failed to start plan generation");
      setPlanState("ready");
    }
  };

  const handleBuild = () => {
    setBuildFired(true);
    setDraftVisible(true);

    // Tier 2 tasks — fire in parallel
    const name = courseName.trim();
    fireOutcomeSuggestions(name);

    // Auto-show uploader if files were dropped in seed zone
    if (seedFiles.length > 0) {
      setShowUploader(true);
    }

    // Store seed data in the data bag
    setData("courseName", name);
    setData("domainId", selectedDomainId);
  };

  const handlePackResult = useCallback((result: PackUploadResult) => {
    setPackResult(result);
    if (result.mode === "skip") {
      setContentMode("none");
      setShowUploader(false);
    } else if (result.mode === "pack-upload") {
      setContentMode("done");
      setShowUploader(false);
      if (result.subjects) {
        setData("packSubjects", result.subjects);
        setData("packSubjectIds", result.subjects.map((s) => s.id));
      }
      // Auto-regenerate lesson plan now that TPs are available
      if (result.extractionTotals?.assertions && result.extractionTotals.assertions > 0) {
        planFired.current = false;
        setPlanSessions([]);
        setPlanState("generating");
        firePlanGeneration();
      }
    }
  }, [setData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAcceptSuggestion = useCallback((suggestion: string) => {
    setOutcomes((prev) => [...prev, suggestion]);
    setAiOriginSet((prev) => new Set([...prev, suggestion]));
    setAiSuggestions((prev) => prev.filter((s) => s !== suggestion));
  }, []);

  const handleDismissSuggestion = useCallback((suggestion: string) => {
    setAiSuggestions((prev) => prev.filter((s) => s !== suggestion));
  }, []);

  const handleRegeneratePlan = () => {
    planFired.current = false;
    setPlanSessions([]);
    setPlanState("generating");
    firePlanGeneration();
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    launchAbortRef.current?.abort();
    const controller = new AbortController();
    launchAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), LAUNCH_TIMEOUT_MS);

    const effectivePattern = pattern || suggestedPattern || "directive";
    const filteredOutcomes = outcomes.filter((o) => o.trim());

    try {
      const res = await fetch("/api/courses/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName: courseName.trim(),
          learningOutcomes: filteredOutcomes,
          teachingStyle: "tutor",
          sessionCount: sessionCount ?? 6,
          durationMins,
          emphasis,
          domainId: selectedDomainId || undefined,
          interactionPattern: effectivePattern,
          teachingMode,
          welcomeMessage,
          studentEmails: [],
          subjectId: subjectId || undefined,
          curriculumId: curriculumId || undefined,
          planIntents: { sessionCount: sessionCount ?? 6, durationMins, emphasis, assessments },
          lessonPlanMode: planSessions.length > 0 ? "accepted" : "skipped",
          wizardTaskId: wizardTaskId || undefined,
          packSubjectIds: packResult?.subjects?.map((s) => s.id) || undefined,
          lessonPlanModel,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to start course setup");
      setLaunchTaskId(data.taskId);
      addCourseSetupJob(data.taskId, courseName.trim());
    } catch (err: any) {
      if (err.name === "AbortError") {
        setLaunchError("Request timed out. Please retry.");
      } else {
        setLaunchError(err.message || "Failed to launch");
      }
      setLaunching(false);
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleGoToCourse = () => {
    endFlow();
    const pbId = taskSummary?.playbook?.id;
    router.push(pbId ? `/x/courses/${pbId}` : "/x/courses");
  };

  // ── Derived values ─────────────────────────────────
  const effectivePattern = pattern || suggestedPattern;
  const canBuild = courseName.trim().length >= 3 && !!selectedDomainId;
  const contentPending = seedFiles.length > 0 && !packResult;
  const canLaunch = outcomes.length > 0 && !launching && !completed;

  // ── Completed state — show summary ─────────────────
  if (completed && taskSummary) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <WizardSummary
          title="Course created"
          intent={{
            items: [
              { label: "Course", value: taskSummary.playbook?.name || courseName },
              { label: "Institution", value: taskSummary.domain?.name || "—" },
              { label: "Outcomes", value: `${outcomes.length} learning outcomes` },
              { label: "Plan", value: planSessions.length > 0 ? `${planSessions.length} sessions` : "Defaults" },
            ],
          }}
          primaryAction={{ label: "View Course", onClick: handleGoToCourse }}
          secondaryActions={[
            { label: "Back to Courses", onClick: () => { endFlow(); router.push("/x/courses"); } },
          ]}
        />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────
  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {/* ── SEED ZONE ──────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        {/* Institution picker */}
        <div style={{ marginBottom: 16 }}>
          <div className="hf-label" style={{ marginBottom: 6 }}>Institution</div>
          {loadingDomains ? (
            <div className="hf-draft-skeleton" style={{ width: 200, height: 36 }} />
          ) : domains.length === 0 ? (
            <div className="hf-banner hf-banner-warning">
              Create an institution first before building a course.
            </div>
          ) : domains.length === 1 ? (
            <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>
              {domains[0].name}
            </div>
          ) : (
            <select
              className="hf-input"
              value={selectedDomainId}
              onChange={(e) => setSelectedDomainId(e.target.value)}
            >
              <option value="">Select institution...</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Course name */}
        <div style={{ marginBottom: 16 }}>
          <FieldHint
            label="Course name"
            hint={WIZARD_HINTS["course.name"]}
            labelClass="hf-label"
          />
          <input
            className="hf-input"
            placeholder="e.g. GCSE History: Victorian Britain"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            disabled={buildFired}
            style={{ marginTop: 6 }}
          />
        </div>

        {/* File drop — only before Build */}
        {!buildFired && (
          <div
            style={{
              border: `2px dashed ${seedDragOver ? "var(--accent-primary)" : "var(--border-default)"}`,
              borderRadius: 12,
              padding: "20px 16px",
              textAlign: "center",
              color: seedDragOver ? "var(--accent-primary)" : "var(--text-muted)",
              fontSize: 13,
              marginBottom: 16,
              cursor: "pointer",
              background: seedDragOver ? "color-mix(in srgb, var(--accent-primary) 6%, transparent)" : "transparent",
              transition: "all 0.15s ease",
            }}
            onClick={() => seedFileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setSeedDragOver(true); }}
            onDragLeave={() => setSeedDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSeedDragOver(false);
              if (e.dataTransfer.files.length > 0) {
                const valid = Array.from(e.dataTransfer.files).filter((f) => {
                  const name = f.name.toLowerCase();
                  return [".pdf", ".docx", ".txt", ".md", ".json"].some((ext) => name.endsWith(ext));
                });
                if (valid.length > 0) setSeedFiles((prev) => [...prev, ...valid]);
              }
            }}
          >
            <input
              ref={seedFileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.json"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  setSeedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }
              }}
            />
            <Upload size={20} style={{ marginBottom: 4, opacity: 0.5 }} />
            {seedFiles.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {seedFiles.length} file{seedFiles.length !== 1 ? "s" : ""} ready
                </div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  {seedFiles.map((f) => f.name).join(", ")}
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>Drop more or click to add</div>
              </div>
            ) : (
              <div>
                <div>Drop course files here (optional)</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>PDF, DOCX, TXT</div>
              </div>
            )}
          </div>
        )}

        {/* Build button */}
        {!buildFired && (
          <div style={{ textAlign: "center" }}>
            <button
              className="hf-draft-build-btn"
              disabled={!canBuild}
              onClick={handleBuild}
            >
              <Sparkles size={16} />
              Build My Course
            </button>
          </div>
        )}
      </div>

      {/* ── DRAFT ZONE ─────────────────────────────── */}
      {draftVisible && (
        <div className="hf-draft-zone">
          {/* ─── OUTCOMES (primary, always expanded) ── */}
          <DraftSection
            title="Outcomes"
            defaultOpen={true}
            status={suggestionsLoading ? "loading" : "ready"}
            badge={
              outcomes.length > 0 ? (
                <DraftBadge variant="success">
                  {outcomes.length} outcome{outcomes.length !== 1 ? "s" : ""}
                </DraftBadge>
              ) : null
            }
          >
            <OutcomesEditor
              outcomes={outcomes}
              onChange={setOutcomes}
              suggestions={aiSuggestions}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDismissSuggestion={handleDismissSuggestion}
              suggestionsLoading={suggestionsLoading}
              aiOriginSet={aiOriginSet}
            />
          </DraftSection>

          {/* ─── SESSION PLAN (primary, always expanded) */}
          <DraftSection
            title="Session Plan"
            defaultOpen={true}
            status={planState === "generating" ? "loading" : planError ? "error" : "ready"}
            error={planError}
            onRetry={handleRegeneratePlan}
            badge={
              planSessions.length > 0 ? (
                <DraftBadge variant="success">
                  {planSessions.length} session{planSessions.length !== 1 ? "s" : ""}
                </DraftBadge>
              ) : null
            }
          >
            <PlanSummary
              state={outcomes.length === 0 ? "waiting" : planState === "generating" ? "generating" : "ready"}
              sessions={planSessions}
            />
          </DraftSection>

          {/* ─── CONTENT ────────────────────────────── */}
          <DraftSection
            title="Content"
            defaultOpen={contentMode === "done" || showUploader}
            status={contentPending ? "loading" : "ready"}
            badge={
              contentMode === "done" && packResult ? (
                <DraftBadge variant="success">
                  {packResult.sourceCount || 0} file{(packResult.sourceCount || 0) !== 1 ? "s" : ""}
                  {packResult.extractionTotals?.assertions
                    ? ` \u00b7 ${packResult.extractionTotals.assertions} TPs`
                    : ""}
                </DraftBadge>
              ) : contentPending ? (
                <DraftBadge variant="info">{seedFiles.length} file{seedFiles.length !== 1 ? "s" : ""} processing...</DraftBadge>
              ) : (
                <DraftBadge variant="muted">no files</DraftBadge>
              )
            }
          >
            {contentMode === "done" && packResult ? (
              <div>
                <div className="hf-banner hf-banner-success" style={{ marginBottom: 8 }}>
                  <CheckCircle size={14} />
                  <span>
                    {packResult.sourceCount} file{(packResult.sourceCount || 0) !== 1 ? "s" : ""} uploaded
                    {packResult.extractionTotals?.assertions
                      ? ` — ${packResult.extractionTotals.assertions} teaching points extracted`
                      : ""}
                  </span>
                </div>
                <button
                  className="hf-btn hf-btn-sm hf-btn-secondary"
                  onClick={() => {
                    setContentMode("none");
                    setPackResult(null);
                    setShowUploader(true);
                  }}
                >
                  + Add more files
                </button>
              </div>
            ) : showUploader && selectedDomainId ? (
              <PackUploadStep
                domainId={selectedDomainId}
                courseName={courseName.trim()}
                interactionPattern={effectivePattern || undefined}
                teachingMode={teachingMode}
                initialFiles={seedFiles.length > 0 ? seedFiles : undefined}
                autoIngest
                onResult={handlePackResult}
              />
            ) : (
              <div>
                <div className="hf-banner hf-banner-info" style={{ marginBottom: 8 }}>
                  <Info size={14} />
                  <span>No content uploaded — AI will generate from your outcomes and course name.</span>
                </div>
                <button
                  className="hf-btn hf-btn-sm hf-btn-secondary"
                  onClick={() => setShowUploader(true)}
                >
                  + Upload files
                </button>
              </div>
            )}
          </DraftSection>

          {/* ─── TEACHING STYLE (collapsed) ─────────── */}
          <DraftSection
            title="Teaching Style"
            defaultOpen={false}
            badge={
              <DraftBadge variant="muted">
                {INTERACTION_PATTERN_LABELS[(effectivePattern || "directive") as InteractionPattern]?.label || "Directive"}
                {" · "}
                {TEACHING_MODE_LABELS[teachingMode]?.icon} {TEACHING_MODE_LABELS[teachingMode]?.label || "Recall"}
              </DraftBadge>
            }
          >
            <div style={{ marginBottom: 16 }}>
              <FieldHint
                label="Interaction pattern"
                hint={WIZARD_HINTS["course.interactionPattern"]}
                labelClass="hf-label"
              />
              <div className="hf-chip-row" style={{ marginTop: 8 }}>
                {INTERACTION_PATTERN_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={
                      "hf-chip" +
                      (effectivePattern === p ? " hf-chip-selected" : "") +
                      (suggestedPattern === p && !pattern ? " hf-chip-selected" : "")
                    }
                    onClick={() => {
                      setPattern(p);
                      setSuggestedPattern(null);
                    }}
                    onMouseEnter={() => setHoveredPattern(p)}
                    onMouseLeave={() => setHoveredPattern(null)}
                  >
                    {INTERACTION_PATTERN_LABELS[p].label}
                  </button>
                ))}
              </div>
              {(() => {
                const preview = hoveredPattern || effectivePattern;
                if (!preview) return (
                  <div className="hf-chip-preview">
                    <span className="hf-chip-preview-empty">Hover to preview each style</span>
                  </div>
                );
                const info = INTERACTION_PATTERN_LABELS[preview];
                return (
                  <div className="hf-chip-preview">
                    <span className="hf-chip-preview-label">{info.icon} {info.label}:</span>
                    <span className="hf-chip-preview-desc">{info.description}</span>
                    <span className="hf-chip-preview-examples">{info.examples}</span>
                  </div>
                );
              })()}
            </div>

            <div style={{ marginBottom: 16 }}>
              <FieldHint
                label="Content emphasis"
                hint={WIZARD_HINTS["course.teachingMode"]}
                labelClass="hf-label"
              />
              <div className="hf-chip-row" style={{ marginTop: 8 }}>
                {TEACHING_MODE_ORDER.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={
                      "hf-chip" +
                      (teachingMode === m ? " hf-chip-selected" : "") +
                      (suggestedTeachingMode === m && teachingMode !== m ? " hf-chip-suggested" : "")
                    }
                    onClick={() => {
                      setTeachingMode(m);
                      setSuggestedTeachingMode(null);
                    }}
                    onMouseEnter={() => setHoveredMode(m)}
                    onMouseLeave={() => setHoveredMode(null)}
                  >
                    {TEACHING_MODE_LABELS[m].icon} {TEACHING_MODE_LABELS[m].label}
                  </button>
                ))}
              </div>
              {(() => {
                const preview = hoveredMode || teachingMode;
                const info = TEACHING_MODE_LABELS[preview];
                return (
                  <div className="hf-chip-preview">
                    <span className="hf-chip-preview-label">{info.icon} {info.label}:</span>
                    <span className="hf-chip-preview-desc">{info.description}</span>
                    <span className="hf-chip-preview-examples">{info.examples}</span>
                  </div>
                );
              })()}
            </div>

            <FieldHint
              label="Teaching model"
              hint={WIZARD_HINTS["course.model"]}
              labelClass="hf-label"
            />
            <div style={{ marginTop: 8 }}>
              <LessonPlanModelPicker
                value={lessonPlanModel}
                onChange={setLessonPlanModel}
              />
            </div>
          </DraftSection>

          {/* ─── FIRST CALL (collapsed) ─────────────── */}
          <DraftSection
            title="First Call"
            defaultOpen={false}
            badge={
              <DraftBadge variant="muted">
                {welcomeMessage
                  ? welcomeMessage.length > 30
                    ? welcomeMessage.slice(0, 30) + "\u2026"
                    : welcomeMessage
                  : "Default greeting"}
              </DraftBadge>
            }
          >
            <div>
              <div className="hf-label" style={{ marginBottom: 6 }}>Welcome message</div>
              <textarea
                className="hf-input"
                rows={5}
                value={welcomeMessage}
                onChange={(e) => {
                  setWelcomeMessage(e.target.value);
                  welcomeDirty.current = true;
                }}
                placeholder="Welcome message for the first call..."
                style={{ resize: "vertical", minHeight: 100 }}
              />
              {!welcomeDirty.current && welcomeMessage && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Auto-drafted from your outcomes. Edit freely.
                </div>
              )}
            </div>
          </DraftSection>

          {/* ─── PLAN SETTINGS (collapsed) ──────────── */}
          <DraftSection
            title="Plan Settings"
            defaultOpen={false}
            badge={
              <DraftBadge variant="muted">
                {sessionCount ?? 6} \u00d7 {durationMins} min \u00b7{" "}
                {emphasis.charAt(0).toUpperCase() + emphasis.slice(1)}
              </DraftBadge>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <SessionCountPicker
                value={sessionCount}
                onChange={setSessionCount}
              />

              <div>
                <div className="hf-label" style={{ marginBottom: 6 }}>Duration per session</div>
                <div className="hf-chip-row">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={"hf-chip" + (durationMins === d ? " hf-chip-selected" : "")}
                      onClick={() => setDurationMins(d)}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="hf-label" style={{ marginBottom: 6 }}>Focus</div>
                <div className="hf-chip-row">
                  {EMPHASIS_OPTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={"hf-chip" + (emphasis === e ? " hf-chip-selected" : "")}
                      onClick={() => setEmphasis(e)}
                    >
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="hf-label" style={{ marginBottom: 6 }}>Assessments</div>
                <div className="hf-chip-row">
                  {ASSESSMENT_OPTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={"hf-chip" + (assessments === a ? " hf-chip-selected" : "")}
                      onClick={() => setAssessments(a)}
                    >
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {planSessions.length > 0 && (
                <button
                  className="hf-btn hf-btn-secondary hf-btn-sm"
                  onClick={handleRegeneratePlan}
                >
                  Regenerate Plan
                </button>
              )}
            </div>
          </DraftSection>

          {/* ── LAUNCH ZONE ────────────────────────── */}
          <div className="hf-draft-launch-bar">
            {launchError && (
              <div className="hf-banner hf-banner-error" style={{ flex: 1 }}>
                {launchError}
              </div>
            )}

            {planState === "generating" && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Plan still generating — will use defaults if launched now
              </span>
            )}

            {contentPending && (
              <span style={{ fontSize: 12, color: "var(--status-warning-text, #d97706)" }}>
                Files still processing — wait for content upload to finish, or launch without content
              </span>
            )}

            <button
              className="hf-btn hf-btn-primary"
              disabled={!canLaunch}
              onClick={handleLaunch}
            >
              {launching ? (
                <>
                  <Loader2 size={14} className="hf-spinner" />
                  Launching...
                </>
              ) : contentPending ? (
                "Launch Without Content"
              ) : (
                "Launch Course"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
