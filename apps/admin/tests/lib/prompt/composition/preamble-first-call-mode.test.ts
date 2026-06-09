/**
 * preamble transform — #790 (S8) firstCallMode-driven critical-rule choice.
 *
 * Three cases:
 *   - 'baseline_assessment' on call 1 → BASELINE_ASSESSMENT_RULE injected;
 *     returningCallerByMode rule NOT injected
 *   - 'teach_immediately' on call 1 with teachingMode='practice' →
 *     returningCallerByMode[practice] rule injected (the existing branch
 *     already does this regardless of isFirstCall — verified by reading
 *     preamble.ts; this test guards against regression)
 *   - 'onboarding' (default) on call 1 → BASELINE_ASSESSMENT_RULE NOT
 *     injected; existing rule set unchanged
 *
 * The transform is registered async — we await its result.
 */

import { describe, it, expect, vi } from "vitest";

// Stub the spec-prompts lookup so the test doesn't hit the DB; the preamble
// systemInstruction string isn't what we're testing here.
vi.mock("@/lib/prompts/spec-prompts", () => ({
  getPromptSpec: vi.fn(async () => "stubbed system instruction"),
}));

import "@/lib/prompt/composition/transforms/preamble";
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
    modules: [
      { id: "m1", name: "Module 1", description: "test" } as unknown as SharedComputedState["modules"][number],
    ],
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
  teachingMode?: string;
} = {}): AssembledContext {
  const playbookConfig: PlaybookConfig = {};
  if (opts.firstCallMode) playbookConfig.firstCallMode = opts.firstCallMode;
  if (opts.teachingMode) playbookConfig.teachingMode = opts.teachingMode;

  return {
    sharedState: makeSharedState(),
    sections: {
      teachingContent: { hasTeachingContent: true },
    },
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
          name: "Test Playbook",
          status: "PUBLISHED",
          config: playbookConfig,
          domain: null,
          items: [],
        },
      ] as unknown as AssembledContext["loadedData"]["playbooks"],
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {
      voiceSpec: null,
    } as unknown as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "_preamble",
  name: "Preamble",
  priority: 1.0,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computePreamble",
  outputKey: "_preamble",
};

interface PreambleOutput {
  criticalRules: string[];
}

const transform = getTransform("computePreamble")!;

describe("computePreamble — #790 firstCallMode critical-rule selection", () => {
  it("'baseline_assessment' on call 1 injects BASELINE_ASSESSMENT_RULE", async () => {
    const ctx = makeContext({ firstCallMode: "baseline_assessment" });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).toMatch(/BASELINE_ASSESSMENT/);
    expect(rulesText).toMatch(/diagnostic evidence only/i);
    // Returning-caller rule must NOT be in the list (short-circuit semantics).
    expect(rulesText).not.toMatch(/RETURNING_CALLER/);
  });

  it("'teach_immediately' on call 1 injects the returningCallerByMode rule", async () => {
    const ctx = makeContext({
      firstCallMode: "teach_immediately",
      teachingMode: "practice",
    });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    // 'practice' archetype RETURNING_CALLER rule contains "warm-up attempt".
    expect(rulesText).toMatch(/warm-up attempt/i);
    // Baseline rule must NOT be in the list.
    expect(rulesText).not.toMatch(/BASELINE_ASSESSMENT/);
  });

  it("default 'onboarding' on call 1 does NOT inject baseline rule (preserves existing behaviour)", async () => {
    const ctx = makeContext({}); // firstCallMode unset → default 'onboarding'
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).not.toMatch(/BASELINE_ASSESSMENT/);
    // The pedagogy rules still come through — sanity check we didn't break
    // the universal rule set.
    expect(rulesText).toMatch(/Before referencing any rubric level/);
  });
});
