"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

const LONG_TEXT_THRESHOLD = 80;

/** Text input. Auto-debounces on change; commits on blur. Renders as
 *  textarea when the current value or helpText hints at longer text. */
export function JourneyText({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const initial = typeof value === "string" ? value : "";
  const f = useCascadeEditField<string>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

  const isLong = (f.draftValue ?? "").length > LONG_TEXT_THRESHOLD;

  const sharedProps = {
    id: `hf-jf-${contract.id}`,
    className: "hf-input hf-jf-input",
    value: f.draftValue,
    disabled: disabled || f.isSaving,
    "aria-disabled": disabled || f.isSaving,
    "data-testid": `hf-jf-text-${contract.id}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      f.setDraftValue(e.target.value);
      f.commitDebounced();
    },
    onBlur: () => {
      void f.commit();
    },
  };

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-control hf-jf-control-with-save">
        {isLong ? (
          <textarea {...sharedProps} rows={3} />
        ) : (
          <input type="text" {...sharedProps} />
        )}
        {/* Slice 9 grey-out epic — explicit Save button next to text
            fields. Auto-save on blur still works, but operators were
            clicking "Refresh preview" expecting it to commit the text
            value — leaving the change unsaved and the preview rendering
            the cascaded fallback. The button makes the save path
            discoverable. */}
        <button
          type="button"
          className="hf-btn hf-btn-primary hf-jf-save-btn"
          disabled={!f.isDirty || f.isSaving}
          aria-label={`Save ${contract.educatorLabel}`}
          onMouseDown={(e) => {
            // mousedown so the input's onBlur (which also triggers
            // commit) doesn't race the click — both routes call
            // commit() and the duplicate is idempotent via the
            // objectEqual check inside useCascadeEditField.
            e.preventDefault();
            void f.commit();
          }}
          data-testid={`hf-jf-save-${contract.id}`}
        >
          {f.isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </_FieldShell>
  );
}
