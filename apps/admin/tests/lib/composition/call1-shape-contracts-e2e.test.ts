/**
 * #2051 (epic #2049 sub-epic B) — end-to-end Inspector → transform pin.
 *
 * Exercises the full Inspector save-path → composed prompt assertion for
 * all 3 Call 1 shape contracts:
 *
 *   1. `baselineAssessmentDepth` → instructions transform → renderer
 *   2. `firstCallCurriculumFocus` → modules transform scheduler filter
 *   3. `moduleSequencePolicy` → modules transform scheduler filter +
 *      cadence override
 *
 * Each test:
 *   - Looks up the contract in `JOURNEY_SETTINGS` (the source of truth the
 *     Inspector reads)
 *   - Calls `applyAtPath` with the contract's `storagePath` (mirroring
 *     what the journey-setting PATCH route does on save)
 *   - Then exercises the consumer (the instructions transform OR the
 *     scheduler-pool helpers in modules.ts) with the resulting config
 *   - Asserts the value reaches the consumer (the producer↔consumer
 *     pairing the rule file `.claude/rules/registry-consumer-coverage.md`
 *     enforces structurally — these tests pin the runtime contract)
 *
 * This is the Inspector-side e2e proof. The transform-side unit tests live
 * in `baseline-assessment-depth.test.ts`, `first-call-curriculum-focus.test.ts`,
 * and `module-sequence-policy.test.ts`.
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/instructions";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import {
  applyAtPath,
  resolveStoragePath,
} from "@/lib/journey/storage-path-applier";
import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import {
  filterSchedulerModules,
  resolveInterleaveModeOverride,
} from "@/lib/prompt/composition/transforms/modules";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
  ModuleData,
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

function makeInstructionsContext(config: PlaybookConfig): AssembledContext {
  return {
    sharedState: makeSharedState({ isFirstCall: true }),
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
          name: "E2E playbook",
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

function findContract(id: string) {
  const c = JOURNEY_SETTINGS.find((s) => s.id === id);
  if (!c) throw new Error(`Inspector contract not registered: ${id}`);
  return c;
}

describe("#2051 e2e — Inspector save → composed prompt assertion", () => {
  describe("baselineAssessmentDepth", () => {
    it("Inspector save 'deep' lands in the composed instructions section", async () => {
      const contract = findContract("baselineAssessmentDepth");
      // Base config: Inspector has previously set firstCallMode=baseline_assessment.
      // The Inspector save we're now exercising sets the DEPTH knob.
      const baseConfig: PlaybookConfig = {
        firstCallMode: "baseline_assessment",
      };
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(baseConfig, resolved, "deep");

      // Verify the PATCH-equivalent write landed at the right field.
      expect(updatedConfig.baselineAssessmentDepth).toBe("deep");

      // Now exercise the transform with the resulting config — the
      // producer↔consumer pairing this test proves.
      const ctx = makeInstructionsContext(updatedConfig);
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        baseline_assessment_depth: {
          depth: string;
          directive: string;
        } | null;
      };
      expect(result.baseline_assessment_depth).not.toBeNull();
      expect(result.baseline_assessment_depth!.depth).toBe("deep");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "8 diagnostic questions",
      );
      expect(result.baseline_assessment_depth!.directive).toMatch(/follow-up/i);
    });

    it("Inspector save 'light' lands and shapes the directive accordingly", async () => {
      const contract = findContract("baselineAssessmentDepth");
      const baseConfig: PlaybookConfig = {
        firstCallMode: "baseline_assessment",
      };
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(baseConfig, resolved, "light");

      expect(updatedConfig.baselineAssessmentDepth).toBe("light");

      const ctx = makeInstructionsContext(updatedConfig);
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        baseline_assessment_depth: {
          depth: string;
          directive: string;
        } | null;
      };
      expect(result.baseline_assessment_depth!.depth).toBe("light");
      expect(result.baseline_assessment_depth!.directive).toContain(
        "3 diagnostic questions",
      );
    });
  });

  describe("firstCallCurriculumFocus", () => {
    it("Inspector save lands in scheduler-pool filter on Call 1", () => {
      const contract = findContract("firstCallCurriculumFocus");
      const baseConfig: PlaybookConfig = {};
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(
        baseConfig,
        resolved,
        ["module-a", "module-c"],
      );

      // The Inspector-side write landed.
      expect(updatedConfig.firstCallCurriculumFocus).toEqual([
        "module-a",
        "module-c",
      ]);

      // The consumer reads it: full module list passed to scheduler filter
      // narrows to only the allow-listed two.
      const modules: ModuleData[] = [
        { id: "id-a", slug: "module-a", name: "A", prerequisites: [] },
        { id: "id-b", slug: "module-b", name: "B", prerequisites: [] },
        { id: "id-c", slug: "module-c", name: "C", prerequisites: [] },
      ];
      const pool = filterSchedulerModules({
        modules,
        completedModules: new Set<string>(),
        pbConfig: updatedConfig,
        isFirstCall: true,
      });
      expect(pool.map((m) => m.slug).sort()).toEqual(["module-a", "module-c"]);
    });
  });

  describe("moduleSequencePolicy", () => {
    it("Inspector save 'strict' lands and gates the scheduler pool by prereqs", () => {
      const contract = findContract("moduleSequencePolicy");
      const baseConfig: PlaybookConfig = {};
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(baseConfig, resolved, "strict");

      expect(updatedConfig.moduleSequencePolicy).toBe("strict");

      const modules: ModuleData[] = [
        { id: "id-a", slug: "module-a", name: "A", prerequisites: [] },
        { id: "id-b", slug: "module-b", name: "B", prerequisites: ["module-a"] },
      ];
      const pool = filterSchedulerModules({
        modules,
        completedModules: new Set<string>(), // module-a not yet mastered
        pbConfig: updatedConfig,
        isFirstCall: false,
      });
      // module-b is gated (prereq unmet) → pool is just [module-a].
      expect(pool.map((m) => m.slug)).toEqual(["module-a"]);
    });

    it("Inspector save 'interleaved' lands and fires the 4th-call cadence override", () => {
      const contract = findContract("moduleSequencePolicy");
      const baseConfig: PlaybookConfig = {};
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(baseConfig, resolved, "interleaved");

      expect(updatedConfig.moduleSequencePolicy).toBe("interleaved");

      // Cadence fires on call 4 / 8 / 12 …
      expect(
        resolveInterleaveModeOverride({
          pbConfig: updatedConfig,
          callNumber: 4,
        }),
      ).toBe("review");
      // … and stays silent in between.
      expect(
        resolveInterleaveModeOverride({
          pbConfig: updatedConfig,
          callNumber: 2,
        }),
      ).toBeNull();
    });

    it("Inspector save 'learner_led' lands but is a true no-op (byte-identical to absent)", () => {
      const contract = findContract("moduleSequencePolicy");
      const baseConfig: PlaybookConfig = {};
      const resolved = resolveStoragePath(contract.storagePath);
      const updatedConfig = applyAtPath(baseConfig, resolved, "learner_led");

      expect(updatedConfig.moduleSequencePolicy).toBe("learner_led");

      // Filter is a no-op — same reference as the input.
      const modules: ModuleData[] = [
        { id: "id-a", slug: "module-a", name: "A", prerequisites: ["unmet"] },
      ];
      const poolLearnerLed = filterSchedulerModules({
        modules,
        completedModules: new Set<string>(),
        pbConfig: updatedConfig,
        isFirstCall: false,
      });
      const poolAbsent = filterSchedulerModules({
        modules,
        completedModules: new Set<string>(),
        pbConfig: {} as PlaybookConfig,
        isFirstCall: false,
      });
      expect(poolLearnerLed).toBe(modules);
      expect(poolAbsent).toBe(modules);
      expect(poolLearnerLed).toEqual(poolAbsent);

      // Cadence override is null on every call number.
      for (const n of [1, 2, 3, 4, 8]) {
        expect(
          resolveInterleaveModeOverride({
            pbConfig: updatedConfig,
            callNumber: n,
          }),
        ).toBeNull();
      }
    });
  });
});
