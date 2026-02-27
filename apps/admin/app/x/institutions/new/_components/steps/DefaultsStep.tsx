"use client";

import { useState } from "react";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";

const DURATIONS = [15, 20, 30, 45, 60] as const;
const EMPHASIS_OPTIONS = [
  { value: "breadth", label: "Breadth-first" },
  { value: "balanced", label: "Balanced" },
  { value: "depth", label: "Depth-first" },
] as const;
const ASSESSMENT_OPTIONS = [
  { value: "formal", label: "Yes (formal)" },
  { value: "light", label: "Light checks" },
  { value: "none", label: "No assessments" },
] as const;

export function DefaultsStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  // Restore from data bag or use null (= system defaults)
  const saved = getData<Record<string, unknown>>("lessonPlanDefaults");

  const [sessionCount, setSessionCount] = useState<number | null>(
    (saved?.sessionCount as number) ?? null,
  );
  const [durationMins, setDurationMins] = useState<number | null>(
    (saved?.durationMins as number) ?? null,
  );
  const [emphasis, setEmphasis] = useState<string | null>(
    (saved?.emphasis as string) ?? null,
  );
  const [assessments, setAssessments] = useState<string | null>(
    (saved?.assessments as string) ?? null,
  );
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel | null>(
    (saved?.lessonPlanModel as LessonPlanModel) ?? null,
  );

  function persist(patch: Record<string, unknown>) {
    const current = {
      ...(sessionCount != null && { sessionCount }),
      ...(durationMins != null && { durationMins }),
      ...(emphasis != null && { emphasis }),
      ...(assessments != null && { assessments }),
      ...(lessonPlanModel != null && { lessonPlanModel }),
      ...patch,
    };
    // Only store if at least one override
    const hasValues = Object.values(current).some((v) => v != null);
    setData("lessonPlanDefaults", hasValues ? current : null);
  }

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Course Defaults</h1>
          <p className="hf-page-subtitle">
            Starting values when educators create courses in this institution.
            Skip to use system defaults.
          </p>
        </div>

        <div className="hf-card" style={{ maxWidth: 600 }}>
          <div className="hf-flex-col hf-gap-lg">
            {/* Session count */}
            <div>
              <FieldHint label="Default session count" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
              <SessionCountPicker
                value={sessionCount}
                onChange={(v) => { setSessionCount(v); persist({ sessionCount: v }); }}
              />
            </div>

            {/* Duration */}
            <div>
              <FieldHint label="Default session duration" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
              <div className="hf-chip-row">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDurationMins(d); persist({ durationMins: d }); }}
                    className={`hf-chip${durationMins === d ? " hf-chip-selected" : ""}`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            {/* Emphasis */}
            <div>
              <FieldHint label="Default emphasis" hint={WIZARD_HINTS["course.emphasis"]} labelClass="hf-label" />
              <div className="hf-chip-row">
                {EMPHASIS_OPTIONS.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => { setEmphasis(e.value); persist({ emphasis: e.value }); }}
                    className={`hf-chip${emphasis === e.value ? " hf-chip-selected" : ""}`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assessments */}
            <div>
              <FieldHint label="Default assessments" hint={WIZARD_HINTS["course.assessments"]} labelClass="hf-label" />
              <div className="hf-chip-row">
                {ASSESSMENT_OPTIONS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => { setAssessments(a.value); persist({ assessments: a.value }); }}
                    className={`hf-chip${assessments === a.value ? " hf-chip-selected" : ""}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Teaching model */}
            <div>
              <FieldHint label="Default teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
              <LessonPlanModelPicker
                value={lessonPlanModel ?? "direct_instruction"}
                onChange={(v) => { setLessonPlanModel(v); persist({ lessonPlanModel: v }); }}
              />
            </div>
          </div>
        </div>
      </div>

      <StepFooter
        onBack={onPrev}
        onSkip={onNext}
        skipLabel="Skip"
        onNext={onNext}
        nextLabel="Continue"
      />
    </div>
  );
}
