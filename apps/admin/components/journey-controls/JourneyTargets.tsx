"use client";

import { FirstSessionSettings } from "@/components/course-design/FirstSessionSettings";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** First-call BehaviorTarget primitive — Phase 3 of epic #1675 (#1693).
 *
 *  Wraps the existing `FirstSessionSettings` editor zero-change. Needs
 *  `courseId` + `playbookConfig` from the JourneySettingMutatorProvider.
 *  Falls back to placeholder when context isn't set. */
export function JourneyTargets({ contract, value }: JourneyFieldProps) {
  const ctx = useJourneySetting();
  const overrides = isTargetMap(value) ? Object.keys(value).length : 0;

  if (!ctx.courseId || ctx.readonly || !ctx.playbookConfig) {
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
            {!ctx.courseId
              ? "FirstSessionSettings mounts when course context is available."
              : "Read-only mode."}
          </div>
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
      <div data-testid={`hf-jf-targets-${contract.id}`}>
        <FirstSessionSettings
          courseId={ctx.courseId}
          playbookConfig={ctx.playbookConfig}
          onSaved={ctx.onCompoundSaved}
          hideSignposts
          hideModePicker
        />
      </div>
    </_FieldShell>
  );
}

function isTargetMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
