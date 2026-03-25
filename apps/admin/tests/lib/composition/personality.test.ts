import { describe, it, expect } from "vitest";
import { computePersonalityAdaptation } from "@/lib/prompt/composition/transforms/personality";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef, PersonalityData } from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/personality";

// --- helpers ---

function makePersonality(overrides: Partial<PersonalityData> = {}): PersonalityData {
  return {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
    preferredTone: null,
    preferredLength: null,
    technicalLevel: null,
    confidenceScore: 0.7,
    ...overrides,
  };
}

function makeContext(personality: PersonalityData | null = null): AssembledContext {
  return {
    loadedData: {
      caller: null,
      memories: [],
      personality,
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
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "personality",
    name: "Personality",
    priority: 3,
    dataSource: "personality",
    activateWhen: { condition: "dataExists" },
    fallback: { action: "null" },
    transform: "mapPersonalityTraits",
    outputKey: "personality",
  };
}

// =====================================================
// mapPersonalityTraits transform
// =====================================================

describe("mapPersonalityTraits transform", () => {
  it("is registered", () => {
    expect(getTransform("mapPersonalityTraits")).toBeDefined();
  });

  it("returns null for null personality", () => {
    const ctx = makeContext(null);
    const result = getTransform("mapPersonalityTraits")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("maps Big Five traits with scores and levels", () => {
    const personality = makePersonality({
      openness: 0.8,       // HIGH
      extraversion: 0.2,   // LOW
      neuroticism: 0.5,    // MODERATE
    });
    const ctx = makeContext(personality);
    const result = getTransform("mapPersonalityTraits")!(personality, ctx, makeSectionDef());

    expect(result.traits.openness.score).toBe(0.8);
    expect(result.traits.openness.level).toBe("HIGH");
    expect(result.traits.extraversion.score).toBe(0.2);
    expect(result.traits.extraversion.level).toBe("LOW");
    expect(result.traits.neuroticism.level).toBe("MODERATE");
  });

  it("includes preferences from personality data", () => {
    const personality = makePersonality({
      preferredTone: "warm",
      preferredLength: "concise",
      technicalLevel: "intermediate",
    });
    const ctx = makeContext(personality);
    const result = getTransform("mapPersonalityTraits")!(personality, ctx, makeSectionDef());

    expect(result.preferences.tone).toBe("warm");
    expect(result.preferences.responseLength).toBe("concise");
    expect(result.preferences.technicalLevel).toBe("intermediate");
  });

  it("includes confidence score", () => {
    const personality = makePersonality({ confidenceScore: 0.85 });
    const ctx = makeContext(personality);
    const result = getTransform("mapPersonalityTraits")!(personality, ctx, makeSectionDef());
    expect(result.confidence).toBe(0.85);
  });

  it("counts only numeric parameter traits", () => {
    const personality = makePersonality();
    const ctx = makeContext(personality);
    const result = getTransform("mapPersonalityTraits")!(personality, ctx, makeSectionDef());
    // Big Five = 5, confidenceScore is skipped => parameterCount = 5
    expect(result.parameterCount).toBe(5);
  });

  it("handles null trait values gracefully", () => {
    const personality = makePersonality({ openness: null, conscientiousness: null });
    const ctx = makeContext(personality);
    const result = getTransform("mapPersonalityTraits")!(personality, ctx, makeSectionDef());
    expect(result.traits.openness.score).toBeNull();
    expect(result.traits.openness.level).toBeNull();
  });
});

// =====================================================
// computePersonalityAdaptation — exported pure function
// =====================================================

describe("computePersonalityAdaptation", () => {
  const thresholds = { high: 0.65, low: 0.35 };

  it("returns fallback message for null personality", () => {
    const result = computePersonalityAdaptation(null, thresholds);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("No personality data");
  });

  it("generates HIGH adaptation for high trait values", () => {
    const personality = makePersonality({ openness: 0.9 });
    const result = computePersonalityAdaptation(personality, thresholds);
    const openAdaptation = result.find((a) => a.includes("OPENNESS"));
    expect(openAdaptation).toBeDefined();
    expect(openAdaptation).toContain("HIGH");
    expect(openAdaptation).toContain("90%");
  });

  it("generates LOW adaptation for low trait values", () => {
    const personality = makePersonality({ extraversion: 0.1 });
    const result = computePersonalityAdaptation(personality, thresholds);
    const extAdaptation = result.find((a) => a.includes("EXTRAVERSION"));
    expect(extAdaptation).toBeDefined();
    expect(extAdaptation).toContain("LOW");
  });

  it("skips moderate values", () => {
    const personality = makePersonality({
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    });
    const result = computePersonalityAdaptation(personality, thresholds);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("No strong personality traits");
  });

  it("generates multiple adaptations for extreme profiles", () => {
    const personality = makePersonality({
      openness: 0.9,
      extraversion: 0.1,
      neuroticism: 0.8,
    });
    const result = computePersonalityAdaptation(personality, thresholds);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
