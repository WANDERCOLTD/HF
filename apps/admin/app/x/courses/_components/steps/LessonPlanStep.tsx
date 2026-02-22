"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowRight, CheckCircle, FileText } from "lucide-react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { SortableList } from "@/components/shared/SortableList";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { reorderItems } from "@/lib/sortable/reorder";
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

function getTypeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color || "var(--text-muted)";
}

function getTypeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label || type;
}

// ── Component ──────────────────────────────────────────

export function LessonPlanStep({ setData, getData, onNext, onPrev }: StepProps) {
  // Restore task state from data bag (survives browser refresh)
  const restoredTaskId = getData<string>("planTaskId") || null;

  // Phase tracking — resume generating if task was in progress
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
      if (ctx.message) {
        setError(null); // clear any stale errors while making progress
      }
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
    // Also store top-level for backwards compat with CourseDoneStep
    setData("sessionCount", sessionCount || 12);
    setData("durationMins", durationMins);
    setData("emphasis", emphasis);
  }

  // ── "Accept" — fast path ──────────────────────────────

  function handleAccept() {
    savePlanIntents();
    setData("lessonPlanMode", "accept");
    onNext();
  }

  // ── "Skip" — skip plan entirely ───────────────────────

  function handleSkip() {
    setData("lessonPlanMode", "skipped");
    setData("sessionCount", 12); // sensible default
    setData("durationMins", 30);
    onNext();
  }

  // ── "Generate & Review" — full path ───────────────────

  async function handleGenerate() {
    if (taskId || phase === "generating") return;
    savePlanIntents();
    setError(null);
    setPhase("generating");

    const courseName = getData<string>("courseName");
    const learningOutcomes = getData<string[]>("learningOutcomes") || [];
    const teachingStyle = getData<string>("teachingStyle") || "tutor";
    const sourceId = getData<string>("sourceId");

    try {
      const res = await fetch("/api/courses/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName,
          learningOutcomes,
          teachingStyle,
          sessionCount: sessionCount || 12,
          durationMins,
          emphasis,
          assessments,
          sourceId: sourceId || undefined,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to start plan generation");
      }
      setTaskId(data.taskId);
      setData("planTaskId", data.taskId);
    } catch (err: any) {
      setError(err.message || "Failed to start plan generation");
      setPhase("intents");
    }
  }

  // ── Save & Continue — after editing ───────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      // Re-number sessions sequentially
      const numbered = entries.map((e, i) => ({ ...e, session: i + 1 }));

      // If we have a curriculumId, persist the plan
      if (curriculumId) {
        const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: numbered }),
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to save lesson plan");
        }
      }

      // Save to flow bag
      savePlanIntents();
      setData("lessonPlanMode", "reviewed");
      setData("subjectId", subjectId);
      setData("curriculumId", curriculumId);
      setData("lessonPlan", numbered);
      onNext();
    } catch (err: any) {
      setError(err.message || "Failed to save lesson plan");
    } finally {
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
      {
        session: prev.length + 1,
        type: newType,
        moduleId: null,
        moduleLabel: "",
        label: newLabel.trim(),
      },
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
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <div style={{ marginBottom: 24 }}>
          <h1 className="hf-page-title">Plan your sessions</h1>
          <p className="hf-page-subtitle">
            Set how many sessions, how long, and how deep — or generate a full plan.
          </p>
        </div>

        {/* Error banner */}
        <ErrorBanner error={error} style={{ marginBottom: 16 }} />

        {/* ── Phase A: Intent Pills ────────────────────── */}
        {(phase === "intents" || phase === "generating") && (
          <div className="flex flex-col gap-5">
            {/* Content status banner */}
            {contentMode === "file" && contentFileName && (
              <div className="hf-banner hf-banner-success">
                <CheckCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span>
                  <FileText style={{ width: 14, height: 14, display: "inline", marginRight: 4 }} />
                  {contentFileName} uploaded{getData<string>("sourceId") ? " — will inform your lesson plan" : ""}
                </span>
              </div>
            )}
            {contentMode === "describe" && contentDescription && (
              <div className="hf-banner hf-banner-info">
                <CheckCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
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
              <div className="hf-label" style={{ marginBottom: 8 }}>
                How long is each session?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map((d) => (
                  <ChipButton key={d} selected={durationMins === d} onClick={() => setDurationMins(d)}>
                    {d} min
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* Emphasis */}
            <div>
              <div className="hf-label" style={{ marginBottom: 8 }}>
                Teaching emphasis
              </div>
              <div className="flex flex-wrap gap-1.5">
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
              <div className="hf-label" style={{ marginBottom: 8 }}>
                Include assessments?
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ChipButton selected={assessments === "formal"} onClick={() => setAssessments("formal")}>
                  Yes (formal)
                </ChipButton>
                <ChipButton selected={assessments === "light"} onClick={() => setAssessments("light")}>
                  Light checks
                </ChipButton>
                <ChipButton selected={assessments === "none"} onClick={() => setAssessments("none")}>
                  No assessments
                </ChipButton>
              </div>
            </div>

            {/* Generating spinner (overlays the pills when generating) */}
            {phase === "generating" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="hf-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
                <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
                  Generating your lesson plan...
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  This usually takes 15-30 seconds
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Phase C: Editing ─────────────────────────── */}
        {phase === "editing" && (
          <div>
            {/* AI reasoning */}
            {reasoning && (
              <div className="hf-ai-callout" style={{ marginBottom: 20 }}>
                <strong style={{ color: "var(--text-primary)" }}>AI reasoning:</strong> {reasoning}
              </div>
            )}

            {/* Session count summary */}
            <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
              <span className="hf-section-title">{entries.length} sessions</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {SESSION_TYPES.map((t) => {
                  const count = entries.filter((e) => e.type === t.value).length;
                  return count > 0 ? `${count} ${t.label.toLowerCase()}` : null;
                })
                  .filter(Boolean)
                  .join(" \u00b7 ")}
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <select
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                        className="hf-input"
                        style={{ width: "auto", padding: "4px 8px", fontSize: 11, fontWeight: 600 }}
                      >
                        {SESSION_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
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
                        className="hf-input"
                        style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
                      />
                      <button
                        onClick={() => handleInlineEditSave(index)}
                        className="hf-btn hf-btn-primary"
                        style={{ padding: "4px 10px", fontSize: 11 }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="hf-btn hf-btn-secondary"
                        style={{ padding: "4px 10px", fontSize: 11 }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                      onClick={() => {
                        setEditingIndex(index);
                        setEditLabel(entry.label);
                        setEditType(entry.type);
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          fontVariantNumeric: "tabular-nums",
                          minWidth: 20,
                        }}
                      >
                        {index + 1}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 6px",
                          borderRadius: 3,
                          fontSize: 10,
                          fontWeight: 600,
                          color: getTypeColor(entry.type),
                          background: `color-mix(in srgb, ${getTypeColor(entry.type)} 10%, transparent)`,
                          textTransform: "uppercase",
                        }}
                      >
                        {getTypeLabel(entry.type)}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>
                        {entry.label}
                      </span>
                      {entry.moduleLabel && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {entry.moduleLabel}
                        </span>
                      )}
                      {entry.estimatedDurationMins && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {entry.estimatedDurationMins}m
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            />

            {/* Add session inline form */}
            {showAdd && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px dashed var(--border-default)",
                  marginTop: 8,
                  marginBottom: 8,
                }}
              >
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="hf-input"
                  style={{ width: "auto", padding: "4px 8px", fontSize: 11, fontWeight: 600 }}
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
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
                  className="hf-input"
                  style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
                />
                <button
                  onClick={handleAddSession}
                  className="hf-btn hf-btn-primary"
                  style={{ padding: "4px 12px", fontSize: 11 }}
                >
                  Add
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="hf-btn hf-btn-secondary"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="hf-step-footer">
        <button
          className="hf-btn-ghost"
          onClick={() => {
            if (phase === "generating") {
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

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {phase === "intents" && (
            <button className="hf-btn-ghost" onClick={handleSkip}>
              Skip
            </button>
          )}

          {/* Phase A: Two action buttons */}
          {phase === "intents" && (
            <>
              <button onClick={handleGenerate} className="hf-btn hf-btn-secondary">
                Generate & Review
              </button>
              <button onClick={handleAccept} className="hf-btn hf-btn-primary">
                Accept <ArrowRight style={{ width: 16, height: 16 }} />
              </button>
            </>
          )}

          {/* Phase C: Save & Continue */}
          {phase === "editing" && (
            <>
              <button
                onClick={() => {
                  setPhase("intents");
                  setEntries([]);
                  setReasoning("");
                }}
                className="hf-btn hf-btn-secondary"
              >
                Regenerate
              </button>
              <button
                onClick={handleSave}
                disabled={saving || entries.length === 0}
                className="hf-btn hf-btn-primary"
                style={{ opacity: saving || entries.length === 0 ? 0.6 : 1 }}
              >
                {saving ? "Saving..." : "Save & Continue"}{" "}
                <ArrowRight style={{ width: 16, height: 16 }} />
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
