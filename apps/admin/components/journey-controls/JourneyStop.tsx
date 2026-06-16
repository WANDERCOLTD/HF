"use client";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** JourneyStop primitive — a JourneyStop is the discriminated-union
 *  shape (`{kind, enabled, trigger}`) used for pre-test / mid-test /
 *  post-test / NPS. Phase 1 ships the placeholder; Phase 3 wraps the
 *  existing `SurveyStopDetail` / sidetray editor with a typed-form
 *  surface. */
export function JourneyStop({ contract, value }: JourneyFieldProps) {
  const stop = isStop(value) ? value : null;
  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div
        className="hf-jf-compound-placeholder"
        data-testid={`hf-jf-stop-${contract.id}`}
      >
        {stop === null ? (
          <div className="hf-jf-compound-empty">
            <strong>Not configured.</strong>{" "}
            <span>Use the ⋯ menu → Edit as JSON to set the stop shape.</span>
          </div>
        ) : (
          <div className="hf-jf-compound-summary">
            <strong>{stop.enabled ? "Enabled" : "Disabled"}</strong>
            {stop.kind ? <span> · kind: {stop.kind}</span> : null}
            {stop.trigger ? (
              <span> · trigger: {JSON.stringify(stop.trigger)}</span>
            ) : null}
          </div>
        )}
      </div>
    </_FieldShell>
  );
}

interface StopShape {
  kind?: string;
  enabled?: boolean;
  trigger?: unknown;
}

function isStop(v: unknown): v is StopShape {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
