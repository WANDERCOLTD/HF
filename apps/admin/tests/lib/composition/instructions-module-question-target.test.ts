/**
 * #1732 (epic #1730 G8 consumer A) — `computeInstructions` transform
 * surfaces `module_question_target` directive when:
 *
 *   1. `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   2. `sharedState.lockedModule` set (learner picked via Module Picker)
 *   3. `Playbook.config.modules[]` has a matching AuthoredModule by id
 *      (falls back to slug)
 *   4. `settings.questionTarget = {min, target}` is a valid pair
 *      (positive integers, `min <= target`)
 *
 * Otherwise the key is `null`.
 *
 * Pins:
 *   - flag-off → null (no-op default)
 *   - flag-on + matching settings → {min, target, directive}
 *   - directive is interpolated with operator's min/target — no literal
 *     greeting / fixed template strings (ESLint `no-hardcoded-greeting-
 *     in-composition` clean)
 *   - degraded inputs (min>target, negative, NaN, missing) → null
 *   - no matching authored module → null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@/lib/prompt/composition/transforms/instructions";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

function makeSharedState(overrides: Partial<SharedComputedState> = {}): SharedComputedState {
  return {
    channel: "text",
    modules: [],
    isFirstCall: false,
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
    callNumber: 3,
    ...overrides,
  };
}

function makeContext(
  closingArgs: {
    questionTarget?: { min: number; target: number } | undefined;
    lockedId?: string;
    matchById?: boolean;
    noLockedModule?: boolean;
  } = {},
): AssembledContext {
  const lockedId = closingArgs.lockedId ?? "part1";
  const matchById = closingArgs.matchById ?? true;
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedId : "other-id",
    label: "Part 1: Familiar Topics",
    learnerSelectable: true,
    mode: "tutor",
    duration: "10 min",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    settings:
      closingArgs.questionTarget !== undefined
        ? { questionTarget: closingArgs.questionTarget }
        : {},
  };
  const playbookConfig: PlaybookConfig = { modules: [authoredModule] };
  return {
    sharedState: makeSharedState({
      lockedModule: closingArgs.noLockedModule
        ? null
        : ({
            id: lockedId,
            slug: lockedId,
            name: "Part 1",
          } as unknown as SharedComputedState["lockedModule"]),
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
          name: "IELTS",
          status: "PUBLISHED",
          config: playbookConfig,
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

describe("computeInstructions — moduleQuestionTarget (#1732)", () => {
  describe("HF_FLAG_IELTS_MODULE_SETTINGS gating", () => {
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when the flag is off (default)", async () => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
      const ctx = makeContext({ questionTarget: { min: 10, target: 13 } });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("emits {min,target,directive} when flag on + matching settings", async () => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
      const ctx = makeContext({ questionTarget: { min: 10, target: 13 } });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: { min: number; target: number; directive: string } | null;
      };
      expect(result.module_question_target).toEqual({
        min: 10,
        target: 13,
        directive: "Aim for 10 to 13 questions in this module — track silently as you go.",
      });
    });
  });

  describe("resolution semantics (flag on)", () => {
    beforeEach(() => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    });
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when no lockedModule is set", async () => {
      const ctx = makeContext({
        questionTarget: { min: 10, target: 13 },
        noLockedModule: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("returns null when no matching authored module exists", async () => {
      const ctx = makeContext({
        questionTarget: { min: 10, target: 13 },
        matchById: false,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("returns null when questionTarget is missing", async () => {
      const ctx = makeContext({});
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("returns null when min > target (invalid)", async () => {
      const ctx = makeContext({ questionTarget: { min: 15, target: 10 } });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("returns null when min < 1", async () => {
      const ctx = makeContext({ questionTarget: { min: 0, target: 5 } });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("returns null when min/target are not finite numbers", async () => {
      const ctx = makeContext({
        questionTarget: { min: Number.NaN, target: 5 },
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: unknown;
      };
      expect(result.module_question_target).toBeNull();
    });

    it("accepts min === target (a fixed-count target)", async () => {
      const ctx = makeContext({ questionTarget: { min: 6, target: 6 } });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_question_target: { min: number; target: number; directive: string };
      };
      expect(result.module_question_target).toEqual({
        min: 6,
        target: 6,
        directive: "Aim for 6 to 6 questions in this module — track silently as you go.",
      });
    });
  });
});
