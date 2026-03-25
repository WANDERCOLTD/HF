import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/activities";

// --- helpers ---

const ACTIVITY_SPEC_CONFIG = {
  activity_catalog: {
    activities: [
      {
        id: "pop_quiz",
        name: "Pop Quiz",
        channel: "voice",
        category: "assessment",
        description: "Quick question to check retention",
        format: { steps: ["Ask question", "Wait for answer", "Give feedback"], duration: "1-2 min" },
        triggers: { when: ["After teaching"], avoid_when: ["Caller frustrated"] },
        personality_adaptations: {
          low_extraversion: "Frame gently",
          high_openness: "Make creative",
        },
      },
      {
        id: "scenario",
        name: "Scenario",
        channel: "voice",
        category: "application",
        description: "Present a realistic scenario",
        format: { steps: ["Paint scenario", "Ask what would you do", "Discuss"], duration: "3-5 min" },
        triggers: { when: ["After recall confirmed"], avoid_when: ["Struggling with basics"] },
        personality_adaptations: {
          high_openness: "Make creative",
          low_openness: "Keep concrete",
        },
      },
      {
        id: "mcq_text",
        name: "MCQ (Text)",
        channel: "text",
        category: "assessment",
        description: "Send MCQ via text",
        format: { steps: ["Tell caller", "Send text", "Discuss"], duration: "2-3 min", text_template: "Q: {question}\nA) {a}\nB) {b}" },
        triggers: { when: ["Complex options"], avoid_when: ["No phone"] },
        personality_adaptations: {
          high_conscientiousness: "Great fit",
        },
      },
      {
        id: "teach_back",
        name: "Teach It Back",
        channel: "voice",
        category: "deep_learning",
        description: "Ask caller to explain concept",
        format: { steps: ["Frame it", "Listen", "Fill gaps"], duration: "3-5 min" },
        triggers: { when: ["Before moving on"], avoid_when: ["Just introduced"] },
        personality_adaptations: {
          high_extraversion: "Let them run with it",
        },
      },
    ],
  },
  selection_strategy: {
    principles: ["Activities serve learning"],
    session_phase_recommendations: {
      spaced_retrieval: ["pop_quiz"],
      integrate: ["teach_back", "scenario"],
      new_material: ["scenario"],
    },
    mastery_level_recommendations: {
      novice: ["pop_quiz"],
      developing: ["scenario", "pop_quiz"],
      proficient: ["teach_back", "scenario"],
      mastered: ["teach_back"],
    },
    max_activities_per_session: 2,
    max_text_messages_per_week: 2,
    min_minutes_between_activities: 5,
  },
};

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 3,
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
      modules: [
        { slug: "m1", name: "Module 1" },
        { slug: "m2", name: "Module 2" },
        { slug: "m3", name: "Module 3" },
      ],
      isFirstCall: false,
      daysSinceLastCall: 3,
      completedModules: new Set(["m1"]),
      estimatedProgress: 0.33,
      lastCompletedIndex: 0,
      moduleToReview: { slug: "m1", name: "Module 1" },
      nextModule: { slug: "m2", name: "Module 2" },
      reviewType: "application",
      reviewReason: "3 days since last touch",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "activity_toolkit",
    name: "Activity Toolkit",
    priority: 12.8,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "emptyObject" },
    transform: "computeActivityToolkit",
    outputKey: "activityToolkit",
  };
}

// =====================================================
// computeActivityToolkit
// =====================================================

describe("computeActivityToolkit transform", () => {
  it("is registered", () => {
    expect(getTransform("computeActivityToolkit")).toBeDefined();
  });

  it("returns hasActivities=false when no ACTIVITY spec found", () => {
    const ctx = makeContext();
    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.hasActivities).toBe(false);
    expect(result.recommended).toEqual([]);
  });

  it("returns hasActivities=true with recommendations when spec exists", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: ACTIVITY_SPEC_CONFIG,
            domain: "pedagogy",
          },
        ],
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.hasActivities).toBe(true);
    expect(result.recommended.length).toBeGreaterThan(0);
    expect(result.recommended.length).toBeLessThanOrEqual(2);
    expect(result.all_available).toHaveLength(4);
  });

  it("recommends voice activities for first call, penalizes assessment", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: ACTIVITY_SPEC_CONFIG,
            domain: "pedagogy",
          },
        ],
      },
      sharedState: {
        ...makeContext().sharedState,
        isFirstCall: true,
        completedModules: new Set(),
        estimatedProgress: 0,
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    // Assessment activities (pop_quiz) should be penalized on first call
    const recommended = result.recommended;
    if (recommended.length > 0) {
      // Scenario (application category) should be preferred over pop_quiz on first call
      const ids = recommended.map((r: any) => r.id);
      expect(ids).not.toContain("pop_quiz"); // penalized for first call
    }
  });

  it("applies personality adaptations to recommendations", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: ACTIVITY_SPEC_CONFIG,
            domain: "pedagogy",
          },
        ],
      },
      sections: {
        personality: {
          traits: {
            openness: { level: "HIGH", score: 0.85 },
            extraversion: { level: "LOW", score: 0.2 },
          },
        },
        instructions_pedagogy: {
          sessionType: "RETURNING_CALLER",
        },
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    // Activities with high_openness or low_extraversion adaptations should have them included
    for (const rec of result.recommended) {
      if (rec.id === "pop_quiz") {
        expect(rec.adaptations).toContain("Frame gently");
        expect(rec.adaptations).toContain("Make creative");
      }
    }
  });

  it("includes context signals in output", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: ACTIVITY_SPEC_CONFIG,
            domain: "pedagogy",
          },
        ],
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.context_signals).toBeDefined();
    expect(result.context_signals.is_first_call).toBe(false);
    expect(result.context_signals.days_since_last_call).toBe(3);
    expect(result.context_signals.mastery_level).toBe("developing");
  });

  it("includes limits from strategy", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: ACTIVITY_SPEC_CONFIG,
            domain: "pedagogy",
          },
        ],
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.limits.max_per_session).toBe(2);
    expect(result.limits.min_minutes_apart).toBe(5);
  });

  it("includes text_template for text-channel activities", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: {
              ...ACTIVITY_SPEC_CONFIG,
              selection_strategy: {
                ...ACTIVITY_SPEC_CONFIG.selection_strategy,
                // Force MCQ to be recommended by adding it to all phases
                session_phase_recommendations: {
                  spaced_retrieval: ["mcq_text", "pop_quiz"],
                },
                mastery_level_recommendations: {
                  developing: ["mcq_text"],
                },
              },
            },
            domain: "pedagogy",
          },
        ],
      },
      sections: {
        personality: {
          traits: {
            conscientiousness: { level: "HIGH", score: 0.8 },
          },
        },
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());
    const textActivity = result.recommended.find((r: any) => r.channel === "text");
    if (textActivity) {
      expect(textActivity.text_template).toBeDefined();
    }
  });

  it("respects max_activities_per_session limit", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "COMPOSE",
            config: {
              ...ACTIVITY_SPEC_CONFIG,
              selection_strategy: {
                ...ACTIVITY_SPEC_CONFIG.selection_strategy,
                max_activities_per_session: 1,
              },
            },
            domain: "pedagogy",
          },
        ],
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.recommended.length).toBeLessThanOrEqual(1);
  });

  it("works with flattened config shape (as stored in DB after seeding)", () => {
    // After seed-from-specs, ORCHESTRATE configs are flattened:
    // parameter configs are spread onto the root config object
    const flattenedConfig = {
      parameters: [
        { id: "activity_catalog", config: ACTIVITY_SPEC_CONFIG.activity_catalog },
        { id: "selection_strategy", config: ACTIVITY_SPEC_CONFIG.selection_strategy },
      ],
      // Flattened from activity_catalog.config:
      ...ACTIVITY_SPEC_CONFIG.activity_catalog,
      // Flattened from selection_strategy.config:
      ...ACTIVITY_SPEC_CONFIG.selection_strategy,
    };

    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        systemSpecs: [
          {
            id: "spec-1",
            slug: "ACTIVITY-001",
            name: "Interaction Activities",
            description: null,
            specRole: "ORCHESTRATE",
            outputType: "MEASURE",
            config: flattenedConfig,
            domain: "pedagogy",
          },
        ],
      },
    });

    const result = getTransform("computeActivityToolkit")!(null, ctx, makeSectionDef());

    expect(result.hasActivities).toBe(true);
    expect(result.recommended.length).toBeGreaterThan(0);
    // Strategy should be picked up from flattened root keys
    expect(result.limits.max_per_session).toBe(2);
    expect(result.limits.min_minutes_apart).toBe(5);
    expect(result.principles).toContain("Activities serve learning");
  });
});
