"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Duration input — pair (numeric value, unit). Underlying storage is
 *  always a single number in the contract's canonical unit (Phase 2
 *  passes a `unit: "ms" | "s" | "min"` option; Phase 1 assumes seconds
 *  by default and converts for display). */
type DurationUnit = "ms" | "s" | "min";

const DEFAULT_UNIT: DurationUnit = "s";

const UNIT_TO_SECONDS: Record<DurationUnit, number> = {
  ms: 1 / 1000,
  s: 1,
  min: 60,
};

export function JourneyDuration({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const initialSeconds = typeof value === "number" ? value : 0;
  const f = useCascadeEditField<number>({
    contract,
    value: initialSeconds,
    onSave: async (next) => onSave(next),
  });

  // Phase 1: always render in seconds; Phase 2 will pass `displayUnit`.
  const unit = DEFAULT_UNIT;

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-control">
        <input
          id={`hf-jf-${contract.id}`}
          type="number"
          className="hf-input hf-jf-input"
          value={Number.isFinite(f.draftValue) ? f.draftValue / UNIT_TO_SECONDS[unit] : ""}
          disabled={disabled || f.isSaving}
          aria-disabled={disabled || f.isSaving}
          data-testid={`hf-jf-duration-${contract.id}`}
          onChange={(e) => {
            const next = e.target.valueAsNumber;
            const seconds = Number.isFinite(next) ? next * UNIT_TO_SECONDS[unit] : 0;
            f.setDraftValue(seconds);
            f.commitDebounced();
          }}
          onBlur={() => {
            void f.commit();
          }}
        />
        <span className="hf-jf-help">{unit}</span>
      </div>
    </_FieldShell>
  );
}
