"use client";

/**
 * FirstCallModeRenderer — Group A.1 of Epic #1606 (Designer Renderers v2).
 *
 * First-out renderer: validates the `PREVIEW_RENDERERS` registry pattern
 * end-to-end. Reads `Playbook.config.firstCallMode` directly (NOT
 * `ComposedPrompt.inputs.composition` — `firstCallMode` is `kind: "config"`
 * and has no outputKey on the composed prompt; the call-site at
 * `DesignTab.tsx` resolves it from `playbookConfig`).
 *
 * Surface: a single `hf-badge` chip in the Inspector slot showing the human
 * label for the configured Call 1 mode. Read-only — editing remains in
 * `FirstSessionSettings`.
 *
 * Label phrasing mirrors `FirstSessionSettings.tsx`'s `<select>` so the
 * editor and Preview stay verbally consistent.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";
import { JourneyField } from "@/components/journey-controls";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";

import { useJourneySetting } from "./_journey-setting-context";

export interface FirstCallModeRendererData {
  firstCallMode:
    | "onboarding"
    | "teach_immediately"
    | "baseline_assessment"
    | undefined;
}

const LABEL_BY_MODE: Record<
  "onboarding" | "teach_immediately" | "baseline_assessment",
  string
> = {
  onboarding: "Onboarding (default)",
  teach_immediately: "Teach Immediately",
  baseline_assessment: "Baseline Assessment",
};

export function FirstCallModeRenderer({
  data,
}: PreviewRendererProps<FirstCallModeRendererData>) {
  const ctx = useJourneySetting();
  const mode = data.firstCallMode;

  // When mounted inside an editable surface (`courseId` present and not
  // explicitly readonly), render the JourneyField primitive. Otherwise
  // fall back to the legacy read-only badge.
  if (ctx.courseId && !ctx.readonly) {
    const contract = JOURNEY_SETTINGS_BY_ID.firstCallMode;
    if (contract) {
      return (
        <div className="hf-card-compact">
          <JourneyField
            contract={contract}
            value={mode ?? "onboarding"}
            options={[
              { value: "onboarding", label: "Onboarding (default)" },
              { value: "teach_immediately", label: "Teach Immediately" },
              { value: "baseline_assessment", label: "Baseline Assessment" },
            ]}
            onSave={(v) => ctx.saveSetting("firstCallMode", v)}
          />
        </div>
      );
    }
  }

  // Read-only fallback (legacy Preview tab + retired ConsoleShell mount)
  if (mode === undefined) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Call 1 mode</div>
        <span className="hf-badge hf-badge-muted">
          Onboarding (default — unset)
        </span>
      </div>
    );
  }
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">Call 1 mode</div>
      <span className="hf-badge hf-badge-info">{LABEL_BY_MODE[mode]}</span>
    </div>
  );
}

registerPreviewRenderer<"firstCallMode", FirstCallModeRendererData>(
  "firstCallMode",
  FirstCallModeRenderer,
);
