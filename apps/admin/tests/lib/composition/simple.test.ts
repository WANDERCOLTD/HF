import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef, RecentCallData, CallerAttributeData, GoalData } from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/simple";

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
      callNumber: 1,
      channel: "voice" as const,
      isFinalSession: false,
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "test",
    name: "Test",
    priority: 5,
    dataSource: "test",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: null,
    outputKey: "test",
  };
}

// =====================================================
// computeCallHistory
// =====================================================

describe("computeCallHistory transform", () => {
  it("is registered", () => {
    expect(getTransform("computeCallHistory")).toBeDefined();
  });

  it("returns empty history when no calls", () => {
    const ctx = makeContext();
    const rawData = { recentCalls: [], callCount: 0 };
    const result = getTransform("computeCallHistory")!(rawData, ctx, makeSectionDef());

    expect(result.totalCalls).toBe(0);
    expect(result.mostRecent).toBeNull();
    expect(result.recent).toEqual([]);
  });

  it("maps recent calls with scores and levels", () => {
    const calls: RecentCallData[] = [
      {
        id: "call-1",
        transcript: null,
        createdAt: new Date("2026-02-10"),
        scores: [
          { parameterId: "P1", score: 0.8, parameter: { name: "warmth" } },
          { parameterId: "P2", score: 0.3, parameter: { name: "directness" } },
        ],
      },
    ];

    const ctx = makeContext();
    const rawData = { recentCalls: calls, callCount: 5 };
    const result = getTransform("computeCallHistory")!(rawData, ctx, makeSectionDef());

    expect(result.totalCalls).toBe(5);
    expect(result.mostRecent.callId).toBe("call-1");
    expect(result.mostRecent.date).toBe("2026-02-10");
    expect(result.mostRecent.scores).toHaveLength(2);
    expect(result.mostRecent.scores[0].level).toBe("HIGH");
    expect(result.mostRecent.scores[1].level).toBe("LOW");
  });

  it("limits recent to 3 calls", () => {
    const calls: RecentCallData[] = Array.from({ length: 5 }, (_, i) => ({
      id: `call-${i}`,
      transcript: null,
      createdAt: new Date(`2026-02-${10 - i}`),
      scores: [],
    }));

    const ctx = makeContext();
    const result = getTransform("computeCallHistory")!({ recentCalls: calls, callCount: 10 }, ctx, makeSectionDef());
    expect(result.recent).toHaveLength(3);
  });
});

// =====================================================
// filterSessionAttributes
// =====================================================

describe("filterSessionAttributes transform", () => {
  it("is registered", () => {
    expect(getTransform("filterSessionAttributes")).toBeDefined();
  });

  it("returns empty when no attributes", () => {
    const ctx = makeContext();
    const result = getTransform("filterSessionAttributes")!([], ctx, makeSectionDef());
    expect(result.hasData).toBe(false);
    expect(result.context).toEqual([]);
  });

  it("filters only session-related attributes", () => {
    const attrs: CallerAttributeData[] = [
      { key: "session_count", scope: "GLOBAL", domain: null, valueType: "NUMBER", stringValue: null, numberValue: 5, booleanValue: null, jsonValue: null, confidence: 0.9, sourceSpecSlug: null },
      { key: "arc_position", scope: "GLOBAL", domain: null, valueType: "STRING", stringValue: "rising", numberValue: null, booleanValue: null, jsonValue: null, confidence: 0.8, sourceSpecSlug: null },
      { key: "unrelated_key", scope: "GLOBAL", domain: null, valueType: "STRING", stringValue: "hello", numberValue: null, booleanValue: null, jsonValue: null, confidence: 0.5, sourceSpecSlug: null },
    ];

    const ctx = makeContext();
    const result = getTransform("filterSessionAttributes")!(attrs, ctx, makeSectionDef());
    expect(result.hasData).toBe(true);
    expect(result.context).toHaveLength(2);
  });

  it("includes attributes from SESSION spec slugs", () => {
    const attrs: CallerAttributeData[] = [
      { key: "custom_key", scope: "GLOBAL", domain: null, valueType: "STRING", stringValue: "val", numberValue: null, booleanValue: null, jsonValue: null, confidence: 0.9, sourceSpecSlug: "SESSION-FLOW-001" },
    ];

    const ctx = makeContext();
    const result = getTransform("filterSessionAttributes")!(attrs, ctx, makeSectionDef());
    expect(result.hasData).toBe(true);
    expect(result.context).toHaveLength(1);
  });
});

// =====================================================
// mapGoals
// =====================================================

describe("mapGoals transform", () => {
  it("is registered", () => {
    expect(getTransform("mapGoals")).toBeDefined();
  });

  it("returns empty when no goals", () => {
    const ctx = makeContext();
    const result = getTransform("mapGoals")!([], ctx, makeSectionDef());
    expect(result.hasData).toBe(false);
    expect(result.goals).toEqual([]);
  });

  it("maps goals with progress and playbook flag", () => {
    const goals: GoalData[] = [
      { id: "g1", type: "LEARN", name: "Master QM", description: "Learn quality management", status: "ACTIVE", priority: 8, progress: 0.5, playbookId: "pb-1", playbook: { id: "pb-1", name: "QM Playbook" }, startedAt: new Date(), isAssessmentTarget: false, assessmentConfig: null, contentSpec: null },
      { id: "g2", type: "ACHIEVE", name: "Pass exam", description: null, status: "ACTIVE", priority: 5, progress: 0, playbookId: null, playbook: null, startedAt: null, isAssessmentTarget: false, assessmentConfig: null, contentSpec: null },
    ];

    const ctx = makeContext();
    const result = getTransform("mapGoals")!(goals, ctx, makeSectionDef());
    expect(result.hasData).toBe(true);
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0].isPlaybookGoal).toBe(true);
    expect(result.goals[1].isPlaybookGoal).toBe(false);
    expect(result.goals[0].progress).toBe(0.5);
  });
});

// =====================================================
// computeDomainContext
// =====================================================

describe("computeDomainContext transform", () => {
  it("is registered", () => {
    expect(getTransform("computeDomainContext")).toBeDefined();
  });

  it("returns null when no caller domain", () => {
    const ctx = makeContext();
    const result = getTransform("computeDomainContext")!({ callerDomain: null, callerAttributes: [] }, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns domain context with filtered attributes", () => {
    const domain = { id: "d1", name: "Quality Management", description: "QM domain" };
    const attrs: CallerAttributeData[] = [
      { key: "qm_level", scope: "DOMAIN", domain: "Quality Management", valueType: "STRING", stringValue: "intermediate", numberValue: null, booleanValue: null, jsonValue: null, confidence: 0.8, sourceSpecSlug: null },
      { key: "other", scope: "GLOBAL", domain: null, valueType: "STRING", stringValue: "ignored", numberValue: null, booleanValue: null, jsonValue: null, confidence: 0.5, sourceSpecSlug: null },
    ];

    const ctx = makeContext();
    const result = getTransform("computeDomainContext")!({ callerDomain: domain, callerAttributes: attrs }, ctx, makeSectionDef());

    expect(result.name).toBe("Quality Management");
    expect(result.description).toBe("QM domain");
    expect(result.domainSpecificData).toHaveLength(1);
    expect(result.domainSpecificData[0].key).toBe("qm_level");
    expect(result.domainSpecificData[0].value).toBe("intermediate");
  });
});

// =====================================================
// mapLearnerProfile
// =====================================================

describe("mapLearnerProfile transform", () => {
  it("is registered", () => {
    expect(getTransform("mapLearnerProfile")).toBeDefined();
  });

  it("returns null for null input", () => {
    const ctx = makeContext();
    const result = getTransform("mapLearnerProfile")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns null when profile has no data", () => {
    const ctx = makeContext();
    const emptyProfile = {
      learningStyle: null,
      pacePreference: null,
      interactionStyle: null,
      priorKnowledge: {},
      preferredModality: null,
      questionFrequency: null,
      feedbackStyle: null,
      sessionLength: null,
      lastUpdated: null,
    };
    const result = getTransform("mapLearnerProfile")!(emptyProfile, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns profile when it has data", () => {
    const ctx = makeContext();
    const profile = {
      learningStyle: "visual",
      pacePreference: "moderate",
      interactionStyle: null,
      priorKnowledge: { "math": "intermediate" },
      preferredModality: null,
      questionFrequency: null,
      feedbackStyle: null,
      sessionLength: null,
      lastUpdated: "2026-02-01",
    };

    const result = getTransform("mapLearnerProfile")!(profile, ctx, makeSectionDef());
    expect(result).not.toBeNull();
    expect(result.learningStyle).toBe("visual");
    expect(result.pacePreference).toBe("moderate");
    expect(result.priorKnowledge).toEqual({ math: "intermediate" });
  });
});
