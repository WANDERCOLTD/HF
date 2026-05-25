/**
 * targets transform — #784 (S6) firstSessionTargets priority-1 injection.
 *
 * Covers `Playbook.config.firstSessionTargets` reading at NEW priority 1
 * (above Domain.onboardingDefaultTargets) on the first-call path in
 * `mergeAndGroupTargets`. Pattern mirrors progress-narrative.test.ts.
 *
 * Cases:
 *   - No firstSessionTargets → existing domain cascade unchanged
 *   - firstSessionTargets present → injected at PLAYBOOK_FIRST_SESSION scope
 *   - Existing CallerTarget for the same parameter → override NOT applied
 *     (learner-scoped score still wins; first-call defaults only fill gaps)
 *   - When isFirstCall === false → no override (only fires on call 1)
 */

import { describe, it, expect } from "vitest";

import "@/lib/prompt/composition/transforms/targets";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
  BehaviorTargetData,
  CallerTargetData,
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

interface MakeCtxOpts {
  firstSessionTargets?: PlaybookConfig["firstSessionTargets"];
  behaviorTargets?: BehaviorTargetData[];
  callerTargets?: CallerTargetData[];
  isFirstCall?: boolean;
}

// #796 — audience defaults moved from a hardcoded const in targets.ts to
// INIT-001.audienceDefaultTargets. The test ctx must inject this in the
// onboardingSpec mock to keep covering the same cascade behaviour.
const MOCK_AUDIENCE_DEFAULTS = {
  "BEH-CHALLENGE-LEVEL": {
    primary:              { value: 0.3,  confidence: 0.5 },
    secondary:            { value: 0.45, confidence: 0.4 },
    "sixth-form":         { value: 0.55, confidence: 0.4 },
    "higher-ed":          { value: 0.6,  confidence: 0.3 },
    "adult-professional": { value: 0.55, confidence: 0.3 },
    "adult-casual":       { value: 0.45, confidence: 0.3 },
    mixed:                { value: 0.5,  confidence: 0.3 },
    default:              { value: 0.5,  confidence: 0.3 },
  },
};

function makeContext(opts: MakeCtxOpts = {}): AssembledContext {
  const playbookConfig: PlaybookConfig = opts.firstSessionTargets
    ? { firstSessionTargets: opts.firstSessionTargets }
    : {};
  return {
    sharedState: makeSharedState({ isFirstCall: opts.isFirstCall ?? true }),
    sections: {},
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: (opts.behaviorTargets ?? []) as unknown as AssembledContext["loadedData"]["behaviorTargets"],
      callerTargets: (opts.callerTargets ?? []) as unknown as AssembledContext["loadedData"]["callerTargets"],
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
      onboardingSpec: {
        id: "init-001",
        slug: "init-001",
        name: "Caller Onboarding",
        config: {
          audienceDefaultTargets: MOCK_AUDIENCE_DEFAULTS,
        },
      } as AssembledContext["loadedData"]["onboardingSpec"],
    },
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "behavior_targets",
  name: "Behavior Targets",
  priority: 8.0,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "mergeAndGroupTargets",
  outputKey: "behaviorTargets",
};

const transform = getTransform("mergeAndGroupTargets");

interface TargetsOutput {
  all: Array<{ parameterId: string; targetValue: number; scope: string }>;
  totalCount: number;
}

describe("mergeAndGroupTargets — firstSessionTargets (#784 S6)", () => {
  it("is registered", () => {
    expect(transform).toBeDefined();
  });

  it("does not inject anything when firstSessionTargets is absent (config cascade only)", () => {
    const ctx = makeContext({});
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    // No playbook overrides, but the audience-default block still fires
    // (AUDIENCE_TARGET_DEFAULTS), so we look for the ABSENCE of the new
    // scope label rather than zero total.
    const playbookScoped = result.all.filter((t) => t.scope === "PLAYBOOK_FIRST_SESSION");
    expect(playbookScoped).toHaveLength(0);
  });

  it("injects a per-playbook first-call override at PLAYBOOK_FIRST_SESSION scope", () => {
    const ctx = makeContext({
      firstSessionTargets: {
        "BEH-WARMTH": { value: 0.85 },
      },
    });
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const warmth = result.all.find((t) => t.parameterId === "BEH-WARMTH");
    expect(warmth).toBeDefined();
    expect(warmth!.targetValue).toBe(0.85);
    expect(warmth!.scope).toBe("PLAYBOOK_FIRST_SESSION");
  });

  it("does NOT override an existing CallerTarget for the same parameter", () => {
    // A learner already scored on this parameter — first-call defaults must
    // fill gaps, never overwrite the learner-personalised value.
    const callerTarget = {
      parameterId: "BEH-WARMTH",
      targetValue: 0.3,
      confidence: 0.9,
      parameter: {
        name: "warmth",
        parameterId: "BEH-WARMTH",
        interpretationLow: null,
        interpretationHigh: null,
        domainGroup: "Behaviour",
      },
    } as unknown as CallerTargetData;

    const ctx = makeContext({
      callerTargets: [callerTarget],
      firstSessionTargets: {
        "BEH-WARMTH": { value: 0.85 },
      },
    });
    const result = transform!(
      { behaviorTargets: [], callerTargets: [callerTarget] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const warmth = result.all.find((t) => t.parameterId === "BEH-WARMTH");
    expect(warmth).toBeDefined();
    expect(warmth!.targetValue).toBe(0.3);
    expect(warmth!.scope).toBe("CALLER_PERSONALIZED");
  });

  it("does not inject overrides when isFirstCall is false", () => {
    const ctx = makeContext({
      isFirstCall: false,
      firstSessionTargets: {
        "BEH-WARMTH": { value: 0.85 },
      },
    });
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const playbookScoped = result.all.filter((t) => t.scope === "PLAYBOOK_FIRST_SESSION");
    expect(playbookScoped).toHaveLength(0);
  });

  it("precedes the audience-default for the same parameter (priority 1 wins)", () => {
    // INIT-001.audienceDefaultTargets has a default for BEH-CHALLENGE-LEVEL —
    // when the playbook overrides it, the audience injection must skip that
    // paramId. (#796: was hardcoded AUDIENCE_TARGET_DEFAULTS const.)
    const ctx = makeContext({
      firstSessionTargets: {
        "BEH-CHALLENGE-LEVEL": { value: 0.9 },
      },
    });
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const challenge = result.all.find((t) => t.parameterId === "BEH-CHALLENGE-LEVEL");
    expect(challenge).toBeDefined();
    expect(challenge!.targetValue).toBe(0.9);
    expect(challenge!.scope).toBe("PLAYBOOK_FIRST_SESSION");
    // Only one entry — audience default did NOT also fire for this paramId.
    const matching = result.all.filter((t) => t.parameterId === "BEH-CHALLENGE-LEVEL");
    expect(matching).toHaveLength(1);
  });

  // #796 — cascade-order guard. Ensures the four-priority cascade (1: playbook
  // firstSessionTargets → 2: domain onboardingDefaultTargets → 3: INIT-001
  // defaultTargets → 4: INIT-001.audienceDefaultTargets) stays in this order
  // after the AUDIENCE_TARGET_DEFAULTS const → spec-config migration.
  it("priority 4: INIT-001.audienceDefaultTargets injects only when no higher cascade layer covered the param", () => {
    // Bare context — no playbook firstSessionTargets, no domain defaults, no
    // INIT-001 defaultTargets entry for BEH-CHALLENGE-LEVEL. Only the audience
    // default (priority 4) should fire.
    const ctx = makeContext({});
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const challenge = result.all.find((t) => t.parameterId === "BEH-CHALLENGE-LEVEL");
    expect(challenge).toBeDefined();
    expect(challenge!.scope).toBe("AUDIENCE_DEFAULT");
    // 'mixed' audience default = 0.5 per MOCK_AUDIENCE_DEFAULTS
    expect(challenge!.targetValue).toBe(0.5);
  });

  it("priority 4 skips metadata keys (e.g. _note) in audienceDefaultTargets", () => {
    // Authors of the INIT-001 spec JSON sometimes add `_note` or other metadata
    // keys alongside the real parameter keys. The cascade must skip these.
    const ctx = makeContext({});
    const result = transform!(
      { behaviorTargets: [], callerTargets: [] },
      ctx,
      STUB_SECTION,
    ) as TargetsOutput;
    const metaEntry = result.all.find((t) => t.parameterId.startsWith("_"));
    expect(metaEntry).toBeUndefined();
  });
});
