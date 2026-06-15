"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Boolean control. Commits immediately on click — no debounce.
 *  Visual style matches the existing `hf-toggle-btn-active` family. */
export function JourneyToggle({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const f = useCascadeEditField<boolean>({
    contract,
    value: !!value,
    onSave: async (next) => onSave(next),
  });

  const onClick = async () => {
    if (disabled || f.isSaving) return;
    f.setDraftValue(!f.draftValue);
    // Commit on next tick so draft state is updated first.
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
        <button
          id={`hf-jf-${contract.id}`}
          type="button"
          role="switch"
          aria-checked={f.draftValue}
          aria-disabled={disabled || f.isSaving}
          disabled={disabled || f.isSaving}
          onClick={onClick}
          className="hf-jf-toggle"
          data-testid={`hf-jf-toggle-${contract.id}`}
        />
        <span className="hf-jf-help">{f.draftValue ? "On" : "Off"}</span>
      </div>
    </_FieldShell>
  );
}
