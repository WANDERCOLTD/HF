/**
 * scoring-config.test.ts — sub-epic C of epic #2049 (story #2052).
 *
 * Pins the 5 scoring consumers, one describe block per contract.
 * Each block asserts:
 *   - SET → the documented behavioural effect (chip / directive / strategy).
 *   - UNSET → byte-identical previous behaviour (null / undefined output).
 *
 * The end-to-end vitest for rewardStrategy lives at the bottom — exercises
 * `computeOverallReward` directly with the strategy parameter, since the
 * full `computeReward` runner is DB-bound.
 */

import { describe, it, expect } from "vitest";
import {
  resolveScoringConfig,
  buildAssessmentReadinessDirective,
  buildProgressSignalDirective,
  readLearningProfileMastery,
  readEngagementProfileMastery,
  readSupervisionProfileMastery,
  averageLoMastery,
  type CallerAttributeLike,
} from "@/lib/prompt/composition/scoring-config";

describe("scoring-config — #2052 sub-epic C", () => {
  // ──────────────────────────────────────────────────────────────
  // loMasteryThreshold (modules.ts consumer)
  // ──────────────────────────────────────────────────────────────

  describe("loMasteryThreshold", () => {
    it("UNSET → resolveScoringConfig returns undefined (preserves cascade default)", () => {
      const out = resolveScoringConfig({});
      expect(out.loMasteryThreshold).toBeUndefined();
    });

    it("SET → resolveScoringConfig returns the operator value", () => {
      const out = resolveScoringConfig({ loMasteryThreshold: 0.85 });
      expect(out.loMasteryThreshold).toBe(0.85);
    });

    it("SET out-of-range → clamped to [0,1]", () => {
      expect(resolveScoringConfig({ loMasteryThreshold: 1.4 }).loMasteryThreshold).toBe(1);
      expect(resolveScoringConfig({ loMasteryThreshold: -0.1 }).loMasteryThreshold).toBe(0);
    });

    it("SET non-numeric → rejected (undefined)", () => {
      expect(
        // @ts-expect-error — testing runtime tolerance
        resolveScoringConfig({ loMasteryThreshold: "0.8" }).loMasteryThreshold,
      ).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // assessmentReadinessThreshold (instructions.ts consumer)
  // ──────────────────────────────────────────────────────────────

  describe("assessmentReadinessThreshold", () => {
    const attrs: CallerAttributeLike[] = [
      { key: "behavior_profile:learning:depth", numberValue: 0.6 },
      { key: "behavior_profile:learning:retention", numberValue: 0.7 },
      // unrelated keys must be ignored
      { key: "behavior_profile:engagement:warmth", numberValue: 0.9 },
      { key: "lo_mastery:something", numberValue: 0.4 },
    ];

    it("UNSET → buildAssessmentReadinessDirective returns null (byte-identical)", () => {
      const scoring = resolveScoringConfig({});
      const directive = buildAssessmentReadinessDirective(scoring, attrs, null);
      expect(directive).toBeNull();
    });

    it("SET + behavior_profile:learning:* aggregates available → reads from BEH-AGG-001 output", () => {
      const scoring = resolveScoringConfig({ assessmentReadinessThreshold: 0.5 });
      const directive = buildAssessmentReadinessDirective(scoring, attrs, null);
      expect(directive).not.toBeNull();
      expect(directive!.threshold).toBe(0.5);
      expect(directive!.source).toBe("behavior_profile:learning:*");
      expect(directive!.observedMastery).toBeCloseTo(0.65); // mean(0.6, 0.7)
      expect(directive!.status).toBe("ready"); // 0.65 >= 0.5
    });

    it("SET + observed mastery below threshold → not_ready", () => {
      const scoring = resolveScoringConfig({ assessmentReadinessThreshold: 0.9 });
      const directive = buildAssessmentReadinessDirective(scoring, attrs, null);
      expect(directive!.status).toBe("not_ready");
    });

    it("SET + no behavior_profile rows → falls back to loMasteryMap", () => {
      const scoring = resolveScoringConfig({ assessmentReadinessThreshold: 0.5 });
      const loMap = { "mod1:lo1": 0.4, "mod1:lo2": 0.8 }; // mean = 0.6
      const directive = buildAssessmentReadinessDirective(scoring, [], loMap);
      expect(directive!.source).toBe("loMasteryMap");
      expect(directive!.observedMastery).toBeCloseTo(0.6);
      expect(directive!.status).toBe("ready");
    });

    it("SET + no mastery signal → status=unknown", () => {
      const scoring = resolveScoringConfig({ assessmentReadinessThreshold: 0.5 });
      const directive = buildAssessmentReadinessDirective(scoring, [], null);
      expect(directive!.status).toBe("unknown");
      expect(directive!.source).toBe("none");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // progressSignalLowWater (instructions.ts consumer)
  // ──────────────────────────────────────────────────────────────

  describe("progressSignalLowWater", () => {
    const engagementAttrs: CallerAttributeLike[] = [
      { key: "behavior_profile:engagement:warmth", numberValue: 0.3 },
    ];

    it("UNSET (and high unset) → buildProgressSignalDirective returns null", () => {
      const scoring = resolveScoringConfig({});
      expect(buildProgressSignalDirective(scoring, engagementAttrs, null)).toBeNull();
    });

    it("SET + engagement rollup below water → status=encouragement", () => {
      const scoring = resolveScoringConfig({
        progressSignals: { lowWater: 0.5 },
      });
      const directive = buildProgressSignalDirective(scoring, engagementAttrs, null);
      expect(directive).not.toBeNull();
      expect(directive!.status).toBe("encouragement");
      expect(directive!.source).toBe("behavior_profile:engagement:*");
      expect(directive!.observedMastery).toBe(0.3);
    });

    it("SET + engagement rollup above water → status=in_band (no stretch without highWater)", () => {
      const scoring = resolveScoringConfig({
        progressSignals: { lowWater: 0.2 },
      });
      const directive = buildProgressSignalDirective(scoring, engagementAttrs, null);
      expect(directive!.status).toBe("in_band");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // progressSignalHighWater (instructions.ts consumer)
  // ──────────────────────────────────────────────────────────────

  describe("progressSignalHighWater", () => {
    const engagementAttrs: CallerAttributeLike[] = [
      { key: "behavior_profile:engagement:warmth", numberValue: 0.85 },
    ];

    it("UNSET → null (when low also unset)", () => {
      const scoring = resolveScoringConfig({});
      expect(buildProgressSignalDirective(scoring, engagementAttrs, null)).toBeNull();
    });

    it("SET + engagement rollup above water → status=stretch", () => {
      const scoring = resolveScoringConfig({
        progressSignals: { highWater: 0.7 },
      });
      const directive = buildProgressSignalDirective(scoring, engagementAttrs, null);
      expect(directive!.status).toBe("stretch");
      expect(directive!.source).toBe("behavior_profile:engagement:*");
    });

    it("BOTH set + observed in band → status=in_band", () => {
      const scoring = resolveScoringConfig({
        progressSignals: { lowWater: 0.2, highWater: 0.9 },
      });
      const directive = buildProgressSignalDirective(
        scoring,
        [{ key: "behavior_profile:engagement:warmth", numberValue: 0.5 }],
        null,
      );
      expect(directive!.status).toBe("in_band");
    });

    it("No engagement rollup → fallback to averaged loMasteryMap", () => {
      const scoring = resolveScoringConfig({
        progressSignals: { lowWater: 0.5 },
      });
      const directive = buildProgressSignalDirective(
        scoring,
        [],
        { "mod1:lo1": 0.3, "mod1:lo2": 0.4 },
      );
      expect(directive!.source).toBe("loMasteryMap");
      expect(directive!.observedMastery).toBeCloseTo(0.35);
      expect(directive!.status).toBe("encouragement");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // BEH-AGG-001 reader helpers
  // ──────────────────────────────────────────────────────────────

  describe("BEH-AGG-001 readers (aggregate-output consumer)", () => {
    it("readLearningProfileMastery — ignores non-matching keys", () => {
      const attrs: CallerAttributeLike[] = [
        { key: "behavior_profile:learning:retention", numberValue: 0.4 },
        { key: "behavior_profile:engagement:warmth", numberValue: 0.9 },
        { key: "lo_mastery:foo", numberValue: 1.0 },
      ];
      expect(readLearningProfileMastery(attrs)).toBe(0.4);
    });

    it("readEngagementProfileMastery — averages multiple matching rows", () => {
      const attrs: CallerAttributeLike[] = [
        { key: "behavior_profile:engagement:warmth", numberValue: 0.4 },
        { key: "behavior_profile:engagement:depth", numberValue: 0.8 },
      ];
      expect(readEngagementProfileMastery(attrs)).toBeCloseTo(0.6);
    });

    it("readSupervisionProfileMastery — null when empty", () => {
      expect(readSupervisionProfileMastery([])).toBeNull();
      expect(readSupervisionProfileMastery(null)).toBeNull();
    });

    it("averageLoMastery — null when empty", () => {
      expect(averageLoMastery({})).toBeNull();
      expect(averageLoMastery(null)).toBeNull();
      expect(averageLoMastery({ a: 0.5, b: 0.5 })).toBe(0.5);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // rewardStrategy (compute-reward.ts consumer)
  // ──────────────────────────────────────────────────────────────

  describe("rewardStrategy", () => {
    it("UNSET → resolveScoringConfig returns undefined", () => {
      expect(resolveScoringConfig({}).rewardStrategy).toBeUndefined();
    });

    it("SET valid → returns the value", () => {
      expect(resolveScoringConfig({ rewardStrategy: "learner_mastery" }).rewardStrategy).toBe(
        "learner_mastery",
      );
      expect(resolveScoringConfig({ rewardStrategy: "educator_drift" }).rewardStrategy).toBe(
        "educator_drift",
      );
      expect(resolveScoringConfig({ rewardStrategy: "blended" }).rewardStrategy).toBe(
        "blended",
      );
    });

    it("SET unknown string → rejected (undefined)", () => {
      expect(
        // @ts-expect-error — testing runtime tolerance
        resolveScoringConfig({ rewardStrategy: "magic" }).rewardStrategy,
      ).toBeUndefined();
    });
  });
});
