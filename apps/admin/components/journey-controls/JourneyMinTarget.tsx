"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/**
 * JourneyMinTarget — two-input min/target editor for module-scoped
 * pairs like `moduleQuestionTarget` ({min, target}).
 *
 * Replaces the JsonFallback for G8 entries where the storage shape is
 * a `{ min: number, target: number }` object. Enforces `min <= target`
 * before commit; if the operator types min > target the editor surfaces
 * an inline error and the Apply button is disabled.
 *
 * Storage shape: `{ min: number, target: number }`.
 */
interface MinTargetValue {
  min: number;
  target: number;
}

function isMinTarget(v: unknown): v is MinTargetValue {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.min === "number" && typeof o.target === "number";
}

const DEFAULT_PAIR: MinTargetValue = { min: 0, target: 0 };

export function JourneyMinTarget({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const initial: MinTargetValue = isMinTarget(value) ? value : DEFAULT_PAIR;
  const f = useCascadeEditField<MinTargetValue>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

  const invalid = f.draftValue.min > f.draftValue.target;

  function update(field: keyof MinTargetValue, raw: number) {
    const next: MinTargetValue = { ...f.draftValue, [field]: Number.isFinite(raw) ? raw : 0 };
    f.setDraftValue(next);
    f.commitDebounced();
  }

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-control hf-jf-min-target-row">
        <label className="hf-jf-min-target-cell">
          <span className="hf-jf-min-target-label">Min</span>
          <input
            type="number"
            className="hf-input hf-jf-input hf-jf-min-target-input"
            value={Number.isFinite(f.draftValue.min) ? f.draftValue.min : ""}
            disabled={disabled || f.isSaving}
            data-testid={`hf-jf-min-${contract.id}`}
            min={0}
            onChange={(e) => update("min", e.target.valueAsNumber)}
            onBlur={() => {
              if (!invalid) void f.commit();
            }}
          />
        </label>
        <label className="hf-jf-min-target-cell">
          <span className="hf-jf-min-target-label">Target</span>
          <input
            type="number"
            className="hf-input hf-jf-input hf-jf-min-target-input"
            value={Number.isFinite(f.draftValue.target) ? f.draftValue.target : ""}
            disabled={disabled || f.isSaving}
            data-testid={`hf-jf-target-${contract.id}`}
            min={0}
            onChange={(e) => update("target", e.target.valueAsNumber)}
            onBlur={() => {
              if (!invalid) void f.commit();
            }}
          />
        </label>
      </div>
      {invalid ? (
        <div className="hf-jf-help" role="alert" data-testid={`hf-jf-min-target-error-${contract.id}`}>
          Min must be ≤ target.
        </div>
      ) : null}
    </_FieldShell>
  );
}
