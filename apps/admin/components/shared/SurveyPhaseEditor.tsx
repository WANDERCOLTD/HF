'use client';

/**
 * SurveyPhaseEditor — inline editor for survey questions within an
 * onboarding/offboarding phase card.
 *
 * Renders when a phase has `surveySteps` or `phase === "survey"`.
 * Replaces the standard goals textarea with a structured question list.
 */

import { useCallback } from 'react';
import { GripVertical, Trash2, Plus } from 'lucide-react';
import type { SurveyStepConfig } from '@/lib/types/json-fields';

// ── Types ──────────────────────────────────────────────

export interface SurveyPhaseEditorProps {
  steps: SurveyStepConfig[];
  onChange: (steps: SurveyStepConfig[]) => void;
  disabled?: boolean;
}

type SurveyType = SurveyStepConfig['type'];

const TYPE_LABELS: Record<SurveyType, string> = {
  stars: 'Stars',
  options: 'Options',
  nps: 'Score 0-10',
  text: 'Text',
  mcq: 'Multiple Choice',
  true_false: 'True / False',
};

// ── Helpers ────────────────────────────────────────────

function makeStep(): SurveyStepConfig {
  return {
    id: crypto.randomUUID().slice(0, 8),
    type: 'text',
    prompt: '',
  };
}

// ── Component ──────────────────────────────────────────

export function SurveyPhaseEditor({ steps, onChange, disabled = false }: SurveyPhaseEditorProps) {
  const updateStep = useCallback(
    (index: number, patch: Partial<SurveyStepConfig>) => {
      const next = [...steps];
      next[index] = { ...next[index], ...patch };
      onChange(next);
    },
    [steps, onChange],
  );

  const removeStep = useCallback(
    (index: number) => onChange(steps.filter((_, i) => i !== index)),
    [steps, onChange],
  );

  const addStep = useCallback(() => onChange([...steps, makeStep()]), [steps, onChange]);

  const addOption = useCallback(
    (stepIdx: number) => {
      const step = steps[stepIdx];
      const opts = [...(step.options || []), { value: '', label: '' }];
      updateStep(stepIdx, { options: opts });
    },
    [steps, updateStep],
  );

  const updateOption = useCallback(
    (stepIdx: number, optIdx: number, label: string) => {
      const step = steps[stepIdx];
      const opts = [...(step.options || [])];
      const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      opts[optIdx] = { value, label };
      updateStep(stepIdx, { options: opts });
    },
    [steps, updateStep],
  );

  const removeOption = useCallback(
    (stepIdx: number, optIdx: number) => {
      const step = steps[stepIdx];
      const opts = (step.options || []).filter((_, i) => i !== optIdx);
      updateStep(stepIdx, { options: opts.length > 0 ? opts : undefined });
    },
    [steps, updateStep],
  );

  return (
    <div className="ob-survey-editor">
      <label className="hf-label">Survey Questions</label>

      {steps.length === 0 && (
        <div className="ob-survey-empty">No questions yet</div>
      )}

      {steps.map((step, idx) => (
        <div key={step.id} className="ob-survey-row">
          {/* Drag handle (visual only — reorder via parent SortableList) */}
          <div className="ob-survey-grip">
            <GripVertical size={14} />
          </div>

          <div className="ob-survey-fields">
            {/* Question text */}
            <input
              type="text"
              className="hf-input ob-survey-prompt-input"
              placeholder="Question text..."
              value={step.prompt}
              disabled={disabled}
              onChange={(e) => updateStep(idx, { prompt: e.target.value })}
            />

            <div className="ob-survey-meta-row">
              {/* Type selector */}
              <select
                className="hf-select ob-survey-type-select"
                value={step.type}
                disabled={disabled}
                onChange={(e) => {
                  const newType = e.target.value as SurveyType;
                  const patch: Partial<SurveyStepConfig> = { type: newType };
                  // Clear options when switching away from "options"
                  if (newType !== 'options') patch.options = undefined;
                  // Seed empty options when switching to "options"
                  if (newType === 'options' && !step.options?.length) {
                    patch.options = [{ value: 'option_1', label: 'Option 1' }];
                  }
                  updateStep(idx, patch);
                }}
              >
                {(Object.entries(TYPE_LABELS) as [SurveyType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>

              {/* Optional toggle */}
              <label className="ob-survey-optional-label">
                <input
                  type="checkbox"
                  checked={step.optional ?? false}
                  disabled={disabled}
                  onChange={(e) => updateStep(idx, { optional: e.target.checked || undefined })}
                />
                <span className="hf-text-xs">Optional</span>
              </label>

              {/* Delete */}
              {!disabled && (
                <button
                  className="hf-btn-ghost ob-survey-delete-btn"
                  onClick={() => removeStep(idx)}
                  title="Remove question"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {/* Options list — only for "options" type */}
            {step.type === 'options' && (
              <div className="ob-survey-options-list">
                {(step.options || []).map((opt, oi) => (
                  <div key={oi} className="ob-survey-option-row">
                    <input
                      type="text"
                      className="hf-input hf-text-xs"
                      placeholder="Option label..."
                      value={opt.label}
                      disabled={disabled}
                      onChange={(e) => updateOption(idx, oi, e.target.value)}
                    />
                    {!disabled && (
                      <button
                        className="hf-btn-ghost hf-text-xs hf-text-muted"
                        onClick={() => removeOption(idx, oi)}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                {!disabled && (
                  <button
                    className="hf-btn-ghost hf-text-xs ob-survey-add-option-btn"
                    onClick={() => addOption(idx)}
                  >
                    + Add option
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {!disabled && (
        <button className="hf-btn-ghost ob-survey-add-btn" onClick={addStep}>
          <Plus size={13} />
          Add question
        </button>
      )}
    </div>
  );
}
