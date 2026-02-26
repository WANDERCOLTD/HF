"use client";

import { LESSON_PLAN_MODEL_LIST } from "@/lib/lesson-plan/models";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";

interface LessonPlanModelPickerProps {
  value: LessonPlanModel;
  onChange: (model: LessonPlanModel) => void;
}

/**
 * Chip-based picker for pedagogical lesson plan models.
 * Shows 5 models as chips with a description hint below.
 */
export function LessonPlanModelPicker({ value, onChange }: LessonPlanModelPickerProps) {
  const selected = LESSON_PLAN_MODEL_LIST.find((m) => m.id === value) ?? LESSON_PLAN_MODEL_LIST[0];

  return (
    <div>
      <div className="hf-chip-row">
        {LESSON_PLAN_MODEL_LIST.map((model) => (
          <button
            key={model.id}
            onClick={() => onChange(model.id)}
            className={"hf-chip" + (value === model.id ? " hf-chip-selected" : "")}
          >
            {model.label}
          </button>
        ))}
      </div>
      <div className="hf-hint">
        {selected.description}
        <br />
        <span className="hf-text-xs hf-text-muted">{selected.suitableFor}</span>
      </div>
    </div>
  );
}
