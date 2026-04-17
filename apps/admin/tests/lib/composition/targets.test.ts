import { describe, it, expect } from "vitest";
import { mergeTargets } from "@/lib/prompt/composition/transforms/targets";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  BehaviorTargetData,
  CallerTargetData,
} from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/targets";

// --- helpers ---

function makeBehaviorTarget(overrides: Partial<BehaviorTargetData> = {}): BehaviorTargetData {
  return {
    parameterId: "BEH-WARMTH",
    targetValue: 0.7,
    confidence: 0.8,
    scope: "SYSTEM",
    parameter: {
      name: "warmth",
      interpretationLow: "Cool/professional",
      interpretationHigh: "Warm/friendly",
      domainGroup: "Communication Style",
    },
    ...overrides,
  };
}

function makeCallerTarget(overrides: Partial<CallerTargetData> = {}): CallerTargetData {
  return {
    parameterId: "BEH-WARMTH",
    targetValue: 0.9,
    confidence: 0.95,
    parameter: {
      name: "warmth",
      interpretationLow: "Cool/professional",
      interpretationHigh: "Warm/friendly",
      domainGroup: "Communication Style",
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: {
      caller: { id: "c1", name: "Paul", email: null, phone: null, externalId: null, domain: null },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 5,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      channel: "voice" as const,
      callNumber: 1,
      isFinalSession: false,
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "behavior_targets",
    name: "Behavior Targets",
    priority: 5,
    dataSource: ["behaviorTargets", "callerTargets"],
    activateWhen: { condition: "always" },
    fallback: { action: "emptyObject" },
    transform: "mergeAndGroupTargets",
    outputKey: "behaviorTargets",
  };
}

// =====================================================
// mergeTargets — exported pure function
// =====================================================

describe("mergeTargets", () => {
  it("returns empty array when no targets", () => {
    const result = mergeTargets([], [], []);
    expect(result).toHaveLength(0);
  });

  it("includes CallerTargets with highest priority", () => {
    const bt = makeBehaviorTarget({ parameterId: "BEH-WARMTH", targetValue: 0.5 });
    const ct = makeCallerTarget({ parameterId: "BEH-WARMTH", targetValue: 0.9 });

    const result = mergeTargets([bt], [ct], []);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBe(0.9);
    expect(result[0].source).toBe("CallerTarget");
    expect(result[0].scope).toBe("CALLER_PERSONALIZED");
  });

  it("fills in BehaviorTargets for missing parameters", () => {
    const bt1 = makeBehaviorTarget({ parameterId: "BEH-WARMTH", targetValue: 0.6 });
    const bt2 = makeBehaviorTarget({ parameterId: "BEH-DIRECTNESS", targetValue: 0.4 });
    const ct = makeCallerTarget({ parameterId: "BEH-WARMTH", targetValue: 0.9 });

    const result = mergeTargets([bt1, bt2], [ct], []);
    expect(result).toHaveLength(2);

    const warmth = result.find((t) => t.parameterId === "BEH-WARMTH");
    expect(warmth!.targetValue).toBe(0.9); // CallerTarget wins

    const directness = result.find((t) => t.parameterId === "BEH-DIRECTNESS");
    expect(directness!.targetValue).toBe(0.4); // BehaviorTarget fills in
    expect(directness!.source).toBe("BehaviorTarget");
  });

  it("respects scope priority: PLAYBOOK > DOMAIN > SYSTEM", () => {
    const systemTarget = makeBehaviorTarget({ parameterId: "P1", scope: "SYSTEM", targetValue: 0.3 });
    const domainTarget = makeBehaviorTarget({ parameterId: "P1", scope: "DOMAIN", targetValue: 0.6 });

    const result = mergeTargets([systemTarget, domainTarget], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBe(0.6); // DOMAIN > SYSTEM
    expect(result[0].scope).toBe("DOMAIN");
  });

  it("includes PLAYBOOK targets only when playbook ID matches", () => {
    const playbookTarget = makeBehaviorTarget({
      parameterId: "P1",
      scope: "PLAYBOOK",
      playbookId: "pb-1",
      targetValue: 0.8,
    });

    // Matching playbook
    const result1 = mergeTargets([playbookTarget], [], ["pb-1"]);
    expect(result1).toHaveLength(1);
    expect(result1[0].targetValue).toBe(0.8);

    // Non-matching playbook
    const result2 = mergeTargets([playbookTarget], [], ["pb-99"]);
    expect(result2).toHaveLength(0);
  });

  it("PLAYBOOK target overrides SYSTEM for same parameter", () => {
    const systemTarget = makeBehaviorTarget({ parameterId: "P1", scope: "SYSTEM", targetValue: 0.3 });
    const playbookTarget = makeBehaviorTarget({
      parameterId: "P1",
      scope: "PLAYBOOK",
      playbookId: "pb-1",
      targetValue: 0.9,
    });

    const result = mergeTargets([systemTarget, playbookTarget], [], ["pb-1"]);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBe(0.9);
    expect(result[0].scope).toBe("PLAYBOOK");
  });

  it("CallerTarget always wins over PLAYBOOK scope", () => {
    const playbookTarget = makeBehaviorTarget({
      parameterId: "P1",
      scope: "PLAYBOOK",
      playbookId: "pb-1",
      targetValue: 0.5,
    });
    const ct = makeCallerTarget({ parameterId: "P1", targetValue: 0.99 });

    const result = mergeTargets([playbookTarget], [ct], ["pb-1"]);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBe(0.99);
    expect(result[0].source).toBe("CallerTarget");
  });
});

// =====================================================
// mergeAndGroupTargets transform
// =====================================================

describe("mergeAndGroupTargets transform", () => {
  it("is registered", () => {
    expect(getTransform("mergeAndGroupTargets")).toBeDefined();
  });

  it("produces grouped output with byDomain and all", () => {
    const bt = makeBehaviorTarget({ parameterId: "BEH-WARMTH", targetValue: 0.7 });
    const ctx = makeContext();
    const rawData = { behaviorTargets: [bt], callerTargets: [] };

    const result = getTransform("mergeAndGroupTargets")!(rawData, ctx, makeSectionDef());

    expect(result.totalCount).toBe(1);
    expect(result.byDomain["Communication Style"]).toHaveLength(1);
    expect(result.all).toHaveLength(1);
    expect(result.all[0].targetLevel).toBe("HIGH"); // 0.7 >= 0.65
    expect(result._merged).toBeDefined();
  });

  it("classifies target levels correctly", () => {
    const targets = [
      makeBehaviorTarget({ parameterId: "P1", targetValue: 0.8 }),
      makeBehaviorTarget({ parameterId: "P2", targetValue: 0.3 }),
      makeBehaviorTarget({ parameterId: "P3", targetValue: 0.5 }),
    ];
    const ctx = makeContext();
    const rawData = { behaviorTargets: targets, callerTargets: [] };

    const result = getTransform("mergeAndGroupTargets")!(rawData, ctx, makeSectionDef());

    const p1 = result.all.find((t: any) => t.parameterId === "P1");
    const p2 = result.all.find((t: any) => t.parameterId === "P2");
    const p3 = result.all.find((t: any) => t.parameterId === "P3");

    expect(p1.targetLevel).toBe("HIGH");
    expect(p2.targetLevel).toBe("LOW");
    expect(p3.targetLevel).toBe("MODERATE");
  });

  it("injects INIT-001 defaults on first call for missing params", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        onboardingSpec: {
          id: "init-1",
          slug: "INIT-001",
          name: "Onboarding",
          config: {
            defaultTargets: {
              "BEH-WARMTH": { value: 0.6, confidence: 0.5 },
              "BEH-DIRECTNESS": { value: 0.4, confidence: 0.5 },
            },
          },
        },
      },
      sharedState: {
        ...makeContext().sharedState,
        isFirstCall: true,
      },
    });

    const rawData = { behaviorTargets: [], callerTargets: [] };
    const result = getTransform("mergeAndGroupTargets")!(rawData, ctx, makeSectionDef());

    expect(result.totalCount).toBe(3); // 2 INIT-001 + 1 AUDIENCE_DEFAULT (BEH-CHALLENGE-LEVEL)
    const warmth = result.all.find((t: any) => t.parameterId === "BEH-WARMTH");
    expect(warmth).toBeDefined();
    expect(warmth.scope).toBe("INIT_DEFAULT");
    const challenge = result.all.find((t: any) => t.parameterId === "BEH-CHALLENGE-LEVEL");
    expect(challenge).toBeDefined();
    expect(challenge.scope).toBe("AUDIENCE_DEFAULT");
  });

  it("applies preview target overrides from specConfig", () => {
    const bt = makeBehaviorTarget({ parameterId: "BEH-WARMTH", targetValue: 0.5 });
    const ctx = makeContext({ specConfig: { targetOverrides: { "BEH-WARMTH": 0.95 } } });
    const rawData = { behaviorTargets: [bt], callerTargets: [] };

    const result = getTransform("mergeAndGroupTargets")!(rawData, ctx, makeSectionDef());

    const warmth = result._merged.find((t: any) => t.parameterId === "BEH-WARMTH");
    expect(warmth.targetValue).toBe(0.95);
    expect(warmth.scope).toBe("PREVIEW");
  });
});
