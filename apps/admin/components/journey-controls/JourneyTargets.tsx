"use client";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Compound first-call BehaviorTarget repeater. Phase 1 ships a
 *  read-only placeholder showing the override count; the real
 *  per-parameter slider repeater ships in Phase 3 wrapping the existing
 *  `FirstSessionSettings` editor. */
export function JourneyTargets({ contract, value }: JourneyFieldProps) {
  const overrides = isTargetMap(value) ? Object.keys(value).length : 0;

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div
        className="hf-jf-compound-placeholder"
        data-testid={`hf-jf-targets-${contract.id}`}
      >
        {overrides === 0
          ? "No first-call target overrides set."
          : `${overrides} target override${overrides === 1 ? "" : "s"} active.`}
        <div className="hf-jf-help">
          Per-parameter editing ships in Phase 3.
        </div>
      </div>
    </_FieldShell>
  );
}

function isTargetMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
