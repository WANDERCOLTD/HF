"use client";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Compound phase-builder primitive. Phase 1 ships a placeholder shell
 *  with a click-through to the existing `OnboardingEditor`-style sidetray
 *  (when wired in Phase 2). For Phase 1 the placeholder is read-only and
 *  documents that editing currently lives in the legacy lens.
 *
 *  Generalisation to a real `<PhaseSequenceBuilder>` is the Phase 2/3
 *  task — `OnboardingEditor` is tightly scoped today. */
export function JourneyPhases({ contract, value }: JourneyFieldProps) {
  const phases = Array.isArray(value) ? (value as Array<{ name?: string }>) : [];

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div
        className="hf-jf-compound-placeholder"
        data-testid={`hf-jf-phases-${contract.id}`}
      >
        {phases.length === 0
          ? "No phases configured."
          : `${phases.length} phase${phases.length === 1 ? "" : "s"}: ${phases
              .map((p) => p.name ?? "(unnamed)")
              .join(" → ")}`}
        <div className="hf-jf-help">
          Inline phase-editing ships in Phase 3. For now, edit via the legacy
          lens (existing Design tab).
        </div>
      </div>
    </_FieldShell>
  );
}
