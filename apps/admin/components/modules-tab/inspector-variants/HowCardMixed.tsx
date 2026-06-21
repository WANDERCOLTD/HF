"use client";

/**
 * HowCardMixed — variant for `mode: "mixed"` (tutor baseline + occasional
 * assessment touches).
 *
 * Story #2205 (U4 of #2185). Reuses the tutor knob list and adds an
 * informational chip naming the assessment-activation hand-off
 * (today wired via the spec runner, not a G8 knob — surfaced as an
 * explainer so the operator understands what mixed-mode does without
 * digging into the spec catalogue).
 */

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import type { HowCardVariantProps } from "./types";

/** G8 contract ids the mixed variant surfaces — tutor baseline +
 *  generateLessonPlan (mixed modules occasionally fire end-of-session
 *  lesson-plan summaries). */
export const MIXED_VARIANT_CONTRACT_IDS: readonly string[] = [
  "moduleQuestionTarget",
  "moduleMinSpeakingSec",
  "moduleCueCardPool",
  "moduleTopicPool",
  "moduleClosingLine",
  "moduleFirstTimeOrientationLine",
  "moduleScaffoldPool",
  "moduleGenerateLessonPlan",
];

export function HowCardMixed({ renderRow }: HowCardVariantProps) {
  const rows = pickContracts(MIXED_VARIANT_CONTRACT_IDS);
  return (
    <div
      className="hf-how-card-variant hf-how-card-variant-mixed"
      data-testid="hf-how-card-mixed"
      data-variant="mixed"
    >
      <p className="hf-section-desc hf-how-card-variant-summary">
        Tutor baseline with occasional assessment activation. The spec
        runner fires scoring at structured checkpoints; tune the tutor
        knobs below.
      </p>
      <div
        className="hf-banner hf-banner-info hf-how-card-variant-note"
        data-testid="hf-how-card-mixed-assessment-note"
        role="note"
      >
        Assessment activation is driven by the per-segment MEASURE spec
        on this course. Edit it in the Scoring tab.
      </div>
      <div className="hf-journey-inspector-stack">
        {rows.map((contract) => renderRow(contract))}
      </div>
    </div>
  );
}

function pickContracts(ids: readonly string[]): JourneySettingContract[] {
  const byId = new Map(
    JOURNEY_SETTINGS.filter((c) => c.group === "G8").map((c) => [c.id, c]),
  );
  const out: JourneySettingContract[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (c) out.push(c);
  }
  return out;
}
