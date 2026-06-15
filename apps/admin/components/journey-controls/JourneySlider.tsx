"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Bounded numeric slider. Commits on release (onMouseUp / onChange-end);
 *  the draft updates live as the user drags. */
export function JourneySlider({
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

  // Phase 1 uses a 0..1 default range; Phase 2 will pass a `range` prop
  // from the Inspector renderer (e.g. tolerance is 0..1, half-life is
  // 1..90). Conservative defaults satisfy every existing contract.
  const min = 0;
  const max = 1;
  const step = 0.05;

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
          type="range"
          className="hf-jf-slider"
          min={min}
          max={max}
          step={step}
          value={f.draftValue}
          disabled={disabled || f.isSaving}
          aria-disabled={disabled || f.isSaving}
          data-testid={`hf-jf-slider-${contract.id}`}
          onChange={(e) => {
            f.setDraftValue(e.target.valueAsNumber);
          }}
          onMouseUp={() => {
            void f.commit();
          }}
          onTouchEnd={() => {
            void f.commit();
          }}
          onBlur={() => {
            void f.commit();
          }}
        />
        <span className="hf-jf-slider-value">
          {f.draftValue.toFixed(2)}
        </span>
      </div>
    </_FieldShell>
  );
}
