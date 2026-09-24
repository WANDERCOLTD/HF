"use client";

/**
 * HowCardMockExam — variant for `mode: "mock-exam"`.
 *
 * Story #2205 (U4 of #2185). Mock-exam modules are session-terminal
 * board-chair-framed sessions that score all criteria and emit a
 * personalised lesson plan. Surfaces the question target (probe count),
 * silent-mode, the four-criteria lesson-plan toggle, closing framing,
 * and cue-card pool. Depth config (Foundation / Developing /
 * Practitioner) is course-wide today (`baselineAssessmentDepth` on the
 * Playbook) — surfaced as an informational note so the operator can
 * jump to the course-level knob.
 */

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import type { HowCardVariantProps } from "./types";

/** Mock-exam-variant G8 contract ids, in render order.
 *
 *  S8 + S3 (this PR) — `moduleScoreReadoutMode` is editable inline (Mock
 *  defaults to `aloud-with-indicative-qualifier` per course-ref v2.3);
 *  `moduleLearnerShellOverride` surfaces the learner-shell DISABLE-only
 *  patch. */
export const MOCK_EXAM_VARIANT_CONTRACT_IDS: readonly string[] = [
  "moduleQuestionTarget",
  "moduleMinSpeakingSec",
  "moduleCueCardPool",
  "moduleScheduledCues",
  "moduleClosingLine",
  "moduleFirstTimeOrientationLine",
  "moduleSilentMode",
  "moduleGenerateLessonPlan",
  "moduleScoreReadoutMode",
  "moduleLearnerShellOverride",
];

export function HowCardMockExam({ renderRow }: HowCardVariantProps) {
  const rows = pickContracts(MOCK_EXAM_VARIANT_CONTRACT_IDS);
  return (
    <div
      className="hf-how-card-variant hf-how-card-variant-mock-exam"
      data-testid="hf-how-card-mock-exam"
      data-variant="mock-exam"
    >
      <p className="hf-section-desc hf-how-card-variant-summary">
        Mock exam runs a full session-terminal scored attempt. The
        tutor frames the session like a board chair, scores every
        criterion, and reads the bands at the end.
      </p>
      <div
        className="hf-banner hf-banner-info hf-how-card-variant-note"
        data-testid="hf-how-card-mock-exam-depth-note"
        role="note"
      >
        Probe-depth (Foundation / Developing / Practitioner) is set
        course-wide via the baseline-assessment-depth knob — edit it
        in the Teaching tab. Per-module probe count lives below.
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
