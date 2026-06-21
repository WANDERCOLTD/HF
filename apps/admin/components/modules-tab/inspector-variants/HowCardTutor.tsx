"use client";

/**
 * HowCardTutor — variant for `mode: "tutor"` and the default fallback.
 *
 * Story #2205 (U4 of #2185). Surfaces the conversational-tutor knobs
 * (cue card pool / question target / min speaking sec / closing line /
 * first-time orientation). The mixed variant extends this baseline with
 * an assessment-activation hint.
 */

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import type { HowCardVariantProps } from "./types";

/** G8 contract ids the tutor variant prioritises, in render order. */
export const TUTOR_VARIANT_CONTRACT_IDS: readonly string[] = [
  "moduleQuestionTarget",
  "moduleMinSpeakingSec",
  "moduleCueCardPool",
  "moduleTopicPool",
  "moduleClosingLine",
  "moduleFirstTimeOrientationLine",
  "moduleScaffoldPool",
];

export function HowCardTutor({ renderRow }: HowCardVariantProps) {
  const rows = pickContracts(TUTOR_VARIANT_CONTRACT_IDS);
  return (
    <div
      className="hf-how-card-variant hf-how-card-variant-tutor"
      data-testid="hf-how-card-tutor"
      data-variant="tutor"
    >
      <p className="hf-section-desc hf-how-card-variant-summary">
        Conversational tutor. Tune question pacing, learner speaking
        floor, and the optional cue / topic pools below.
      </p>
      <div className="hf-journey-inspector-stack">
        {rows.map((contract) => renderRow(contract))}
      </div>
    </div>
  );
}

/** Look up G8 contracts by id, in declaration order. Unknown ids are
 *  silently skipped — the registry is the source of truth so a
 *  retired contract just disappears from the variant. */
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
