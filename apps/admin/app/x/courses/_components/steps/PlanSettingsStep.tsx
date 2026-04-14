"use client";

/**
 * PlanSettingsStep — teacher configures lesson plan parameters before generation.
 *
 * Reads cascade-resolved defaults from data bag (set by IntentStep).
 * On "Generate & Review": saves planIntents, fires /api/courses/generate-plan,
 * sets planTaskId, and advances. LessonPlanStep picks up the task automatically.
 */

import { useState, useEffect, useRef } from "react";
import { CheckCircle } from "lucide-react";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import { DURATIONS, EMPHASIS_OPTIONS, ASSESSMENT_OPTIONS } from "../plan-constants";
import type { StepProps } from "../CourseSetupWizard";

export function PlanSettingsStep({ setData, getData, onNext, onPrev }: StepProps) {
  // ── State ──────────────────────────────────────────
  // Source of truth for structured vs continuous is IntentStep (data bag key "learningStructure").
  // Hydrated on mount below; falls back to "structured".
  const [lessonPlanMode, setLessonPlanMode] = useState<"structured" | "continuous">("structured");
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(15);
  const [emphasis, setEmphasis] = useState<typeof EMPHASIS_OPTIONS[number]>("balanced");
  const [assessments, setAssessments] = useState<typeof ASSESSMENT_OPTIONS[number]>("light");
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isContinuous = lessonPlanMode === "continuous";

  const contentMode = getData<string>("contentMode");

  // ── On mount: restore from cascade defaults + saved intents ──
  useEffect(() => {
    const resolved = getData<{
      sessionCount: number;
      durationMins: number;
      emphasis: string;
      assessments: string;
      lessonPlanModel: string;
    }>("resolvedDefaults");
    if (resolved) {
      setSessionCount(resolved.sessionCount);
      setDurationMins(resolved.durationMins);
      setEmphasis(resolved.emphasis as typeof emphasis);
      setAssessments(resolved.assessments as typeof assessments);
      setLessonPlanModel(resolved.lessonPlanModel as LessonPlanModel);
    }

    // Override with saved intents (if teacher stepped back)
    const saved = getData<{
      sessionCount: number;
      durationMins: number;
      emphasis: string;
      assessments: string;
      lessonPlanModel?: string;
    }>("planIntents");
    if (saved) {
      if (saved.sessionCount) setSessionCount(saved.sessionCount);
      if (saved.durationMins) setDurationMins(saved.durationMins);
      if (saved.emphasis) setEmphasis(saved.emphasis as typeof emphasis);
      if (saved.assessments) setAssessments(saved.assessments as typeof assessments);
      if (saved.lessonPlanModel) setLessonPlanModel(saved.lessonPlanModel as LessonPlanModel);
    }

    // Learning structure — set in IntentStep, canonical source
    const structure = getData<"structured" | "continuous">("learningStructure");
    if (structure === "continuous") setLessonPlanMode("continuous");
    else setLessonPlanMode("structured");

    // Also restore model from IntentStep's direct key
    const directModel = getData<LessonPlanModel>("lessonPlanModel");
    if (directModel) setLessonPlanModel(directModel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ────────────────────────────────────────

  function savePlanIntents() {
    const intents = {
      sessionCount: isContinuous ? 1 : (sessionCount || 6),
      durationMins,
      emphasis,
      assessments,
      lessonPlanModel,
      lessonPlanMode,
    };
    setData("planIntents", intents);
    setData("sessionCount", intents.sessionCount);
    setData("durationMins", durationMins);
    setData("emphasis", emphasis);
    setData("lessonPlanModel", lessonPlanModel);
    setData("lessonPlanMode", lessonPlanMode);
  }

  async function handleGenerate() {
    if (generating) return;
    savePlanIntents();
    setError(null);
    setGenerating(true);

    // Clear any existing plan data (e.g. from eager generation or previous attempt)
    setData("lessonPlan", null);
    setData("planReasoning", null);
    setData("lessonPlanMode", isContinuous ? "continuous" : "reviewed");

    // ── Continuous mode: skip AI generation, create single entry directly ──
    if (isContinuous) {
      const continuousEntry = {
        session: 1,
        type: "continuous",
        moduleId: null,
        moduleLabel: "",
        label: "Learning Programme",
        learningOutcomeRefs: null,
        assertionIds: null,
      };
      setData("lessonPlan", { estimatedSessions: 1, entries: [continuousEntry] });
      setData("planReasoning", "Continuous learning mode — the system will adaptively select teaching points per call based on learner mastery.");
      setGenerating(false);
      onNext();
      return;
    }

    // ── Structured mode: generate lesson plan via AI ──
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
          courseName,
          learningOutcomes,
          teachingStyle,
          interactionPattern,
          sessionCount: sessionCount || 6,
          durationMins,
          emphasis,
          assessments,
          lessonPlanModel,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to start plan generation");

      // Set the task ID — LessonPlanStep will pick this up and start polling
      setData("planTaskId", data.taskId);
      setData("stepProcessing_lesson-plan", true);
      onNext();
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === "AbortError") {
        setError("Request timed out. Please try again.");
      } else {
        setError(e.message || "Failed to start plan generation");
      }
      setGenerating(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Render ─────────────────────────────────────────

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title">Plan Settings</h1>
          <p className="hf-page-subtitle">
            Set how many sessions, how long, and how deep — then we&apos;ll build your lesson plan.
          </p>
        </div>

        {error && (
          <div className="hf-banner hf-banner-error hf-mb-md">{error}</div>
        )}

        {/* Content status banner */}
        {contentMode === "pack" && (
          <div className="hf-banner hf-banner-success hf-mb-md">
            <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
            <span>Course files uploaded — will inform your lesson plan</span>
          </div>
        )}
        {contentMode === "skip" && (
          <div className="hf-banner hf-banner-info hf-mb-md">
            No content added — we&apos;ll generate the plan from your learning outcomes.
          </div>
        )}

        {/* Read-only summary — canonical source is IntentStep */}
        <div className="hf-banner hf-banner-info hf-mb-md">
          <span>
            Learning structure: <strong>{isContinuous ? "Continuous Learning" : "Structured Sessions"}</strong>
            {" — "}change on the previous step.
          </span>
        </div>

        <div className="hf-flex-col hf-gap-lg">
          {/* Teaching model */}
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="Teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
            </div>
            <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
          </div>

          {/* Session count — hidden in continuous mode */}
          {!isContinuous && (
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="Suggested number of sessions" hint={WIZARD_HINTS["course.sessions"] ?? "Starting target — the system adjusts based on your content once extracted."} labelClass="hf-label" />
            </div>
            <SessionCountPicker value={sessionCount} onChange={setSessionCount} hideLabel />
          </div>
          )}

          {/* Duration */}
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="How long is each session?" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
            </div>
            <div className="hf-chip-row">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDurationMins(d)}
                  className={"hf-chip" + (durationMins === d ? " hf-chip-selected" : "")}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Emphasis — hidden in continuous mode (system adapts per-call) */}
          {!isContinuous && (
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="Teaching emphasis" hint={WIZARD_HINTS["course.emphasis"]} labelClass="hf-label" />
            </div>
            <div className="hf-chip-row">
              {EMPHASIS_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmphasis(e)}
                  className={"hf-chip" + (emphasis === e ? " hf-chip-selected" : "")}
                >
                  {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
                </button>
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
          )}

          {/* Assessments */}
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="Include assessments?" hint={WIZARD_HINTS["course.assessments"]} labelClass="hf-label" />
            </div>
            <div className="hf-chip-row">
              <button
                onClick={() => setAssessments("formal")}
                className={"hf-chip" + (assessments === "formal" ? " hf-chip-selected" : "")}
              >
                Yes (formal)
              </button>
              <button
                onClick={() => setAssessments("light")}
                className={"hf-chip" + (assessments === "light" ? " hf-chip-selected" : "")}
              >
                Light checks
              </button>
              <button
                onClick={() => setAssessments("none")}
                className={"hf-chip" + (assessments === "none" ? " hf-chip-selected" : "")}
              >
                No assessments
              </button>
            </div>
          </div>
        </div>
      </div>

      <StepFooter
        onBack={onPrev}
        onNext={handleGenerate}
        nextLabel={generating ? "Starting..." : "Generate & Review"}
        nextDisabled={generating}
        nextLoading={generating}
      />
    </div>
  );
}
