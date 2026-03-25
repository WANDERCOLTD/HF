import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/preamble";

// --- helpers ---

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
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
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
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
    id: "preamble",
    name: "Preamble",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computePreamble",
    outputKey: "_preamble",
  };
}

// =====================================================
// computePreamble transform
// =====================================================

describe("computePreamble transform", () => {
  it("is registered", () => {
    expect(getTransform("computePreamble")).toBeDefined();
  });

  it("returns structured preamble with all required fields", () => {
    const ctx = makeContext();
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());

    expect(result.systemInstruction).toBeDefined();
    expect(result.readingOrder).toBeInstanceOf(Array);
    expect(result.readingOrder.length).toBeGreaterThan(0);
    expect(result.sectionGuide).toBeDefined();
    expect(result.criticalRules).toBeInstanceOf(Array);
    expect(result.voiceRules).toBeInstanceOf(Array);
  });

  it("includes reading order with numbered steps", () => {
    const ctx = makeContext();
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());

    expect(result.readingOrder[0]).toContain("1.");
    expect(result.readingOrder[0]).toContain("_quickStart");
  });

  it("includes section guide with priorities", () => {
    const ctx = makeContext();
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());

    expect(result.sectionGuide._quickStart.priority).toBe("READ FIRST");
    expect(result.sectionGuide["instructions.voice"].priority).toBe("HIGHEST");
    expect(result.sectionGuide.identity.priority).toBe("HIGH");
    expect(result.sectionGuide.content.priority).toBe("MEDIUM");
    expect(result.sectionGuide.memories.priority).toBe("LOW");
  });

  it("uses default voice rules when no voiceSpec", () => {
    const ctx = makeContext();
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());

    expect(result.voiceRules.length).toBeGreaterThan(0);
    expect(result.voiceRules[0]).toContain("MAX 3 sentences");
  });

  it("uses voice spec rules when voiceSpec has them", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
        voiceSpec: {
          name: "Custom Voice",
          config: { voice_rules: { rules: ["Rule 1", "Rule 2"] } },
          description: null,
        },
      },
    });

    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());
    expect(result.voiceRules).toEqual(["Rule 1", "Rule 2"]);
  });

  it("includes critical rules about review and struggle handling (with-curriculum branch)", () => {
    const ctx = makeContext({
      sharedState: {
        modules: [{ id: "m1" }] as any,
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
    });
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());

    const rules = result.criticalRules.join(" ");
    expect(rules).toContain("RETURNING_CALLER");
    expect(rules).toContain("review");
    expect(rules).toContain("struggles");
  });

  it("includes all 4 pacing rules in with-curriculum branch", () => {
    const ctx = makeContext({
      sharedState: {
        modules: [{ id: "m1" }] as any,
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
    });
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());
    const rules = result.criticalRules.join(" ");

    expect(rules).toContain("Confirm readiness before moving to a new topic");
    expect(rules).toContain("Do not give answers before the student has attempted");
    expect(rules).toContain("Do not rush");
    expect(rules).toContain("Treat each session as standalone");
  });

  it("includes all 4 pacing rules in without-curriculum branch", () => {
    const ctx = makeContext({
      sharedState: {
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
      sections: {},
    });
    const result = getTransform("computePreamble")!(null, ctx, makeSectionDef());
    const rules = result.criticalRules.join(" ");

    expect(rules).toContain("Confirm readiness before moving to a new topic");
    expect(rules).toContain("Do not give answers before the student has attempted");
    expect(rules).toContain("Do not rush");
    expect(rules).toContain("Treat each session as standalone");
  });
});
