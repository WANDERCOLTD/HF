"use client";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Banding picker primitive. Phase 1 ships the placeholder; Phase 3
 *  wraps the existing `BandingPicker` component zero-change (per AC
 *  risk note). The shell + cascade chip live here so the Inspector
 *  styles every banding row identically to other settings. */
export function JourneyBanding({ contract, value }: JourneyFieldProps) {
  const preset = isBandingValue(value) ? value.tierPresetId ?? "custom" : "custom";

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div
        className="hf-jf-compound-placeholder"
        data-testid={`hf-jf-banding-${contract.id}`}
      >
        Tier preset: <code>{preset}</code>
        <div className="hf-jf-help">
          BandingPicker mount ships in Phase 3 (wrap-only, no behaviour change).
        </div>
      </div>
    </_FieldShell>
  );
}

function isBandingValue(
  v: unknown,
): v is { tierPresetId?: string; thresholds?: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
