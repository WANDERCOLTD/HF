"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowRight, CheckCircle, FileText } from "lucide-react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { SortableList } from "@/components/shared/SortableList";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { reorderItems } from "@/lib/sortable/reorder";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import type { StepProps } from "../CourseSetupWizard";

// ── Types ──────────────────────────────────────────────

type Phase = "intents" | "generating" | "editing";

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
  const restoredTaskId = getData<string>("planTaskId") || null;
  const [phase, setPhase] = useState<Phase>(restoredTaskId ? "generating" : "intents");

  // Intent inputs
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(30);
  const [emphasis, setEmphasis] = useState<typeof EMPHASIS_OPTIONS[number]>("balanced");
  const [assessments, setAssessments] = useState<typeof ASSESSMENT_OPTIONS[number]>("light");

  // Generation
  const [taskId, setTaskId] = useState<string | null>(restoredTaskId);
  const [error, setError] = useState<string | null>(null);

  // Lesson plan editing
  const [entries, setEntries] = useState<LessonEntry[]>([]);
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

  // Content from previous step
  const contentMode = getData<string>("contentMode");
  const contentFileName = getData<string>("contentFileName");
  const contentDescription = getData<string>("contentDescription");

  // Restore saved intents from flow bag
  useEffect(() => {
    const saved = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string }>("planIntents");
    if (saved) {
      if (saved.sessionCount) setSessionCount(saved.sessionCount);
      if (saved.durationMins) setDurationMins(saved.durationMins);
      if (saved.emphasis) setEmphasis(saved.emphasis as typeof emphasis);
      if (saved.assessments) setAssessments(saved.assessments as typeof assessments);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Task polling for Generate & Review ────────────────

  useTaskPoll({
    taskId,
    onProgress: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.message) setError(null);
    }, []),
    onComplete: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.error) {
        setError(ctx.error);
        setPhase("intents");
        setTaskId(null);
        setData("planTaskId", null);
        return;
      }
      setError(null);
      if (ctx.plan && Array.isArray(ctx.plan)) {
        setEntries(ctx.plan);
        setReasoning(ctx.reasoning || "");
        setSubjectId(ctx.subjectId || null);
        setCurriculumId(ctx.curriculumId || null);
        setPhase("editing");
      } else {
        setError("Lesson plan not found in task result");
        setPhase("intents");
      }
      setTaskId(null);
      setData("planTaskId", null);
    }, [setData]),
    onError: useCallback((message: string) => {
      setError(message);
      setPhase("intents");
      setTaskId(null);
      setData("planTaskId", null);
    }, [setData]),
  });

  // ── Intent helpers ────────────────────────────────────

  function savePlanIntents() {
    setData("planIntents", {
      sessionCount: sessionCount || 12,
      durationMins,
      emphasis,
      assessments,
    });
    setData("sessionCount", sessionCount || 12);
    setData("durationMins", durationMins);
    setData("emphasis", emphasis);
  }

  function handleAccept() {
    savePlanIntents();
    setData("lessonPlanMode", "accept");
    onNext();
  }

  function handleSkip() {
    setData("lessonPlanMode", "skipped");
    setData("sessionCount", 12);
    setData("durationMins", 30);
    onNext();
  }

  async function handleGenerate() {
    if (taskId || phase === "generating") return;
    savePlanIntents();
    setError(null);
    setPhase("generating");

    // Abort any previous generate request
    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const courseName = getData<string>("courseName");
    const learningOutcomes = getData<string[]>("learningOutcomes") || [];
    const teachingStyle = getData<string>("teachingStyle") || "tutor";
    const sourceId = getData<string>("sourceId");

    try {
      const res = await fetch("/api/courses/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName, learningOutcomes, teachingStyle,
          sessionCount: sessionCount || 12, durationMins, emphasis, assessments,
          sourceId: sourceId || undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to start plan generation");
      setTaskId(data.taskId);
      setData("planTaskId", data.taskId);
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

  // ── Save & Continue — with timeout guard ───────────────

  async function handleSave() {
    setSaving(true);
    setError(null);

    // Abort any previous in-flight save
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;

    // Timeout guard — abort after SAVE_TIMEOUT_MS
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

  // ── Render ────────────────────────────────────────────

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title">Plan your sessions</h1>
          <p className="hf-page-subtitle">
            Set how many sessions, how long, and how deep — or generate a full plan.
          </p>
        </div>

        {/* Error banner */}
        <ErrorBanner error={error} className="hf-mb-md" />

        {/* ── Phase A: Intent Pills ────────────────────── */}
        {(phase === "intents" || phase === "generating") && (
          <div className="hf-flex hf-flex-col hf-gap-lg">
            {/* Content status banner */}
            {contentMode === "file" && contentFileName && (
              <div className="hf-banner hf-banner-success">
                <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span>
                  <FileText className="hf-icon-xs hf-icon-inline" />
                  {contentFileName} uploaded{getData<string>("sourceId") ? " — will inform your lesson plan" : ""}
                </span>
              </div>
            )}
            {contentMode === "describe" && contentDescription && (
              <div className="hf-banner hf-banner-info">
                <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span>Course description provided</span>
              </div>
            )}
            {contentMode === "skip" && (
              <div className="hf-banner hf-banner-info">
                No content added — we&apos;ll generate the plan from your learning outcomes.
              </div>
            )}

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

            {/* Generating spinner */}
            {phase === "generating" && (
              <div className="hf-flex hf-flex-col hf-items-center hf-gap-sm hf-py-lg">
                <div className="hf-spinner hf-icon-lg hf-spinner-thick" />
                <p className="hf-text-sm hf-text-secondary">Generating your lesson plan...</p>
                <p className="hf-text-xs hf-text-muted">This usually takes 15-30 seconds</p>
              </div>
            )}
          </div>
        )}

        {/* ── Phase C: Editing ─────────────────────────── */}
        {phase === "editing" && (
          <div>
            {reasoning && (
              <div className="hf-ai-callout hf-mb-md">
                <strong className="hf-text-primary">AI reasoning:</strong> {reasoning}
              </div>
            )}

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
              renderCard={(entry, index) => (
                <div>
                  {editingIndex === index ? (
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
                      className="hf-session-row"
                      onClick={() => {
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
                      {entry.moduleLabel && (
                        <span className="hf-session-meta">{entry.moduleLabel}</span>
                      )}
                      {entry.estimatedDurationMins && (
                        <span className="hf-session-meta">{entry.estimatedDurationMins}m</span>
                      )}
                    </div>
                  )}
                </div>
              )}
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
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="hf-step-footer">
        <button
          className="hf-btn hf-btn-ghost"
          onClick={() => {
            if (phase === "generating") {
              generateAbortRef.current?.abort();
              setTaskId(null);
              setData("planTaskId", null);
              setPhase("intents");
              setError(null);
            } else {
              onPrev();
            }
          }}
        >
          {phase === "generating" ? "Cancel" : "Back"}
        </button>

        <div className="hf-flex hf-gap-sm hf-items-center">
          {phase === "intents" && (
            <button className="hf-btn hf-btn-ghost" onClick={handleSkip}>Skip</button>
          )}

          {phase === "intents" && (
            <>
              <button onClick={handleGenerate} className="hf-btn hf-btn-secondary">Generate & Review</button>
              <button onClick={handleAccept} className="hf-btn hf-btn-primary">
                Accept <ArrowRight className="hf-icon-sm" />
              </button>
            </>
          )}

          {phase === "editing" && (
            <>
              <button
                onClick={() => { setPhase("intents"); setEntries([]); setReasoning(""); }}
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
