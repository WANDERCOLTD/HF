"use client";

import { useState, useEffect, useCallback } from "react";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { SortableList } from "@/components/shared/SortableList";
import { reorderItems } from "@/lib/sortable/reorder";
import type { StepProps } from "../types";

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
  { value: "onboarding", label: "Onboarding", color: "var(--accent-secondary, #8b5cf6)" },
  { value: "introduce", label: "Introduce", color: "var(--accent-primary)" },
  { value: "deepen", label: "Deepen", color: "var(--badge-cyan-text, #0891b2)" },
  { value: "review", label: "Review", color: "var(--badge-orange-text, #ea580c)" },
  { value: "assess", label: "Assess", color: "var(--status-error-text)" },
  { value: "consolidate", label: "Consolidate", color: "var(--status-success-text)" },
] as const;

const DURATIONS = [15, 20, 30, 45, 60] as const;
const EMPHASIS_OPTIONS = ["breadth", "depth", "balanced"] as const;
const ASSESSMENT_OPTIONS = ["formal", "light", "none"] as const;

function getTypeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color || "var(--text-muted)";
}

function getTypeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label || type;
}

export default function PlanStep({ setData, getData, onNext, onPrev }: StepProps) {
  const subjectId = getData<string>("subjectId");
  const subjectName = getData<string>("subjectName");

  // Restore task state from data bag (survives browser refresh)
  const restoredPlanTaskId = getData<string>("planTaskId") || null;
  const restoredCurrGenTaskId = getData<string>("currGenTaskId") || null;

  // Phase tracking — resume from where we left off
  const [phase, setPhase] = useState<"intents" | "generating" | "editing">(restoredPlanTaskId ? "generating" : "intents");

  // Intent inputs
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(15);
  const [emphasis, setEmphasis] = useState<typeof EMPHASIS_OPTIONS[number]>("balanced");
  const [assessments, setAssessments] = useState<typeof ASSESSMENT_OPTIONS[number]>("light");

  // Curriculum
  const [curriculumId, setCurriculumId] = useState<string | null>(getData<string>("curriculumId") || null);
  const [curriculumStatus, setCurriculumStatus] = useState<"unknown" | "checking" | "none" | "generating" | "ready">(restoredCurrGenTaskId ? "generating" : "unknown");
  const [currGenTaskId, setCurrGenTaskId] = useState<string | null>(restoredCurrGenTaskId);

  // Lesson plan
  const [entries, setEntries] = useState<LessonEntry[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [generating, setGenerating] = useState(!!restoredPlanTaskId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");

  // Adding new session
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<string>("introduce");

  // ── Check for existing curriculum ────────────────────
  useEffect(() => {
    if (!subjectId || curriculumId) return;
    setCurriculumStatus("checking");
    fetch(`/api/subjects/${subjectId}/curriculum`)
      .then((r) => r.json())
      .then((data) => {
        if (data.curriculum?.id) {
          setCurriculumId(data.curriculum.id);
          setCurriculumStatus("ready");
        } else {
          setCurriculumStatus("none");
        }
      })
      .catch(() => setCurriculumStatus("none"));
  }, [subjectId, curriculumId]);

  // ── Poll curriculum generation task ──────────────────
  useEffect(() => {
    if (!currGenTaskId || curriculumStatus !== "generating") return;
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const interval = setInterval(async () => {
      // Timeout guard
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        setError("Curriculum generation timed out. Please try again.");
        setCurriculumStatus("none");
        setCurrGenTaskId(null);
        setData("currGenTaskId", null);
        return;
      }
      try {
        const res = await fetch(`/api/tasks?taskId=${currGenTaskId}`);
        const data = await res.json();
        const task = data.task || data.tasks?.[0];
        if (task?.status === "completed") {
          clearInterval(interval);
          // Save curriculum from task
          const saveRes = await fetch(`/api/subjects/${subjectId}/curriculum`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "save", taskId: currGenTaskId }),
          });
          const saveData = await saveRes.json();
          if (saveData.curriculum?.id) {
            setCurriculumId(saveData.curriculum.id);
            setCurriculumStatus("ready");
            setData("currGenTaskId", null);
          } else {
            setError(saveData.error || "Failed to save curriculum. Please try again.");
            setCurriculumStatus("none");
            setData("currGenTaskId", null);
          }
        } else if (task?.status === "failed" || task?.status === "abandoned") {
          clearInterval(interval);
          const ctx = (task.context as Record<string, any>) || {};
          setError(ctx.error || "Curriculum generation failed. Please try again.");
          setCurriculumStatus("none");
          setCurrGenTaskId(null);
          setData("currGenTaskId", null);
        }
      } catch {
        // silent — poll continues
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [currGenTaskId, curriculumStatus, subjectId]);

  // ── Generate curriculum (if none exists) ─────────────
  async function handleGenerateCurriculum() {
    if (!subjectId) return;
    setCurriculumStatus("generating");
    setError(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/curriculum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate" }),
      });
      const data = await res.json();
      if (data.taskId) {
        setCurrGenTaskId(data.taskId);
        setData("currGenTaskId", data.taskId);
      } else {
        setError(data.error || "Failed to start curriculum generation");
        setCurriculumStatus("none");
      }
    } catch {
      setError("Failed to start curriculum generation");
      setCurriculumStatus("none");
    }
  }

  // Lesson plan task
  const [planTaskId, setPlanTaskId] = useState<string | null>(restoredPlanTaskId);

  // ── Generate lesson plan (starts async job) ─────────────────────────────
  async function handleGeneratePlan() {
    if (!curriculumId || generating || planTaskId) return;
    setGenerating(true);
    setError(null);
    setPhase("generating");
    try {
      const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalSessionTarget: sessionCount,
          durationMins,
          emphasis,
          includeAssessments: assessments,
        }),
      });
      const data = await res.json();
      if (data.taskId) {
        // Job submitted async, store taskId and poll
        setPlanTaskId(data.taskId);
        setData("planTaskId", data.taskId);
      } else {
        setError(data.error || "Failed to start lesson plan generation");
        setPhase("intents");
        setGenerating(false);
      }
    } catch {
      setError("Failed to start lesson plan generation");
      setPhase("intents");
      setGenerating(false);
    }
  }

  // ── Poll lesson plan task ──────────────────────────────
  useEffect(() => {
    if (!planTaskId) return;
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const interval = setInterval(async () => {
      // Timeout guard
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        setError("Lesson plan generation timed out. Please try again.");
        setPhase("intents");
        setGenerating(false);
        setPlanTaskId(null);
        setData("planTaskId", null);
        return;
      }
      try {
        const res = await fetch(`/api/tasks?taskId=${planTaskId}`);
        const data = await res.json();
        const task = data.task || data.tasks?.[0]; // Handle both response formats
        const ctx = (task?.context as Record<string, any>) || {};

        if (task?.status === "completed") {
          clearInterval(interval);
          if (ctx.error) {
            setError(ctx.error);
            setPhase("intents");
            setGenerating(false);
          } else if (ctx.plan && Array.isArray(ctx.plan)) {
            setEntries(ctx.plan);
            setReasoning(ctx.reasoning || "");
            setPhase("editing");
            setGenerating(false);
          } else {
            setError("Lesson plan not found in task result");
            setPhase("intents");
            setGenerating(false);
          }
          setPlanTaskId(null);
          setData("planTaskId", null);
        } else if (task?.status === "failed" || task?.status === "abandoned") {
          clearInterval(interval);
          setError(ctx.error || "Lesson plan generation failed. Please try again.");
          setPhase("intents");
          setGenerating(false);
          setPlanTaskId(null);
          setData("planTaskId", null);
        } else if (task?.status === "in_progress" && ctx.error) {
          // Background job errored but didn't set terminal status
          clearInterval(interval);
          setError(ctx.error);
          setPhase("intents");
          setGenerating(false);
          setPlanTaskId(null);
          setData("planTaskId", null);
        }
      } catch {
        // Silent — poll continues
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [planTaskId]);

  // ── Intent form → generate ───────────────────────────
  async function handleIntentSubmit() {
    if (generating || curriculumStatus === "generating" || curriculumStatus === "checking") return;
    if (curriculumStatus === "none") {
      await handleGenerateCurriculum();
      // Curriculum generation is async — it'll auto-trigger plan generation when ready
    } else if (curriculumStatus === "ready" && curriculumId) {
      await handleGeneratePlan();
    }
  }

  // Auto-generate lesson plan when curriculum becomes ready (after generation)
  useEffect(() => {
    if (curriculumStatus === "ready" && curriculumId && phase === "intents" && !generating && entries.length === 0) {
      // Only auto-generate if we were waiting for curriculum
      if (currGenTaskId) {
        handleGeneratePlan();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculumStatus, curriculumId]);

  // ── Save lesson plan ─────────────────────────────────
  async function handleSave() {
    if (!curriculumId || entries.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Re-number sessions sequentially
      const numbered = entries.map((e, i) => ({ ...e, session: i + 1 }));
      const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: numbered }),
      });
      const data = await res.json();
      if (data.ok) {
        setData("curriculumId", curriculumId);
        setData("lessonCount", entries.length);
        setData("planIntents", { sessionCount, durationMins, emphasis, assessments });
        onNext();
      } else {
        setError(data.error || "Failed to save lesson plan");
      }
    } catch {
      setError("Failed to save lesson plan");
    } finally {
      setSaving(false);
    }
  }

  // ── SortableList callbacks ───────────────────────────
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
      prev.map((e, i) => (i === index ? { ...e, label: editLabel, type: editType } : e))
    );
    setEditingIndex(null);
  }

  // ── Render ───────────────────────────────────────────

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
        Plan your lessons
      </h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 20px" }}>
        Tell us how you want to teach <strong>{subjectName}</strong>, and we&apos;ll create a session plan.
      </p>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: "color-mix(in srgb, var(--status-error-text) 8%, transparent)",
          color: "var(--status-error-text)",
          border: "1px solid color-mix(in srgb, var(--status-error-text) 20%, transparent)",
        }}>
          {error}
        </div>
      )}

      {/* ── Phase A: Intent Questions ──────────────── */}
      {(phase === "intents" || phase === "generating") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Curriculum status banner */}
          {curriculumStatus === "checking" && (
            <StatusBanner color="var(--text-muted)">Checking for existing curriculum...</StatusBanner>
          )}
          {curriculumStatus === "generating" && (
            <StatusBanner color="var(--accent-primary)">
              Generating curriculum from your content... This may take a minute.
            </StatusBanner>
          )}
          {curriculumStatus === "ready" && (
            <StatusBanner color="var(--status-success-text, #16a34a)">
              {"\u2713"} Curriculum ready
            </StatusBanner>
          )}

          {/* Session count */}
          <SessionCountPicker value={sessionCount} onChange={setSessionCount} />

          {/* Duration */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
              How long is each session?
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DURATIONS.map((d) => (
                <ChipButton key={d} selected={durationMins === d} onClick={() => setDurationMins(d)}>
                  {d} min
                </ChipButton>
              ))}
            </div>
          </div>

          {/* Emphasis */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
              Teaching emphasis
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {EMPHASIS_OPTIONS.map((e) => (
                <ChipButton key={e} selected={emphasis === e} onClick={() => setEmphasis(e)}>
                  {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
                </ChipButton>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
              {emphasis === "breadth"
                ? "Cover all topics at surface level first, then deepen."
                : emphasis === "depth"
                  ? "Go deep on each topic before moving on."
                  : "Mix of breadth and depth — the AI decides per module."}
            </div>
          </div>

          {/* Assessments */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
              Include assessments?
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

          {/* Generate button */}
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button
              onClick={handleIntentSubmit}
              disabled={generating || curriculumStatus === "checking" || curriculumStatus === "generating"}
              style={{
                padding: "12px 32px", borderRadius: 8, border: "none",
                background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: generating || curriculumStatus === "checking" || curriculumStatus === "generating" ? 0.6 : 1,
              }}
            >
              {generating
                ? "Generating plan..."
                : curriculumStatus === "generating"
                  ? "Generating curriculum..."
                  : curriculumStatus === "none"
                    ? "Generate Curriculum + Plan"
                    : "Generate Lesson Plan"}
            </button>
            <button onClick={onPrev}
              style={{
                padding: "12px 24px", borderRadius: 8,
                border: "1px solid var(--border-default)", background: "transparent",
                color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* ── Phase B/C: Editing plan ────────────────── */}
      {phase === "editing" && (
        <div>
          {/* AI reasoning */}
          {reasoning && (
            <div style={{
              padding: "12px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, lineHeight: 1.6,
              background: "color-mix(in srgb, var(--accent-primary) 6%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)",
              color: "var(--text-secondary)",
            }}>
              <strong style={{ color: "var(--text-primary)" }}>AI reasoning:</strong> {reasoning}
            </div>
          )}

          {/* Session count summary */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              {entries.length} sessions
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {SESSION_TYPES.map((t) => {
                const count = entries.filter((e) => e.type === t.value).length;
                return count > 0 ? `${count} ${t.label.toLowerCase()}` : null;
              }).filter(Boolean).join(" · ")}
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
                  /* Inline editing */
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                      style={{
                        padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                        border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {SESSION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleInlineEditSave(index); if (e.key === "Escape") setEditingIndex(null); }}
                      autoFocus
                      style={{
                        flex: 1, padding: "4px 8px", borderRadius: 4, fontSize: 13,
                        border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button onClick={() => handleInlineEditSave(index)}
                      style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Save
                    </button>
                    <button onClick={() => setEditingIndex(null)}
                      style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* Display mode */
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    onClick={() => { setEditingIndex(index); setEditLabel(entry.label); setEditType(entry.type); }}
                  >
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums", minWidth: 20,
                    }}>
                      {index + 1}
                    </span>
                    <span style={{
                      display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600,
                      color: getTypeColor(entry.type),
                      background: `color-mix(in srgb, ${getTypeColor(entry.type)} 10%, transparent)`,
                      textTransform: "uppercase",
                    }}>
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
                    {(entry.assertionCount || entry.questionCount || entry.vocabularyCount) && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)", display: "inline-flex", gap: 4 }}>
                        {entry.assertionCount ? `${entry.assertionCount} pts` : null}
                        {entry.questionCount ? `${entry.questionCount} Q` : null}
                        {entry.vocabularyCount ? `${entry.vocabularyCount} vocab` : null}
                      </span>
                    )}
                    {entry.estimatedDurationMins && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
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
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              borderRadius: 8, border: "1px dashed var(--border-default)", marginTop: 8, marginBottom: 8,
            }}>
              <select value={newType} onChange={(e) => setNewType(e.target.value)}
                style={{
                  padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                  color: "var(--text-primary)",
                }}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddSession(); if (e.key === "Escape") setShowAdd(false); }}
                placeholder="Session label..."
                autoFocus
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 4, fontSize: 13,
                  border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                  color: "var(--text-primary)",
                }}
              />
              <button onClick={handleAddSession}
                style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Add
              </button>
              <button onClick={() => setShowAdd(false)}
                style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button onClick={handleSave} disabled={saving || entries.length === 0}
              style={{
                padding: "12px 32px", borderRadius: 8, border: "none",
                background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: saving || entries.length === 0 ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Plan & Continue"}
            </button>
            <button
              onClick={() => {
                setPhase("intents");
                setEntries([]);
                setReasoning("");
              }}
              style={{
                padding: "12px 24px", borderRadius: 8,
                border: "1px solid var(--border-default)", background: "transparent",
                color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
              }}
            >
              Regenerate
            </button>
            <button onClick={onPrev}
              style={{
                padding: "12px 24px", borderRadius: 8,
                border: "1px solid var(--border-default)", background: "transparent",
                color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────

function ChipButton({ children, selected, onClick }: { children: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-default)"}`,
        background: selected ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)" : "var(--surface-primary)",
        color: selected ? "var(--accent-primary)" : "var(--text-secondary)",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function StatusBanner({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div style={{
      padding: "8px 14px", borderRadius: 8, fontSize: 13,
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      color,
    }}>
      {children}
    </div>
  );
}
