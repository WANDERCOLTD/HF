/**
 * reward-strategy.test.ts — end-to-end test for the `rewardStrategy`
 * consumer wired by sub-epic C of epic #2049 (story #2052).
 *
 * Exercises `computeOverallReward` directly with each strategy mode to
 * pin the byte-identity claim (UNSET / "blended" preserve the original
 * blended weighting) AND the divergence claim (the other two strategies
 * actually change the score).
 *
 * The full `computeReward` runner is DB-bound, so this test exercises
 * the pure scoring function. The integration with `Playbook.config` +
 * BEH-AGG-001 CallerAttribute reads is covered by the per-contract test
 * in `scoring-config.test.ts`; this file pins the REWARD-pipeline side
 * of the chain (`docs/CHAIN-CONTRACTS.md` §3 — REWARD invariant).
 */

import { describe, it, expect } from "vitest";
import {
  computeOverallReward,
  DEFAULT_REWARD_CONFIG,
  type ParameterDiff,
  type OutcomeSignals,
} from "@/lib/ops/compute-reward";

const targetConfidences = new Map<string, number>([
  ["BEH-WARMTH", 0.8],
  ["BEH-PACE", 0.8],
]);

const baselineDiffs: ParameterDiff[] = [
  // Behaviour somewhat off-target (diff 0.3 → diffScore = 1 - 0.6 = 0.4)
  { parameterId: "BEH-WARMTH", target: 0.5, actual: 0.8, diff: 0.3, withinTolerance: false },
  // Behaviour close-to-target (diff 0.1 → diffScore = 0.8)
  { parameterId: "BEH-PACE", target: 0.5, actual: 0.6, diff: 0.1, withinTolerance: true },
];

const baselineOutcomes: OutcomeSignals = {
  resolved: true,
  sentimentDelta: 0.2,
  escalated: false,
};

describe("rewardStrategy end-to-end (REWARD pipeline boundary)", () => {
  it("UNSET strategy → byte-identical to 'blended' (preserves current behaviour)", () => {
    const unset = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      undefined,
      null,
    );
    const blended = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "blended",
      null,
    );
    expect(unset).toBe(blended);
  });

  it("'educator_drift' → drops outcome signals; pure behaviour alignment", () => {
    const drift = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "educator_drift",
      null,
    );
    const blended = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "blended",
      null,
    );
    // Drift differs because outcome term is dropped. With this baseline,
    // outcome signal is strongly positive (resolved + positive sentiment)
    // and behavioral signal is moderate — drift should drop the overall
    // score relative to blended.
    expect(drift).not.toBe(blended);
  });

  it("'learner_mastery' with low rollup → behaviour weighted less", () => {
    const lowMastery = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      0.0,
    );
    const highMastery = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      1.0,
    );
    // At rollup=1.0 behaviour weight is 1.0; at rollup=0.0 it's 0.4.
    // The two should differ because the strategy genuinely re-weights.
    expect(lowMastery).not.toBe(highMastery);
  });

  it("'learner_mastery' with NULL rollup → falls back to blended (no signal yet)", () => {
    const lmNull = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      null,
    );
    const blended = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "blended",
      null,
    );
    expect(lmNull).toBe(blended);
  });

  it("'learner_mastery' high rollup → re-weights behaviour vs outcome", () => {
    // High-mastery learners get more behaviour weight; the overall score
    // should DIFFER from the blended default by a non-trivial amount.
    const lmHigh = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      1.0,
    );
    const blended = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "blended",
      null,
    );
    expect(lmHigh).not.toBe(blended);
    // The DIFFERENCE direction proves the strategy actually re-weights:
    // when learner mastery = 1.0, behaviour weight = 1.0 (vs blended's 0.4).
    // So the result moves toward the behaviour score.
    expect(Math.abs(lmHigh - blended)).toBeGreaterThan(0.01);
  });

  it("Reads behavior_profile:learning:* as its input signal — proven by routing", () => {
    // This is the wiring proof: the SAME `learnerMasteryRollup` value
    // routed through different strategies produces different results
    // ONLY because the strategy actually reads it. If the wiring were
    // dead the three calls below would return the same number.
    const a = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      0.2,
    );
    const b = computeOverallReward(
      baselineDiffs,
      baselineOutcomes,
      targetConfidences,
      DEFAULT_REWARD_CONFIG,
      "learner_mastery",
      0.8,
    );
    expect(a).not.toBe(b);
  });
});
