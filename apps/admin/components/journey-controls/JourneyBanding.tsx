"use client";

import { BandingPicker } from "@/components/shared/BandingPicker";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { PlaybookConfig } from "@/lib/types/json-fields";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Banding picker primitive — Phase 3 of epic #1675 (#1693).
 *
 *  Wraps the existing `BandingPicker` zero-change. Needs `courseId` +
 *  `playbookConfig` from the JourneySettingMutatorProvider context.
 *  Falls back to the placeholder when the context isn't set (legacy
 *  callers). */
export function JourneyBanding({ contract }: JourneyFieldProps) {
  const ctx = useJourneySetting();
  const config = ctx.playbookConfig as PlaybookConfig | null | undefined;

  if (!ctx.courseId || ctx.readonly || !config) {
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
          {!ctx.courseId
            ? "BandingPicker mounts when course context is available."
            : !config
              ? "Waiting for playbookConfig…"
              : "Read-only mode."}
        </div>
      </_FieldShell>
    );
  }

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div data-testid={`hf-jf-banding-${contract.id}`}>
        <BandingPicker
          courseId={ctx.courseId}
          current={config.skillTierMapping}
          onSaved={ctx.onCompoundSaved}
        />
      </div>
    </_FieldShell>
  );
}
