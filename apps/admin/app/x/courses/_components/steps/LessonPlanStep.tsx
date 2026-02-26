"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowRight, BookOpen, CheckCircle, FileText, RefreshCw, Zap } from "lucide-react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { SortableList } from "@/components/shared/SortableList";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { reorderItems } from "@/lib/sortable/reorder";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import KnowledgeMapTree, { type SourceTree, type KnowledgeMapStats } from "@/components/shared/KnowledgeMapTree";
import type { StepProps } from "../CourseSetupWizard";

// ── Types ──────────────────────────────────────────────

type Phase = "loading" | "skeleton" | "editing" | "intents";

type LessonEntry = {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string;
  estimatedDurationMins?: number;
  assertionCount?: number;
  questionCount?: number;
  vocabularyCount?: number;
  phases?: Array<{
    id: string;
    label: string;
    durationMins?: number;
    teachMethods?: string[];
    learningOutcomeRefs?: string[];
    guidance?: string;
  }>;
  learningOutcomeRefs?: string[];
};

const SESSION_TYPES = [
  { value: "onboarding", label: "Onboarding", color: "var(--accent-primary)" },
  { value: "introduce", label: "Introduce", color: "var(--status-info-text)" },
  { value: "deepen", label: "Deepen", color: "var(--session-deepen, var(--status-info-text))" },
  { value: "review", label: "Review", color: "var(--status-warning-text)" },
  { value: "assess", label: "Assess", color: "var(--status-error-text)" },
  { value: "consolidate", label: "Consolidate", color: "var(--status-success-text)" },
] as const;

const DURATIONS = [15, 20, 30, 45, 60] as const;
const EMPHASIS_OPTIONS = ["breadth", "balanced", "depth"] as const;
const ASSESSMENT_OPTIONS = ["formal", "light", "none"] as const;

/** @system-constant lesson-plan — Save timeout in ms (2 minutes) */
const SAVE_TIMEOUT_MS = 120_000;

function getTypeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color || "var(--text-muted)";
}

function getTypeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label || type;
}

// ── Component ──────────────────────────────────────────

export function LessonPlanStep({ setData, getData, onNext, onPrev }: StepProps) {
  // ── Phase & task state ─────────────────────────────────
  const [phase, setPhase] = useState<Phase>("loading");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<{ index: number; total: number } | null>(null);

  // Intent inputs
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(30);
  const [emphasis, setEmphasis] = useState<typeof EMPHASIS_OPTIONS[number]>("balanced");
  const [assessments, setAssessments] = useState<typeof ASSESSMENT_OPTIONS[number]>("light");
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");

  // Phase expansion (for session cards)
  const [expandedSession, setExpandedSession] = useState<number | null>(null);

  // Lesson plan data
  const [entries, setEntries] = useState<LessonEntry[]>([]);
  const [skeletonEntries, setSkeletonEntries] = useState<LessonEntry[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [curriculumId, setCurriculumId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  // Inline edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");

  // Adding new session
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<string>("introduce");

  // Knowledge Map
  const [kmExpanded, setKmExpanded] = useState(false);
  const [kmSources, setKmSources] = useState<SourceTree[]>([]);
  const [kmStats, setKmStats] = useState<KnowledgeMapStats | null>(null);
  const kmFetchedRef = useRef(false);

  // Content from previous step
  const contentMode = getData<string>("contentMode");

  // Stable ref for phase (used in callbacks to avoid stale closures)
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const skeletonRef = useRef(skeletonEntries);
  skeletonRef.current = skeletonEntries;

  // ── On mount: check for eager generation or saved plan ──

  useEffect(() => {
    // Restore saved intents
    const saved = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string; lessonPlanModel?: string }>("planIntents");
    if (saved) {
      if (saved.sessionCount) setSessionCount(saved.sessionCount);
      if (saved.durationMins) setDurationMins(saved.durationMins);
      if (saved.emphasis) setEmphasis(saved.emphasis as typeof emphasis);
      if (saved.assessments) setAssessments(saved.assessments as typeof assessments);
      if (saved.lessonPlanModel) setLessonPlanModel(saved.lessonPlanModel as LessonPlanModel);
    }
    // Also restore model from IntentStep's direct data bag key (set before eager generation)
    const directModel = getData<LessonPlanModel>("lessonPlanModel");
    if (directModel) setLessonPlanModel(directModel);

    // Check for saved plan first (stepping back & forward)
    const savedPlan = getData<LessonEntry[]>("lessonPlan");
    if (savedPlan && savedPlan.length > 0) {
      setEntries(savedPlan);
      setReasoning(getData<string>("planReasoning") || "");
      setSubjectId(getData<string>("subjectId") || null);
      setCurriculumId(getData<string>("curriculumId") || null);
      setPhase("editing");
      return;
    }

    // Check for eager generation task from IntentStep
    const eagerTaskId = getData<string>("planTaskId");
    if (eagerTaskId) {
      setTaskId(eagerTaskId);
      setPhase("loading");
      return;
    }

    // No task, no plan — show intents (manual path)
    setPhase("intents");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Task polling — picks up eager generation or manual generate ──

  useTaskPoll({
    taskId,
    onProgress: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.message) {
        setProgressMessage(ctx.message);
        setError(null);
      }
      if (ctx.stepIndex !== undefined && ctx.totalSteps) {
        setProgressStep({ index: ctx.stepIndex, total: ctx.totalSteps });
      }
      // Skeleton detection — show partial plan immediately
      if (ctx.skeletonReady && ctx.skeletonPlan && phaseRef.current !== "skeleton" && phaseRef.current !== "editing") {
        setSkeletonEntries(ctx.skeletonPlan);
        setSubjectId(ctx.subjectId || null);
        setCurriculumId(ctx.curriculumId || null);
        setPhase("skeleton");
      }
    }, []),
    onComplete: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.plan && Array.isArray(ctx.plan) && ctx.plan.length > 0) {
        setEntries(ctx.plan);
        setReasoning(ctx.reasoning || "");
        setSubjectId(ctx.subjectId || null);
        setCurriculumId(ctx.curriculumId || null);
      } else if (skeletonRef.current.length > 0) {
        // Graceful: use skeleton as the plan
        setEntries(skeletonRef.current);
      }
      setPhase("editing");
      setProgressMessage(null);
      setProgressStep(null);
      setData("stepProcessing_lesson-plan", false);
      setTaskId(null);
      setData("planTaskId", null);
    }, [setData]),
    onError: useCallback((message: string) => {
      if (phaseRef.current === "skeleton" && skeletonRef.current.length > 0) {
        // Graceful degradation — keep skeleton as usable plan
        setEntries(skeletonRef.current);
        setPhase("editing");
      } else {
        setError(message);
        setPhase("intents");
      }
      setProgressMessage(null);
      setProgressStep(null);
      setData("stepProcessing_lesson-plan", false);
      setTaskId(null);
      setData("planTaskId", null);
    }, [setData]),
  });

  // ── Knowledge Map fetch (once, when editing) ─────────

  useEffect(() => {
    if (phase !== "editing" || kmFetchedRef.current) return;
    const domainId = getData<string>("domainId");
    if (!domainId) return;
    kmFetchedRef.current = true;

    const subjectIds = getData<string[]>("packSubjects")?.map((s: any) => s.id || s).filter(Boolean);
    const qs = subjectIds?.length ? `?subjectIds=${subjectIds.join(",")}` : "";

    fetch(`/api/domains/${domainId}/knowledge-map${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.sources?.length > 0) {
          setKmSources(data.sources);
          setKmStats(data.stats || null);
        }
      })
      .catch(() => {}); // silent — Knowledge Map is supplementary
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Intent helpers ────────────────────────────────────

  function savePlanIntents() {
    setData("planIntents", {
      sessionCount: sessionCount || 12,
      durationMins,
      emphasis,
      assessments,
      lessonPlanModel,
    });
    setData("sessionCount", sessionCount || 12);
    setData("durationMins", durationMins);
    setData("emphasis", emphasis);
    setData("lessonPlanModel", lessonPlanModel);
  }

  function handleSkip() {
    setData("stepProcessing_lesson-plan", false);
    setData("lessonPlanMode", "skipped");
    setData("sessionCount", 12);
    setData("durationMins", 30);
    onNext();
  }

  async function handleGenerate() {
    if (taskId || phase === "loading") return;
    savePlanIntents();
    setError(null);
    setProgressMessage(null);
    setProgressStep(null);
    setPhase("loading");

    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const courseName = getData<string>("courseName");
    const learningOutcomes = getData<string[]>("learningOutcomes") || [];
    const teachingStyle = getData<string>("teachingStyle") || "tutor";
    const interactionPattern = getData<string>("interactionPattern") || undefined;

    try {
      const res = await fetch("/api/courses/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName, learningOutcomes, teachingStyle, interactionPattern,
          sessionCount: sessionCount || 12, durationMins, emphasis, assessments,
          lessonPlanModel,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to start plan generation");
      setTaskId(data.taskId);
      setData("planTaskId", data.taskId);
      setData("stepProcessing_lesson-plan", true);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Generation request timed out. Please try again.");
      } else {
        setError(err.message || "Failed to start plan generation");
      }
      setPhase("intents");
    } finally {
      clearTimeout(timeout);
    }
  }

  function handleCancelGeneration() {
    generateAbortRef.current?.abort();
    setTaskId(null);
    setData("planTaskId", null);
    setData("stepProcessing_lesson-plan", false);
    setProgressMessage(null);
    setProgressStep(null);
    setError(null);
    setPhase("intents");
  }

  function handleUseOutline() {
    // Accept skeleton entries as the plan
    savePlanIntents();
    setData("lessonPlanMode", "reviewed");
    setData("subjectId", subjectId);
    setData("curriculumId", curriculumId);
    setData("lessonPlan", skeletonEntries.map((e, i) => ({ ...e, session: i + 1 })));
    setData("stepProcessing_lesson-plan", false);
    setTaskId(null);
    setData("planTaskId", null);
    onNext();
  }

  // ── Save & Continue ───────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);

    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);

    try {
      const numbered = entries.map((e, i) => ({ ...e, session: i + 1 }));

      if (curriculumId) {
        const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: numbered }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to save lesson plan");
      }

      savePlanIntents();
      setData("lessonPlanMode", "reviewed");
      setData("subjectId", subjectId);
      setData("curriculumId", curriculumId);
      setData("lessonPlan", numbered);
      setData("planReasoning", reasoning);
      onNext();
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Save timed out. Please try again.");
      } else {
        setError(err.message || "Failed to save lesson plan");
      }
    } finally {
      clearTimeout(timeout);
      setSaving(false);
    }
  }

  // ── SortableList callbacks ────────────────────────────

  const handleReorder = useCallback((from: number, to: number) => {
    setEntries((prev) => reorderItems(prev, from, to));
  }, []);

  const handleRemove = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDuplicate = useCallback((index: number) => {
    setEntries((prev) => {
      const item = prev[index];
      const copy = { ...item, label: `${item.label} (copy)` };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }, []);

  function handleAddSession() {
    if (!newLabel.trim()) return;
    setEntries((prev) => [
      ...prev,
      { session: prev.length + 1, type: newType, moduleId: null, moduleLabel: "", label: newLabel.trim() },
    ]);
    setNewLabel("");
    setNewType("introduce");
    setShowAdd(false);
  }

  function handleInlineEditSave(index: number) {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, label: editLabel, type: editType } : e)),
    );
    setEditingIndex(null);
  }

  // ── Render helpers ────────────────────────────────────

  const progressPct = progressStep
    ? Math.round(((progressStep.index + 1) / progressStep.total) * 100)
    : 0;

  // Check if eager plan was goals-only but user uploaded content
  const eagerWasGoalsOnly = !!(contentMode === "pack" && entries.length > 0 && getData<string>("lessonPlanMode") !== "reviewed");

  const renderSessionCard = (entry: LessonEntry, index: number, skeleton?: boolean) => {
    // Aggregate unique teach methods from all phases (editing only)
    const allMethods = !skeleton
      ? [...new Set((entry.phases ?? []).flatMap((p) => p.teachMethods ?? []))]
      : [];

    return (
      <div className={skeleton ? "hf-session-enter" : undefined}>
        {!skeleton && editingIndex === index ? (
          <div className="hf-inline-edit-row">
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value)}
              className="hf-input hf-input-inline"
            >
              {SESSION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInlineEditSave(index);
                if (e.key === "Escape") setEditingIndex(null);
              }}
              autoFocus
              className="hf-input hf-input-inline-md"
            />
            <button onClick={() => handleInlineEditSave(index)} className="hf-btn hf-btn-primary hf-btn-sm">Save</button>
            <button onClick={() => setEditingIndex(null)} className="hf-btn hf-btn-secondary hf-btn-sm">Cancel</button>
          </div>
        ) : (
          <div
            className={`hf-session-row${skeleton ? " hf-session-row--skeleton" : ""}`}
            onClick={skeleton ? undefined : () => {
              setEditingIndex(index);
              setEditLabel(entry.label);
              setEditType(entry.type);
            }}
          >
            <span className="hf-session-num">{index + 1}</span>
            <span
              className="hf-session-type"
              style={{
                color: getTypeColor(entry.type),
                background: `color-mix(in srgb, ${getTypeColor(entry.type)} 10%, transparent)`,
              }}
            >
              {getTypeLabel(entry.type)}
            </span>
            <span className="hf-session-label">{entry.label}</span>
            {!skeleton && entry.assertionCount ? (
              <span className="hf-session-tp-badge" title="Teaching points">
                <BookOpen size={10} />
                {entry.assertionCount} TPs
              </span>
            ) : null}
            {entry.moduleLabel && (
              <span className="hf-session-meta">{entry.moduleLabel}</span>
            )}
            {skeleton ? (
              <span className="hf-shimmer-bar" />
            ) : entry.estimatedDurationMins ? (
              <span className="hf-session-meta">{entry.estimatedDurationMins}m</span>
            ) : null}
            {!skeleton && entry.phases?.length ? (
              <button
                className="hf-session-expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSession(expandedSession === index ? null : index);
                }}
                title={expandedSession === index ? "Collapse phases" : "Show phases"}
              >
                <span className={`hf-chevron--sm${expandedSession === index ? " hf-chevron--open" : ""}`} />
              </button>
            ) : null}
          </div>
        )}
        {/* TeachMethods bar — always visible when methods are known */}
        {allMethods.length > 0 && (
          <div className="hf-session-methods-bar">
            <Zap size={10} className="hf-session-methods-icon" />
            {allMethods.map((m) => (
              <span key={m} className="hf-chip hf-chip-sm">{m}</span>
            ))}
          </div>
        )}
        {/* Phase expansion — multi-row per phase */}
        {!skeleton && expandedSession === index && entry.phases?.length && (
          <div className="hf-session-phases">
            {entry.phases.map((phase, pi) => (
              <div key={phase.id + pi} className="hf-session-phase">
                <div className="hf-session-phase-header">
                  <span className="hf-session-phase-label">{phase.label}</span>
                  {phase.durationMins && (
                    <span className="hf-session-phase-dur">{phase.durationMins}m</span>
                  )}
                </div>
                {phase.teachMethods?.length ? (
                  <div className="hf-session-phase-methods">
                    <Zap size={9} className="hf-session-methods-icon" />
                    {phase.teachMethods.map((m) => (
                      <span key={m} className="hf-chip hf-chip-sm">{m}</span>
                    ))}
                  </div>
                ) : null}
                {phase.guidance && (
                  <div className="hf-session-phase-guidance">{phase.guidance}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title">Plan your sessions</h1>
          <p className="hf-page-subtitle">
            {phase === "editing"
              ? "Review and customize your lesson plan. Drag to reorder, click to edit."
              : phase === "loading" || phase === "skeleton"
                ? "Your lesson plan is being generated..."
                : "Set how many sessions, how long, and how deep — then generate a plan."}
          </p>
        </div>

        {/* Error banner */}
        <ErrorBanner error={error} className="hf-mb-md" />

        {/* ── Phase: Loading (eager generation in progress) ── */}
        {phase === "loading" && (
          <div className="hf-flex-col hf-gap-md">
            {/* Content status */}
            {contentMode === "pack" && (
              <div className="hf-banner hf-banner-success">
                <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span>Course files uploaded — will inform your lesson plan</span>
              </div>
            )}

            {/* Progress */}
            <div className="hf-flex hf-flex-col hf-items-center hf-gap-sm hf-py-lg">
              <div className="hf-spinner hf-icon-lg hf-spinner-thick" />
              <p className="hf-text-sm hf-text-secondary">
                {progressMessage || "Generating your lesson plan..."}
              </p>
              {progressStep && (
                <div className="hf-progress-bar-track" style={{ width: "200px" }}>
                  <div
                    className="hf-progress-bar-fill"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
              <p className="hf-text-xs hf-text-muted">This usually takes 15-30 seconds</p>
            </div>
          </div>
        )}

        {/* ── Phase: Skeleton (modules ready, plan refining) ── */}
        {phase === "skeleton" && (
          <div className="hf-flex-col hf-gap-md">
            {/* Progress banner */}
            <div className="hf-banner hf-banner-info">
              <div className="hf-pulse-dot" />
              <div className="hf-flex-col hf-gap-xs hf-flex-1">
                <span className="hf-text-sm hf-text-bold">
                  {progressMessage || "Modules ready — generating detailed session plan..."}
                </span>
                {progressStep && (
                  <div className="hf-progress-bar-track">
                    <div
                      className="hf-progress-bar-fill"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Skeleton session cards */}
            <div className="hf-flex hf-items-center hf-gap-md hf-mb-xs">
              <span className="hf-section-title">{skeletonEntries.length} sessions</span>
              <span className="hf-text-xs hf-text-muted">(refining...)</span>
            </div>
            {skeletonEntries.map((entry, i) => (
              <div key={`skel-${i}`}>
                {renderSessionCard(entry, i, true)}
              </div>
            ))}
          </div>
        )}

        {/* ── Phase: Editing (full plan available) ────────── */}
        {phase === "editing" && (
          <div>
            {/* Regenerate with content banner */}
            {eagerWasGoalsOnly && (
              <div className="hf-banner hf-banner-info hf-mb-md">
                <FileText className="hf-icon-sm hf-flex-shrink-0" />
                <span className="hf-flex-1">
                  Plan generated from learning outcomes. Want to incorporate your uploaded content?
                </span>
                <button
                  onClick={() => {
                    setEntries([]);
                    setSkeletonEntries([]);
                    setReasoning("");
                    handleGenerate();
                  }}
                  className="hf-btn hf-btn-secondary hf-btn-sm"
                >
                  <RefreshCw className="hf-icon-xs" /> Regenerate with content
                </button>
              </div>
            )}

            {reasoning && (
              <div className="hf-ai-callout hf-mb-md">
                <strong className="hf-text-primary">AI reasoning:</strong> {reasoning}
              </div>
            )}

            {/* Knowledge Map — appears when structuring completes */}
            {kmSources.length > 0 && (
              <div className="hf-card-compact hf-mb-md">
                <button
                  className="hf-flex hf-items-center hf-gap-sm hf-w-full hf-cursor-pointer"
                  onClick={() => setKmExpanded((p) => !p)}
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
                >
                  <span className={`hf-chevron--sm${kmExpanded ? " hf-chevron--open" : ""}`} />
                  <span className="hf-section-title">Knowledge Map</span>
                  {kmStats && (
                    <span className="hf-km-badge">
                      {kmStats.totalTopics} topics · {kmStats.totalPoints} points
                    </span>
                  )}
                </button>
                {kmExpanded && (
                  <div className="hf-km-tree hf-mt-sm">
                    <KnowledgeMapTree sources={kmSources} stats={kmStats || undefined} />
                  </div>
                )}
              </div>
            )}

            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
              <span className="hf-text-sm hf-text-muted">Teaching model:</span>
              <span className="hf-chip hf-chip-selected hf-chip-sm" style={{ cursor: "default" }}>
                {getLessonPlanModel(lessonPlanModel).label}
              </span>
            </div>

            <div className="hf-flex hf-items-center hf-gap-md hf-mb-md">
              <span className="hf-section-title">{entries.length} sessions</span>
              <span className="hf-text-xs hf-text-muted">
                {SESSION_TYPES.map((t) => {
                  const count = entries.filter((e) => e.type === t.value).length;
                  return count > 0 ? `${count} ${t.label.toLowerCase()}` : null;
                }).filter(Boolean).join(" \u00b7 ")}
              </span>
            </div>

            {/* Session cards via SortableList */}
            <SortableList
              items={entries}
              onReorder={handleReorder}
              onRemove={handleRemove}
              onDuplicate={handleDuplicate}
              onAdd={() => setShowAdd(true)}
              getItemId={(e) => `${e.session}-${e.label}`}
              addLabel="+ Add Session"
              emptyLabel="No sessions in plan."
              renderCard={(entry, index) => renderSessionCard(entry, index)}
            />

            {/* Add session inline form */}
            {showAdd && (
              <div className="hf-add-form">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="hf-input hf-input-inline"
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddSession();
                    if (e.key === "Escape") setShowAdd(false);
                  }}
                  placeholder="Session label..."
                  autoFocus
                  className="hf-input hf-input-inline-md"
                />
                <button onClick={handleAddSession} className="hf-btn hf-btn-primary hf-btn-sm">Add</button>
                <button onClick={() => setShowAdd(false)} className="hf-btn hf-btn-secondary hf-btn-sm">Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* ── Phase: Intents (manual fallback) ───────────── */}
        {phase === "intents" && (
          <div className="hf-flex-col hf-gap-lg">
            {/* Content status banner */}
            {contentMode === "pack" && (
              <div className="hf-banner hf-banner-success">
                <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span>Course files uploaded — will inform your lesson plan</span>
              </div>
            )}
            {contentMode === "skip" && (
              <div className="hf-banner hf-banner-info">
                No content added — we&apos;ll generate the plan from your learning outcomes.
              </div>
            )}

            {/* Teaching model */}
            <div>
              <div className="hf-mb-xs">
                <FieldHint label="Teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
              </div>
              <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
            </div>

            {/* Session count */}
            <SessionCountPicker value={sessionCount} onChange={setSessionCount} />

            {/* Duration */}
            <div>
              <div className="hf-mb-xs">
                <FieldHint label="How long is each session?" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
              </div>
              <div className="hf-chip-row">
                {DURATIONS.map((d) => (
                  <ChipButton key={d} selected={durationMins === d} onClick={() => setDurationMins(d)}>
                    {d} min
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* Emphasis */}
            <div>
              <div className="hf-mb-xs">
                <FieldHint label="Teaching emphasis" hint={WIZARD_HINTS["course.emphasis"]} labelClass="hf-label" />
              </div>
              <div className="hf-chip-row">
                {EMPHASIS_OPTIONS.map((e) => (
                  <ChipButton key={e} selected={emphasis === e} onClick={() => setEmphasis(e)}>
                    {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
                  </ChipButton>
                ))}
              </div>
              <div className="hf-hint">
                {emphasis === "breadth"
                  ? "Cover all topics at surface level first, then deepen."
                  : emphasis === "depth"
                    ? "Go deep on each topic before moving on."
                    : "Mix of breadth and depth — the AI decides per module."}
              </div>
            </div>

            {/* Assessments */}
            <div>
              <div className="hf-mb-xs">
                <FieldHint label="Include assessments?" hint={WIZARD_HINTS["course.assessments"]} labelClass="hf-label" />
              </div>
              <div className="hf-chip-row">
                <ChipButton selected={assessments === "formal"} onClick={() => setAssessments("formal")}>Yes (formal)</ChipButton>
                <ChipButton selected={assessments === "light"} onClick={() => setAssessments("light")}>Light checks</ChipButton>
                <ChipButton selected={assessments === "none"} onClick={() => setAssessments("none")}>No assessments</ChipButton>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="hf-step-footer">
        <button
          className="hf-btn hf-btn-ghost"
          onClick={() => {
            if (phase === "loading" || phase === "skeleton") {
              handleCancelGeneration();
            } else {
              onPrev();
            }
          }}
        >
          {phase === "loading" || phase === "skeleton" ? "Cancel" : "Back"}
        </button>

        <div className="hf-flex hf-gap-sm hf-items-center">
          {/* Skeleton: accept outline early */}
          {phase === "skeleton" && (
            <button onClick={handleUseOutline} className="hf-btn hf-btn-secondary">
              Use outline <ArrowRight className="hf-icon-sm" />
            </button>
          )}

          {/* Intents: generate or skip */}
          {phase === "intents" && (
            <>
              <button className="hf-btn hf-btn-ghost" onClick={handleSkip}>Skip</button>
              <button onClick={handleGenerate} className="hf-btn hf-btn-primary">
                Generate & Review
              </button>
            </>
          )}

          {/* Editing: regenerate or save */}
          {phase === "editing" && (
            <>
              <button
                onClick={() => { setPhase("intents"); setEntries([]); setSkeletonEntries([]); setReasoning(""); }}
                className="hf-btn hf-btn-secondary"
              >
                Regenerate
              </button>
              <button
                onClick={handleSave}
                disabled={saving || entries.length === 0}
                className="hf-btn hf-btn-primary"
              >
                {saving ? "Saving..." : "Save & Continue"}{" "}
                <ArrowRight className="hf-icon-sm" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────

function ChipButton({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={"hf-chip" + (selected ? " hf-chip-selected" : "")}
    >
      {children}
    </button>
  );
}
