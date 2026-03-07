import { describe, it, expect, vi } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Mock the registry before importing quickstart (which imports PARAMS)
vi.mock("@/lib/registry", () => ({
  PARAMS: {
    BEH_WARMTH: "BEH-WARMTH",
    BEH_QUESTION_RATE: "BEH-QUESTION-RATE",
    BEH_RESPONSE_LEN: "BEH-RESPONSE-LEN",
    BEH_TURN_LENGTH: "BEH-TURN-LENGTH",
    BEH_PAUSE_TOLERANCE: "BEH-PAUSE-TOLERANCE",
  },
}));

// Trigger transform registration
import "@/lib/prompt/composition/transforms/quickstart";

// --- helpers ---

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
    resolvedSpecs: { identitySpec: null, contentSpec: null, voiceSpec: null },
    sharedState: {
      modules: [
        { slug: "m1", name: "Introduction" },
        { slug: "m2", name: "Advanced" },
      ],
      isFirstCall: false,
      daysSinceLastCall: 3,
      completedModules: new Set(["m1"]),
      estimatedProgress: 0.5,
      lastCompletedIndex: 0,
      moduleToReview: { slug: "m1", name: "Introduction" },
      nextModule: { slug: "m2", name: "Advanced" },
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "quickstart",
    name: "Quick Start",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeQuickStart",
    outputKey: "_quickStart",
  };
}

// =====================================================
// computeQuickStart transform
// =====================================================

describe("computeQuickStart transform", () => {
  it("is registered", () => {
    expect(getTransform("computeQuickStart")).toBeDefined();
  });

  it("returns complete quickstart structure", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());

    expect(result.you_are).toBeDefined();
    expect(result.this_caller).toBeDefined();
    expect(result.this_session).toBeDefined();
    expect(result.learner_goals).toBeDefined();
    expect(result.voice_style).toBeDefined();
    expect(result.critical_voice).toBeDefined();
    expect(result.first_line).toBeDefined();
  });

  it("includes caller name and call number", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.this_caller).toBe("Paul (call #6)"); // callCount 5 + 1
  });

  it("formats session goal for returning caller with review + new", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.this_session).toContain("Review Introduction");
    expect(result.this_session).toContain("Introduce Advanced");
  });

  it("formats session goal for first call", () => {
    const ctx = makeContext({
      sharedState: {
        ...makeContext().sharedState,
        isFirstCall: true,
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.this_session).toContain("First session");
    expect(result.this_session).toContain("Introduction");
  });

  it("shows curriculum progress", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.curriculum_progress).toContain("1/2 modules mastered");
  });

  it("shows null curriculum_progress when no modules", () => {
    const ctx = makeContext({
      sharedState: {
        ...makeContext().sharedState,
        modules: [],
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.curriculum_progress).toBeNull();
  });

  it("shows starting curriculum when 0 completed", () => {
    const ctx = makeContext({
      sharedState: {
        ...makeContext().sharedState,
        completedModules: new Set(),
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.curriculum_progress).toContain("Starting curriculum");
    expect(result.curriculum_progress).toContain("0/2");
  });

  it("shows learner goals when present", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        goals: [
          { id: "g1", type: "LEARN", name: "Master QM", description: null, status: "ACTIVE", priority: 8, progress: 0.5, playbookId: null, contentSpec: null, playbook: null, startedAt: null },
        ],
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.learner_goals).toContain("Master QM");
    expect(result.learner_goals).toContain("50%");
  });

  it("shows discovery message when no goals", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.learner_goals).toContain("No specific goals");
  });

  it("uses identity spec role statement for you_are", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: {
          name: "QM Tutor",
          config: { roleStatement: "A certified Quality Management tutor" },
          description: null,
        },
        contentSpec: null,
        voiceSpec: null,
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.you_are).toBe("A certified Quality Management tutor");
  });

  it("uses domain-based fallback for generic identity", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1", name: "Paul", email: null, phone: null, externalId: null,
          domain: { id: "d1", slug: "qm", name: "Quality Management", description: null },
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.you_are).toContain("Quality Management");
  });

  it("generates voice_style from targets", () => {
    const ctx = makeContext({
      sections: {
        behaviorTargets: {
          _merged: [
            { parameterId: "BEH-WARMTH", targetValue: 0.8 },
            { parameterId: "BEH-QUESTION-RATE", targetValue: 0.3 },
            { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.5 },
          ],
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.voice_style).toContain("HIGH warmth");
    expect(result.voice_style).toContain("LOW questions");
    expect(result.voice_style).toContain("MODERATE response length");
  });

  it("returns reconnect first_line for returning caller", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.first_line).toContain("reconnect");
  });

  it("returns first-call first_line for new caller", () => {
    const ctx = makeContext({
      sharedState: { ...makeContext().sharedState, isFirstCall: true },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.first_line).toContain("ease into this");
  });

  it("includes cohort_context when caller has a cohort group", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1",
          name: "Alice",
          email: null,
          phone: null,
          externalId: null,
          domain: null,
          cohortGroup: {
            id: "cg-1",
            name: "Year 10 Science",
            owner: { id: "t-1", name: "Mr Smith" },
          },
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.cohort_context).toContain("Year 10 Science");
    expect(result.cohort_context).toContain("Mr Smith");
  });

  it("returns null cohort_context when caller has no cohort", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.cohort_context).toBeNull();
  });

  it("includes course_context from playbook config", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        playbooks: [{
          id: "pb-1",
          name: "Hebrew through the Siddur",
          status: "PUBLISHED",
          domain: null,
          items: [],
          config: {
            subjectDiscipline: "Hebrew",
            courseContext: "This course teaches Hebrew through the Reform Jewish prayer book. The language is a gateway into Judaism — every letter connects to historical, cultural, and religious context.",
          },
        }],
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.course_context).toContain("gateway into Judaism");
    expect(result.course_context).toContain("prayer book");
  });

  it("returns null course_context when not set", () => {
    const ctx = makeContext();
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.course_context).toBeNull();
  });

  it("uses domain onboardingWelcome for first_line on first call", () => {
    const ctx = makeContext({
      sharedState: { ...makeContext().sharedState, isFirstCall: true },
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1", name: "Paul", email: null, phone: null, externalId: null,
          domain: { id: "d1", slug: "demo", name: "Demo", description: null, onboardingWelcome: "Welcome to our learning platform! Let's get started." },
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.first_line).toBe("Welcome to our learning platform! Let's get started.");
  });

  it("ignores onboardingWelcome for returning callers", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1", name: "Paul", email: null, phone: null, externalId: null,
          domain: { id: "d1", slug: "demo", name: "Demo", description: null, onboardingWelcome: "Welcome!" },
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.first_line).toContain("reconnect");
  });

  it("identity spec opening overrides onboardingWelcome", () => {
    const ctx = makeContext({
      sharedState: { ...makeContext().sharedState, isFirstCall: true },
      resolvedSpecs: {
        identitySpec: {
          name: "Custom",
          config: { sessionStructure: { opening: { instruction: "Shalom! I'm your Hebrew tutor." } } },
          description: null,
        },
        contentSpec: null,
        voiceSpec: null,
      },
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1", name: "Paul", email: null, phone: null, externalId: null,
          domain: { id: "d1", slug: "demo", name: "Demo", description: null, onboardingWelcome: "This should NOT appear" },
        },
      },
    });
    const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef());
    expect(result.first_line).toBe("Shalom! I'm your Hebrew tutor.");
  });
});
