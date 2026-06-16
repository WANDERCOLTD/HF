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
        {stop === null
          ? "Stop not configured."
          : `${stop.enabled ? "Enabled" : "Disabled"}${
              stop.kind ? ` · kind: ${stop.kind}` : ""
            }${stop.trigger ? ` · trigger: ${JSON.stringify(stop.trigger)}` : ""}`}
        <div className="hf-jf-help">
          Stop editor mounts in Phase 3.
        </div>
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
