/**
 * pedagogy transform — #790 (S8) firstCallMode branching.
 *
 * Three modes:
 *   - 'onboarding' (default) → sessionType === "FIRST_CALL", existing
 *     ONBOARDING MODE branch runs
 *   - 'teach_immediately' → sessionType === "RETURNING_CALLER",
 *     ONBOARDING MODE branch SKIPPED on call 1
 *   - 'baseline_assessment' → sessionType === "BASELINE", new diagnostic
 *     flow emitted, principles overridden
 *
 * Pattern mirrors progress-narrative.test.ts. We don't snapshot the full
 * onboarding flow — just check the sessionType + flow signatures that
 * distinguish each mode.
 */

import { describe, it, expect } from "vitest";

import "@/lib/prompt/composition/transforms/pedagogy";
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
  teachingMode?: string;
  hasCurriculum?: boolean;
} = {}): AssembledContext {
  const playbookConfig: PlaybookConfig = {};
  if (opts.firstCallMode) playbookConfig.firstCallMode = opts.firstCallMode;
  if (opts.teachingMode) playbookConfig.teachingMode = opts.teachingMode;

  // Stubbed modules → hasCurriculum=true so the returning-caller branch is
  // available for teach_immediately.
  const modules = opts.hasCurriculum
    ? ([
        { id: "m1", name: "Part 1", description: "intro" },
      ] as unknown as SharedComputedState["modules"])
    : ([] as unknown as SharedComputedState["modules"]);

  return {
    sharedState: makeSharedState({ modules }),
    sections: {
      teachingContent: opts.hasCurriculum ? { hasTeachingContent: true } : {},
    },
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
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
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "instructions_pedagogy",
  name: "Session Pedagogy",
  priority: 9.0,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computeSessionPedagogy",
  outputKey: "instructions_pedagogy",
};

interface PedagogyPlan {
  sessionType: string;
  flow: string[];
  principles: string[];
  firstCallPhases?: Array<{ phase: string }>;
}

const transform = getTransform("computeSessionPedagogy")!;

describe("computeSessionPedagogy — #790 firstCallMode branching", () => {
  it("default 'onboarding' mode → sessionType=FIRST_CALL with onboarding flow", () => {
    const ctx = makeContext({ hasCurriculum: true });
    const plan = transform(null, ctx, STUB_SECTION) as PedagogyPlan;
    expect(plan.sessionType).toBe("FIRST_CALL");
    // Onboarding flow starts with welcome/intro — never "Set context — this
    // first call captures baseline ability" (the baseline-mode opener).
    expect(plan.flow.join("\n")).not.toMatch(/this first call captures baseline/i);
  });

  it("'teach_immediately' mode → skips ONBOARDING MODE on call 1; sessionType=RETURNING_CALLER", () => {
    const ctx = makeContext({
      firstCallMode: "teach_immediately",
      hasCurriculum: true,
    });
    const plan = transform(null, ctx, STUB_SECTION) as PedagogyPlan;
    expect(plan.sessionType).toBe("RETURNING_CALLER");
    // Flow is from the returning-caller branch ("Reconnect - reference last session...")
    expect(plan.flow.join("\n")).toMatch(/reconnect/i);
    // ONBOARDING MODE phases must NOT be populated.
    expect(plan.firstCallPhases).toBeUndefined();
  });

  it("'baseline_assessment' mode → sessionType=BASELINE with diagnostic flow", () => {
    const ctx = makeContext({
      firstCallMode: "baseline_assessment",
      hasCurriculum: true,
    });
    const plan = transform(null, ctx, STUB_SECTION) as PedagogyPlan;
    expect(plan.sessionType).toBe("BASELINE");
    const flowText = plan.flow.join("\n");
    expect(flowText).toMatch(/this first call captures baseline/i);
    expect(flowText).toMatch(/score what you observe|listen and score/i);
    // Baseline principles override the curriculum/no-curriculum principles
    // block — must contain the "no teaching" line.
    expect(plan.principles.join("\n")).toMatch(/no teaching, no review/i);
  });

  it("'baseline_assessment' does not flow into the teaching-session post-coverage block", () => {
    const ctx = makeContext({
      firstCallMode: "baseline_assessment",
      hasCurriculum: true,
    });
    const plan = transform(null, ctx, STUB_SECTION) as PedagogyPlan & {
      postCoverageGuidance?: string;
    };
    // post-coverage block is only added when isTeachingSession is true;
    // baseline mode must not be a teaching session.
    expect(plan.postCoverageGuidance).toBeUndefined();
  });
});
