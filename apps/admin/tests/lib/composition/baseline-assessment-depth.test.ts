/**
 * #2051 (epic #2049 sub-epic B / Contract 1) — `computeInstructions`
 * surfaces a `baseline_assessment_depth` directive ONLY when:
 *
 *   1. `Playbook.config.firstCallMode === "baseline_assessment"`, AND
 *   2. `sharedState.isFirstCall || sharedState.isFirstCallInDomain` (the
 *      learner's first call in this course / first-call-in-domain re-onboard)
 *
 * Default when the depth field is absent in baseline mode = `"standard"`
 * (preserves the implicit 5-question shape for playbooks that pre-date
 * the field).
 *
 * The renderer in `renderPromptSummary.ts` appends `directive` AFTER the
 * existing `BASELINE_ASSESSMENT_RULE` critical rule (emitted by
 * `transforms/preamble.ts`). This vitest pins the TRANSFORM-side output;
 * the renderer push is structurally guarded by
 * `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 * (the `directive: "…"` field convention).
 *
 * Pins:
 *   - field absent + baseline mode + first call → directive defaults to standard
 *   - light / standard / deep → matching directive
 *   - firstCallMode !== "baseline_assessment" → null
 *   - Call 2+ (not first call) → null
 *   - unknown stored value → null fallback (defensive, no crash)
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/instructions";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function makeSharedState(overrides: Partial<SharedComputedState> = {}): SharedComputedState {
  return {
    channel: "text",
    modules: [],
    isFirstCall: true,
    daysSinceLastCall: 0,
    completedModules: new Set<string>(),
    estimatedProgress: 0,
    lastCompletedIndex: -1,
    moduleToReview: null,
    nextModule: null,
    reviewType: "quick_recall",
    reviewReason: "",
    thresholds: { high: 0.65, low: 0.35 },
    isFinalSession: false,
    callNumber: 1,
    ...overrides,
  };
}

function makeContext(opts: {
  firstCallMode?: PlaybookConfig["firstCallMode"];
  baselineAssessmentDepth?: PlaybookConfig["baselineAssessmentDepth"];
  isFirstCall?: boolean;
  isFirstCallInDomain?: boolean;
  /** Force a stale / unrecognised value into the JSON config to exercise
   *  the defensive fallback path. */
  rawDepth?: string;
} = {}): AssembledContext {
  const config: PlaybookConfig = {};
  if (opts.firstCallMode !== undefined) {
    config.firstCallMode = opts.firstCallMode;
  }
  if (opts.baselineAssessmentDepth !== undefined) {
    config.baselineAssessmentDepth = opts.baselineAssessmentDepth;
  }
  if (opts.rawDepth !== undefined) {
    (config as Record<string, unknown>).baselineAssessmentDepth = opts.rawDepth;
  }
  return {
    sharedState: makeSharedState({
      isFirstCall: opts.isFirstCall ?? true,
      isFirstCallInDomain: opts.isFirstCallInDomain,
    }),
    sections: {},
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [
        {
          id: "p1",
          name: "Baseline test playbook",
          status: "PUBLISHED",
          config,
          domain: null,
          items: [],
        },
      ] as unknown as AssembledContext["loadedData"]["playbooks"],
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "instructions",
  name: "Instructions",
  priority: 9,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computeInstructions",
  outputKey: "instructions",
};

const transform = getTransform("computeInstructions")!;

type Result = {
  baseline_assessment_depth: {
    depth: "light" | "standard" | "deep";
    directive: string;
  } | null;
};

describe("computeInstructions — baseline_assessment_depth (#2051)", () => {
  describe("gating by firstCallMode + isFirstCall", () => {
    it("emits standard directive when depth field is ABSENT (default preserves baseline shape)", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: undefined,
        isFirstCall: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).not.toBeNull();
      expect(result.baseline_assessment_depth!.depth).toBe("standard");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "5 diagnostic questions",
      );
      // Negative: no follow-up probe wording at the standard depth.
      expect(result.baseline_assessment_depth!.directive).not.toMatch(/follow-up/i);
    });

    it("returns null when firstCallMode is 'onboarding' regardless of depth", async () => {
      const ctx = makeContext({
        firstCallMode: "onboarding",
        baselineAssessmentDepth: "deep",
        isFirstCall: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).toBeNull();
    });

    it("returns null when firstCallMode is 'teach_immediately'", async () => {
      const ctx = makeContext({
        firstCallMode: "teach_immediately",
        baselineAssessmentDepth: "deep",
        isFirstCall: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).toBeNull();
    });

    it("returns null when firstCallMode is undefined (default onboarding behaviour)", async () => {
      const ctx = makeContext({
        firstCallMode: undefined,
        baselineAssessmentDepth: "deep",
        isFirstCall: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).toBeNull();
    });

    it("returns null on Call 2+ (not first call, not first-in-domain)", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "deep",
        isFirstCall: false,
        isFirstCallInDomain: false,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).toBeNull();
    });

    it("fires on isFirstCallInDomain (domain-switch re-onboarding) even when isFirstCall=false", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "standard",
        isFirstCall: false,
        isFirstCallInDomain: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth).not.toBeNull();
      expect(result.baseline_assessment_depth!.depth).toBe("standard");
    });
  });

  describe("depth-specific directive shapes", () => {
    it("light depth → '3 diagnostic questions' directive, no follow-up probe", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "light",
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth!.depth).toBe("light");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "3 diagnostic questions",
      );
      expect(result.baseline_assessment_depth!.directive).not.toMatch(/follow-up/i);
    });

    it("standard depth → '5 diagnostic questions' directive, no follow-up probe", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "standard",
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth!.depth).toBe("standard");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "5 diagnostic questions",
      );
      expect(result.baseline_assessment_depth!.directive).not.toMatch(/follow-up/i);
    });

    it("deep depth → '8 diagnostic questions' directive WITH follow-up probe wording", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "deep",
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      expect(result.baseline_assessment_depth!.depth).toBe("deep");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "8 diagnostic questions",
      );
      expect(result.baseline_assessment_depth!.directive).toMatch(/follow-up/i);
    });
  });

  describe("byte-identical preservation when absent vs. standard", () => {
    it("absent and explicit 'standard' produce identical directive output", async () => {
      const ctxAbsent = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: undefined,
      });
      const ctxStandard = makeContext({
        firstCallMode: "baseline_assessment",
        baselineAssessmentDepth: "standard",
      });
      const rAbsent = (await transform(null, ctxAbsent, STUB_SECTION)) as Result;
      const rStandard = (await transform(null, ctxStandard, STUB_SECTION)) as Result;
      expect(rAbsent.baseline_assessment_depth).toEqual(
        rStandard.baseline_assessment_depth,
      );
    });
  });

  describe("defensive fallback on stale DB value", () => {
    it("unknown stored value falls back to standard (no crash)", async () => {
      const ctx = makeContext({
        firstCallMode: "baseline_assessment",
        rawDepth: "extreme", // not in the union
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as Result;
      // Falls back to standard rather than crashing or returning null.
      // The shape of the fallback is intentionally lax — what matters is
      // (a) the transform does not throw, (b) the prompt still has a
      // baseline-shaped directive when the playbook is in baseline mode.
      expect(result.baseline_assessment_depth).not.toBeNull();
      expect(result.baseline_assessment_depth!.depth).toBe("standard");
    });
  });
});
