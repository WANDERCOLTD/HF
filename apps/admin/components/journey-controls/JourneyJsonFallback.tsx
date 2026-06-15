"use client";

import { useState } from "react";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Power-user JSON editor for opaque sub-objects. Phase 1 ships a
 *  trivial textarea-based fallback; Phase 5 will swap in the existing
 *  `JsonEditorModal` from `components/settings/`. */
export function JourneyJsonFallback({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const initial = serialise(value);
  const [text, setText] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);

  const f = useCascadeEditField<unknown>({
    contract,
    value,
    onSave: async (next) => onSave(next),
  });

  const onApply = async () => {
    if (disabled || f.isSaving) return;
    try {
      const parsed: unknown = text.trim() ? JSON.parse(text) : null;
      setParseError(null);
      f.setDraftValue(parsed);
      await f.commit();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={text !== initial}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-control">
        <span className="hf-jf-json-chip">JSON</span>
        <textarea
          id={`hf-jf-${contract.id}`}
          className="hf-input hf-jf-input"
          rows={4}
          value={text}
          disabled={disabled || f.isSaving}
          data-testid={`hf-jf-json-${contract.id}`}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {parseError ? (
        <div className="hf-jf-help" role="alert">
          Parse error: {parseError}
        </div>
      ) : null}
      <div className="hf-jf-control">
        <button
          type="button"
          className="hf-btn hf-btn-secondary"
          disabled={disabled || f.isSaving || text === initial}
          onClick={() => void onApply()}
        >
          Apply
        </button>
      </div>
    </_FieldShell>
  );
}

function serialise(v: unknown): string {
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}
