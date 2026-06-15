"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Multi-select chip group. Commits on each toggle. Value is a
 *  string[]; defaults to []. */
export function JourneyMultiSelect({
  contract,
  value,
  onSave,
  options,
  disabled,
}: JourneyFieldProps) {
  const initial = Array.isArray(value) ? (value as string[]) : [];
  const f = useCascadeEditField<string[]>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

  const onToggle = async (v: string) => {
    if (disabled || f.isSaving) return;
    const has = f.draftValue.includes(v);
    const next = has ? f.draftValue.filter((x) => x !== v) : [...f.draftValue, v];
    f.setDraftValue(next);
    await Promise.resolve();
    await f.commit();
  };

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div
        className="hf-jf-control"
        role="group"
        aria-label={contract.educatorLabel}
        data-testid={`hf-jf-multiselect-${contract.id}`}
      >
        {(options ?? []).map((o) => {
          const on = f.draftValue.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={`hf-chip ${on ? "hf-chip-selected" : ""}`}
              aria-pressed={on}
              disabled={disabled || f.isSaving}
              onClick={() => void onToggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </_FieldShell>
  );
}
