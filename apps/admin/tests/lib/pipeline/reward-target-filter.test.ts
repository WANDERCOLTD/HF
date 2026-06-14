/**
 * reward-target-filter.test.ts (#1632)
 *
 * Pins the post-#1632 REWARD diff semantics:
 *   - measurements with a matching SYSTEM BehaviorTarget contribute to
 *     the parameter-diffs array
 *   - measurements without a matching target (STATE observations) are
 *     skipped silently
 *   - throw ONLY when zero matches occurred (the "nothing to reward"
 *     condition the original #1256 guard was trying to catch)
 *
 * Direct end-to-end testing of `computeReward` would require mocking
 * Prisma findUnique + findMany + upsert + the surrounding pipeline
 * context. The fix is small and surgical (filter logic only) so this
 * test exercises the core filter shape via a faithful copy of the
 * filter loop. The live smoke on hf-dev is the integration verification.
 */
import { describe, it, expect } from "vitest";

/** Shape mirrors the inline loop in `route.ts::computeReward`. */
function computeDiffs(
  measurements: Array<{ parameterId: string; actualValue: number }>,
  targets: Array<{ parameterId: string; targetValue: number }>,
): {
  diffs: Array<{ parameterId: string; target: number; actual: number; diff: number }>;
  unmatched: string[];
} {
  const diffs: Array<{ parameterId: string; target: number; actual: number; diff: number }> = [];
  const unmatched: string[] = [];
  for (const measurement of measurements) {
    const target = targets.find((t) => t.parameterId === measurement.parameterId);
    if (!target) {
      unmatched.push(measurement.parameterId);
      continue;
    }
    const diff = Math.abs(measurement.actualValue - target.targetValue);
    diffs.push({
      parameterId: measurement.parameterId,
      target: target.targetValue,
      actual: measurement.actualValue,
      diff,
    });
  }
  return { diffs, unmatched };
}

const FREDDY_FIXTURE = [
  // BEHAVIOR params with SYSTEM targets — must be in diffs
  { parameterId: "BEH-WARMTH", actualValue: 0.75 },
  { parameterId: "BEH-FORMALITY", actualValue: 0.42 },
  { parameterId: "BEH-RESPONSE-LEN", actualValue: 0.22 },
  // STATE params WITHOUT SYSTEM targets — pre-#1632 these threw;
  // post-#1632 they're silently skipped
  { parameterId: "COMP-ENGAGEMENT", actualValue: 0.6 },
  { parameterId: "COACH_CLARITY", actualValue: 0.5 },
  { parameterId: "CONV_PACE", actualValue: 0.7 },
  { parameterId: "application_score", actualValue: 0.55 },
  { parameterId: "TONE_ASSERT", actualValue: 0.4 },
];

const FREDDY_SYSTEM_TARGETS = [
  { parameterId: "BEH-WARMTH", targetValue: 0.7 },
  { parameterId: "BEH-FORMALITY", targetValue: 0.4 },
  { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.2 },
  { parameterId: "BEH-CONVERSATIONAL-TONE", targetValue: 0.5 },
  { parameterId: "BEH-PAUSE-TOLERANCE", targetValue: 0.75 },
  { parameterId: "BEH-TURN-LENGTH", targetValue: 0.5 },
];

describe("REWARD target-matching filter (#1632)", () => {
  it("only diffs measurements with a matching SYSTEM target", () => {
    const { diffs, unmatched } = computeDiffs(FREDDY_FIXTURE, FREDDY_SYSTEM_TARGETS);
    expect(diffs).toHaveLength(3);
    expect(diffs.map((d) => d.parameterId).sort()).toEqual([
      "BEH-FORMALITY",
      "BEH-RESPONSE-LEN",
      "BEH-WARMTH",
    ]);
  });

  it("STATE measurements without targets land in the unmatched set", () => {
    const { unmatched } = computeDiffs(FREDDY_FIXTURE, FREDDY_SYSTEM_TARGETS);
    expect(unmatched.sort()).toEqual([
      "COACH_CLARITY",
      "COMP-ENGAGEMENT",
      "CONV_PACE",
      "TONE_ASSERT",
      "application_score",
    ]);
  });

  it("diff values are |actual - target|, never silent fallback", () => {
    const { diffs } = computeDiffs(FREDDY_FIXTURE, FREDDY_SYSTEM_TARGETS);
    const warmth = diffs.find((d) => d.parameterId === "BEH-WARMTH")!;
    expect(warmth.actual).toBe(0.75);
    expect(warmth.target).toBe(0.7);
    expect(warmth.diff).toBeCloseTo(0.05, 5);
  });

  it("returns empty diffs when only STATE measurements exist (zero matched)", () => {
    const stateOnly = FREDDY_FIXTURE.filter((m) => !m.parameterId.startsWith("BEH-"));
    const { diffs, unmatched } = computeDiffs(stateOnly, FREDDY_SYSTEM_TARGETS);
    expect(diffs).toHaveLength(0);
    expect(unmatched).toHaveLength(5);
    // This is the condition the post-#1632 guard throws on.
  });

  it("permits skill_* params when a matching SYSTEM target exists (forward-compat)", () => {
    // Today no skill_* params have SYSTEM targets (only PLAYBOOK-scope
    // targets are seeded). The filter is shape-agnostic: if a SYSTEM
    // target lands tomorrow, the diff just includes it.
    const skillMeasurement = [
      { parameterId: "skill_fluency_and_coherence_fc", actualValue: 0.65 },
      { parameterId: "BEH-WARMTH", actualValue: 0.75 },
    ];
    const skillTarget = [
      ...FREDDY_SYSTEM_TARGETS,
      { parameterId: "skill_fluency_and_coherence_fc", targetValue: 1.0 },
    ];
    const { diffs } = computeDiffs(skillMeasurement, skillTarget);
    expect(diffs).toHaveLength(2);
    expect(diffs.find((d) => d.parameterId === "skill_fluency_and_coherence_fc")?.diff).toBeCloseTo(0.35, 5);
  });
});
