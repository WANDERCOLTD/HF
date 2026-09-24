import { describe, it, expect } from "vitest";
import {
  computePersonalityAdaptation,
  computePersonalityAdaptationDirectives,
} from "@/lib/prompt/composition/transforms/personality";
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
            nextLearnerFacingNumber: 1,
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
      callNumber: 1,
      channel: "voice" as const,
      isFinalSession: false,
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

// =====================================================
// computePersonalityAdaptationDirectives — #2083 / epic #2078 S1
//
// Wires the 5 producer-only `BEH-*-ADAPTATION` parameters into the compose
// read path. Each directive reads (a) the caller's matching B5-* score from
// the personality snapshot and (b) the parameter's interpretationHigh/Low
// rationale from the BehaviorTarget cascade. Together they close the
// personality-adaptation gap pinned by `parameter-coverage.test.ts`.
// =====================================================

function makeAdaptationTarget(
  parameterId: string,
  interpretationHigh: string,
  interpretationLow: string,
  targetValue = 0.5,
) {
  return {
    parameterId,
    targetValue,
    parameter: {
      parameterId,
      interpretationHigh,
      interpretationLow,
      name: parameterId,
    },
  };
}

function makeAllFiveAdaptationTargets() {
  return [
    makeAdaptationTarget(
      "BEH-OPENNESS-ADAPTATION",
      "Exploratory Style: Explore ideas, creative discussions, intellectual curiosity",
      "Practical Style: Concrete, practical, tried-and-true approaches",
    ),
    makeAdaptationTarget(
      "BEH-CONSCIENTIOUSNESS-ADAPTATION",
      "Structured Detail: Organized, detailed, action-oriented responses",
      "Flexible Overview: Big picture focus, adaptable, less rigid",
    ),
    makeAdaptationTarget(
      "BEH-EXTRAVERSION-ADAPTATION",
      "Energetic Dialogue: Dynamic, enthusiastic, expressive conversation",
      "Measured Pace: Quieter, space-giving, reflective style",
    ),
    makeAdaptationTarget(
      "BEH-AGREEABLENESS-ADAPTATION",
      "Warm Cooperative: Friendly, harmony-focused, relationship-building",
      "Direct Honest: Straightforward, efficient, no-nonsense",
    ),
    makeAdaptationTarget(
      "BEH-NEUROTICISM-ADAPTATION",
      "Reassuring Calm: Extra reassurance, calm steady presence, acknowledge concerns",
      "Straightforward: Direct communication, trust their resilience",
    ),
  ];
}

describe("computePersonalityAdaptationDirectives (#2083 / epic #2078 S1)", () => {
  const thresholds = { high: 0.65, low: 0.35 };
  const targets = makeAllFiveAdaptationTargets();

  it("returns empty array when personality data is null", () => {
    expect(computePersonalityAdaptationDirectives(null, targets, thresholds)).toEqual([]);
  });

  it("emits a HIGH directive for openness when BEH-B5-O score is high", () => {
    const personality = {
      ...makePersonality(),
      "BEH-B5-O": 0.85,
    } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("openness"));
    expect(directive).toBeDefined();
    expect(directive).toContain("HIGH");
    expect(directive).toContain("85%");
    expect(directive).toContain("Exploratory Style");
  });

  it("emits a LOW directive for conscientiousness when BEH-B5-C score is low", () => {
    const personality = {
      ...makePersonality(),
      "BEH-B5-C": 0.15,
    } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("conscientiousness"));
    expect(directive).toBeDefined();
    expect(directive).toContain("LOW");
    expect(directive).toContain("15%");
    expect(directive).toContain("Flexible Overview");
  });

  it("emits a HIGH directive for extraversion (BEH-B5-E)", () => {
    const personality = { ...makePersonality(), "BEH-B5-E": 0.9 } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("extraversion"));
    expect(directive).toBeDefined();
    expect(directive).toContain("HIGH");
    expect(directive).toContain("Energetic Dialogue");
  });

  it("emits a LOW directive for agreeableness (BEH-B5-A)", () => {
    const personality = { ...makePersonality(), "BEH-B5-A": 0.2 } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("agreeableness"));
    expect(directive).toBeDefined();
    expect(directive).toContain("LOW");
    expect(directive).toContain("Direct Honest");
  });

  it("emits a HIGH directive for neuroticism (BEH-B5-N)", () => {
    const personality = { ...makePersonality(), "BEH-B5-N": 0.8 } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("neuroticism"));
    expect(directive).toBeDefined();
    expect(directive).toContain("HIGH");
    expect(directive).toContain("Reassuring Calm");
  });

  it("skips moderate values (no directive in the band 35% – 65%)", () => {
    const personality = {
      ...makePersonality(),
      "BEH-B5-O": 0.5,
      "BEH-B5-C": 0.5,
      "BEH-B5-E": 0.5,
      "BEH-B5-A": 0.5,
      "BEH-B5-N": 0.5,
    } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    expect(result).toEqual([]);
  });

  it("falls back to legacy CallerPersonality fields when BEH-B5-* keys absent", () => {
    // Older callers may carry only the legacy `openness` / `extraversion` /
    // etc. fields from the pre-rebuild `CallerPersonality` table. The
    // helper must still produce a directive for those rows.
    const personality = makePersonality({
      openness: 0.9, // legacy field; no BEH-B5-O key
    });
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("openness"));
    expect(directive).toBeDefined();
    expect(directive).toContain("HIGH");
  });

  it("emits no directive when the matching ADAPTATION target is missing from mergedTargets", () => {
    // No targets in the cascade → the helper still emits a directive
    // (rationale text is omitted because there's no interpretationHigh/Low
    // to cite, but the HIGH/LOW signal still goes through). This guards
    // the "compose runs before BehaviorTarget seed has fired for new
    // installations" edge case.
    const personality = { ...makePersonality(), "BEH-B5-O": 0.9 } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, [], thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("openness"));
    expect(directive).toBeDefined();
    expect(directive).toContain("HIGH");
  });

  it("emits all 5 directives when caller is extreme on every Big Five dimension", () => {
    const personality = {
      ...makePersonality(),
      "BEH-B5-O": 0.9,
      "BEH-B5-C": 0.1,
      "BEH-B5-E": 0.9,
      "BEH-B5-A": 0.1,
      "BEH-B5-N": 0.9,
    } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    expect(result).toHaveLength(5);
  });

  it("uses BEH-B5-* key when both canonical key and legacy field are present", () => {
    // Canonical key wins; the legacy fallback only fires when the canonical
    // key isn't there.
    const personality = {
      ...makePersonality({ openness: 0.1 }),
      "BEH-B5-O": 0.9, // canonical wins → HIGH directive
    } as PersonalityData;
    const result = computePersonalityAdaptationDirectives(personality, targets, thresholds);
    const directive = result.find((d) => d.toLowerCase().includes("openness"));
    expect(directive).toContain("HIGH");
    expect(directive).toContain("90%");
  });
});
