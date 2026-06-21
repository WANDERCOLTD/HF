"use client";

/**
 * HowCardQuiz — variant for `mode: "quiz"`.
 *
 * Story #2205 (U4 of #2185). Quiz modules are MCQ-driven (epic #2009).
 * Surfaces the question target (8-12 typical) + closing line + topic
 * pool (MCQ pool source-ref). The MCQ pool source-ref, scoreReadoutMode
 * and forward-pointer-LO knobs called out in the brief are tracked by
 * epic #2009; today they're surfaced as informational notes so the
 * operator knows what's coming.
 */

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import type { HowCardVariantProps } from "./types";

/** Quiz-variant G8 contract ids, in render order. */
export const QUIZ_VARIANT_CONTRACT_IDS: readonly string[] = [
  "moduleQuestionTarget",
  "moduleTopicPool",
  "moduleClosingLine",
  "moduleFirstTimeOrientationLine",
];

export function HowCardQuiz({ renderRow }: HowCardVariantProps) {
  const rows = pickContracts(QUIZ_VARIANT_CONTRACT_IDS);
  return (
    <div
      className="hf-how-card-variant hf-how-card-variant-quiz"
      data-testid="hf-how-card-quiz"
      data-variant="quiz"
    >
      <p className="hf-section-desc hf-how-card-variant-summary">
        Quiz mode is MCQ-driven. The tutor poses pre-authored
        multiple-choice items from the topic pool and reads the score
        at the end.
      </p>
      <div
        className="hf-banner hf-banner-info hf-how-card-variant-note"
        data-testid="hf-how-card-quiz-mcq-note"
        role="note"
      >
        MCQ-pool source-ref, score-readout mode, and the forward-pointer
        LO are tracked by epic #2009 — today they fall back to the
        course-level defaults. Tune the question target (typically 8-12)
        and topic pool below.
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
