"use client";

/**
 * ModePolicyRenderer — Group A.2 of Epic #1606 (Designer Renderers v2).
 *
 * Second config-only renderer after #1607 firstCallMode. Surfaces three
 * mastery / teaching-mode knobs the educator might touch:
 *
 *   - `teachingMode` (recall / comprehension / practice / syllabus / …)
 *   - `useFreshMastery` (boolean — routes mastery writes to scratch vs
 *     stored CallerAttribute)
 *   - `maxMasteryTier` (FOUNDATION / DEVELOPING / PRACTITIONER /
 *     DISTINCTION — caps the highest tier a learner can reach)
 *
 * `demoPolicy` (lives on `CallerPlaybook.policyMode`, caller-scoped) and
 * `evidenceFirst` (SystemSetting allow-list) are intentionally omitted
 * per the TL grooming pass on #1606 — both need separate fetch surfaces.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

export interface ModePolicyRendererData {
  teachingMode: string | undefined;
  useFreshMastery: boolean | undefined;
  maxMasteryTier: string | undefined;
}

const TEACHING_MODE_LABEL: Record<string, string> = {
  recall: "Recall",
  comprehension: "Comprehension",
  practice: "Practice",
  syllabus: "Syllabus",
};

const TIER_LABEL: Record<string, string> = {
  FOUNDATION: "Foundation",
  DEVELOPING: "Developing",
  PRACTITIONER: "Practitioner",
  DISTINCTION: "Distinction",
};

export function ModePolicyRenderer({
  data,
}: PreviewRendererProps<ModePolicyRendererData>) {
  const teachingModeLabel =
    data.teachingMode === undefined
      ? null
      : TEACHING_MODE_LABEL[data.teachingMode] ?? data.teachingMode;
  const maxTierLabel =
    data.maxMasteryTier === undefined
      ? null
      : TIER_LABEL[data.maxMasteryTier] ?? data.maxMasteryTier;
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">Teaching mode</div>
      {teachingModeLabel === null ? (
        <span className="hf-badge hf-badge-muted">Unset (default)</span>
      ) : (
        <span className="hf-badge hf-badge-info">{teachingModeLabel}</span>
      )}
      <div className="hf-category-label">Fresh mastery</div>
      {data.useFreshMastery ? (
        <span className="hf-badge hf-badge-info">
          ON — writes to scratch space
        </span>
      ) : (
        <span className="hf-badge hf-badge-muted">
          OFF — writes to CallerAttribute (default)
        </span>
      )}
      <div className="hf-category-label">Max mastery tier</div>
      {maxTierLabel === null ? (
        <span className="hf-badge hf-badge-muted">Uncapped (default)</span>
      ) : (
        <span className="hf-badge hf-badge-info">Capped at {maxTierLabel}</span>
      )}
    </div>
  );
}

registerPreviewRenderer<"modePolicy", ModePolicyRendererData>(
  "modePolicy",
  ModePolicyRenderer,
);
