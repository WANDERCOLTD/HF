"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Single-select dropdown. Commits on change. Renders segmented when
 *  ≤4 options, dropdown otherwise. */
export function JourneySelect({
  contract,
  value,
  onSave,
  options,
  disabled,
}: JourneyFieldProps) {
  const initial = typeof value === "string" ? value : "";
  const f = useCascadeEditField<string>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

  const opts = options ?? [];
  const useSegmented = opts.length > 0 && opts.length <= 4;

  const onPick = async (next: string) => {
    if (disabled || f.isSaving) return;
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
      <div className="hf-jf-control">
        {useSegmented ? (
          <div
            className="hf-jf-segment"
            data-testid={`hf-jf-select-${contract.id}`}
          >
            {opts.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={f.draftValue === o.value}
                disabled={disabled || f.isSaving}
                onClick={() => void onPick(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <select
            id={`hf-jf-${contract.id}`}
            className="hf-input hf-jf-input"
            value={f.draftValue}
            disabled={disabled || f.isSaving}
            data-testid={`hf-jf-select-${contract.id}`}
            onChange={(e) => void onPick(e.target.value)}
          >
            {opts.length === 0 ? (
              <option value="" disabled>
                no options
              </option>
            ) : (
              opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            )}
          </select>
        )}
      </div>
    </_FieldShell>
  );
}
