import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef, PersonalityData } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/voice";

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
    id: "voice",
    name: "Voice Guidance",
    priority: 2,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeVoiceGuidance",
    outputKey: "instructions.voice",
  };
}

// =====================================================
// computeVoiceGuidance transform
// =====================================================

describe("computeVoiceGuidance transform", () => {
  it("is registered", () => {
    expect(getTransform("computeVoiceGuidance")).toBeDefined();
  });

  it("returns complete voice guidance structure", () => {
    const ctx = makeContext();
    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());

    expect(result.response_length).toBeDefined();
    expect(result.pacing).toBeDefined();
    expect(result.natural_speech).toBeDefined();
    expect(result.interruptions).toBeDefined();
    expect(result.turn_taking).toBeDefined();
    expect(result.voice_adaptation).toBeDefined();
  });

  it("uses defaults when no voiceSpec", () => {
    const ctx = makeContext();
    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());

    expect(result._source).toBe("hardcoded defaults");
    expect(result.response_length.target).toBe("2-3 sentences per turn");
    expect(result.response_length.max_seconds).toBe(15);
  });

  it("uses voiceSpec config when available", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
        voiceSpec: {
          name: "Custom Voice",
          config: {
            response_length: { target: "1-2 sentences", maxSeconds: 10 },
            pacing: { pausesAfterQuestions: "5 seconds" },
          },
          description: null,
        },
      },
    });

    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());

    expect(result._source).toBe("Custom Voice");
    expect(result.response_length.target).toBe("1-2 sentences");
    expect(result.response_length.max_seconds).toBe(10);
    expect(result.pacing.pauses_after_questions).toBe("5 seconds");
  });

  it("adapts pace for introverts (low extraversion)", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        personality: makePersonality({ extraversion: 0.2 }),
      },
    });

    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());
    expect(result.pacing.pace_match).toContain("Slower pace");
  });

  it("adapts pace for extraverts (high extraversion)", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        personality: makePersonality({ extraversion: 0.9 }),
      },
    });

    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());
    expect(result.pacing.pace_match).toContain("Match their energy");
  });

  it("generates voice adaptations for extreme personality traits", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        personality: makePersonality({
          extraversion: 0.1,   // LOW → introvert adaptation
          neuroticism: 0.9,    // HIGH → anxious adaptation
          openness: 0.9,       // HIGH → curious adaptation
          agreeableness: 0.1,  // LOW → direct adaptation
        }),
      },
    });

    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());
    expect(result.voice_adaptation.length).toBe(4);
    expect(result.voice_adaptation.some((a: string) => a.includes("INTROVERT"))).toBe(true);
    expect(result.voice_adaptation.some((a: string) => a.includes("ANXIOUS"))).toBe(true);
    expect(result.voice_adaptation.some((a: string) => a.includes("CURIOUS"))).toBe(true);
    expect(result.voice_adaptation.some((a: string) => a.includes("DIRECT"))).toBe(true);
  });

  it("returns default adaptation when personality is moderate", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        personality: makePersonality(), // all 0.5 = moderate
      },
    });

    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());
    expect(result.voice_adaptation).toEqual(["No special voice adaptations needed"]);
  });

  it("includes natural speech elements", () => {
    const ctx = makeContext();
    const result = getTransform("computeVoiceGuidance")!(null, ctx, makeSectionDef());

    expect(result.natural_speech.use_fillers).toBeInstanceOf(Array);
    expect(result.natural_speech.use_backchannels).toBeInstanceOf(Array);
    expect(result.natural_speech.transitions).toBeInstanceOf(Array);
    expect(result.natural_speech.confirmations).toBeInstanceOf(Array);
  });
});
