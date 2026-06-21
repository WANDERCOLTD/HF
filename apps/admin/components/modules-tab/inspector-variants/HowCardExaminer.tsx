"use client";

/**
 * HowCardExaminer — variant for `mode: "examiner"`.
 *
 * Story #2205 (U4 of #2185). Examiner modules run diagnostic-only —
 * the tutor doesn't teach, correct, or coach. Surfaces silence-timing
 * (scheduled cues), the closing line, the first-time orientation, and
 * the silent-mode + lesson-plan toggles. Cites the examiner-mode
 * scoring prompt provenance (`examiner-mode` spec slug) as an
 * informational chip — the actual scoring contract lives in the spec
 * catalogue, NOT in a G8 knob.
 */

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import type { HowCardVariantProps } from "./types";

/** Examiner-variant G8 contract ids, in render order. */
export const EXAMINER_VARIANT_CONTRACT_IDS: readonly string[] = [
  "moduleQuestionTarget",
  "moduleMinSpeakingSec",
  "moduleCueCardPool",
  "moduleScheduledCues",
  "moduleClosingLine",
  "moduleFirstTimeOrientationLine",
  "moduleSilentMode",
  "moduleGenerateLessonPlan",
  "modulePinFocusArea",
];

export function HowCardExaminer({ renderRow }: HowCardVariantProps) {
  const rows = pickContracts(EXAMINER_VARIANT_CONTRACT_IDS);
  return (
    <div
      className="hf-how-card-variant hf-how-card-variant-examiner"
      data-testid="hf-how-card-examiner"
      data-variant="examiner"
    >
      <p className="hf-section-desc hf-how-card-variant-summary">
        Examiner mode runs diagnostic-only — no teaching, no
        corrections, no coaching. Tune silence timing, closing
        framing, and the per-module orientation below.
      </p>
      <div
        className="hf-banner hf-banner-info hf-how-card-variant-note"
        data-testid="hf-how-card-examiner-scoring-note"
        role="note"
      >
        Scoring uses the <code>examiner-mode</code> prompt template —
        edit the per-segment MEASURE spec in the Scoring tab to change
        the scoring contract.
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
