"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Plain numeric input with debounced commit-on-blur. */
export function JourneyNumber({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const initial = typeof value === "number" ? value : 0;
  const f = useCascadeEditField<number>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

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
          value={Number.isFinite(f.draftValue) ? f.draftValue : ""}
          disabled={disabled || f.isSaving}
          aria-disabled={disabled || f.isSaving}
          data-testid={`hf-jf-number-${contract.id}`}
          onChange={(e) => {
            const next = e.target.valueAsNumber;
            f.setDraftValue(Number.isFinite(next) ? next : 0);
            f.commitDebounced();
          }}
          onBlur={() => {
            void f.commit();
          }}
        />
      </div>
    </_FieldShell>
  );
}
