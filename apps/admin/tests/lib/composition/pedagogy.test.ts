import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/pedagogy";

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
      onboardingSession: null,
      subjectSources: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [
        { slug: "m1", name: "Introduction", description: "First module" },
        { slug: "m2", name: "Advanced", description: "Second module" },
      ],
      isFirstCall: false,
      isFirstCallInDomain: false,
      daysSinceLastCall: 3,
      completedModules: new Set(["m1"]),
      estimatedProgress: 0.5,
      lastCompletedIndex: 0,
      moduleToReview: { slug: "m1", name: "Introduction" },
      nextModule: { slug: "m2", name: "Advanced" },
      reviewType: "quick_recall",
      reviewReason: "Last session covered Introduction",
      thresholds: { high: 0.65, low: 0.35 },
      currentSessionNumber: null,
      lessonPlanSessionType: null,
      lessonPlanEntry: null,
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "pedagogy",
    name: "Session Pedagogy",
    priority: 3,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeSessionPedagogy",
    outputKey: "instructions.session_pedagogy",
  };
}

// =====================================================
// computeSessionPedagogy transform
// =====================================================

describe("computeSessionPedagogy transform", () => {
  it("is registered", () => {
    expect(getTransform("computeSessionPedagogy")).toBeDefined();
  });

  describe("RETURNING_CALLER flow", () => {
    it("sets sessionType to RETURNING_CALLER", () => {
      const ctx = makeContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.sessionType).toBe("RETURNING_CALLER");
    });

    it("includes review step referencing the module to review", () => {
      const ctx = makeContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      const flowText = result.flow.join(" ");
      expect(flowText).toContain("Introduction");
      expect(flowText).toContain("Advanced");
    });

    it("includes reviewFirst with technique for quick_recall", () => {
      const ctx = makeContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.reviewFirst).toBeDefined();
      expect(result.reviewFirst.module).toBe("Introduction");
      expect(result.reviewFirst.technique).toContain("recall question");
    });

    it("uses application technique for application review type", () => {
      const ctx = makeContext({
        sharedState: {
          ...makeContext().sharedState,
          reviewType: "application",
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.reviewFirst.technique).toContain("scenario");
    });

    it("includes newMaterial section with approach", () => {
      const ctx = makeContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.newMaterial).toBeDefined();
      expect(result.newMaterial.module).toBe("Advanced");
      expect(result.newMaterial.approach).toContain("Introduction");
    });

    it("includes universal pedagogy principles", () => {
      const ctx = makeContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.principles.length).toBeGreaterThan(0);
      expect(result.principles.some((p: string) => p.includes("Review BEFORE"))).toBe(true);
    });
  });

  describe("FIRST_CALL flow", () => {
    it("sets sessionType to FIRST_CALL", () => {
      const ctx = makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.sessionType).toBe("FIRST_CALL");
    });

    it("uses default first-call flow when no INIT-001 spec", () => {
      const ctx = makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow.length).toBe(5);
      expect(result.flow[0]).toContain("Welcome");
    });

    it("uses INIT-001 phases when available", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          onboardingSpec: {
            id: "init-1",
            slug: "INIT-001",
            name: "Onboarding",
            config: {
              firstCallFlow: {
                phases: [
                  { phase: "warm-up", duration: "2 min", priority: "HIGH", goals: ["Build rapport"], avoid: ["rushing"] },
                  { phase: "explore", duration: "5 min", priority: "MEDIUM", goals: ["Find knowledge level"], avoid: ["lecturing"] },
                ],
                successMetrics: ["Caller feels comfortable"],
              },
            },
          },
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases![0].phase).toBe("warm-up");
      expect(result.successMetrics).toContain("Caller feels comfortable");
      expect(result.flow[0]).toContain("Warm-up");
    });

    it("uses Domain onboarding flow over INIT-001 when available", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          caller: {
            id: "c1", name: "Paul", email: null, phone: null, externalId: null,
            domain: {
              id: "d1", slug: "qm", name: "QM", description: null,
              onboardingFlowPhases: {
                phases: [
                  { phase: "domain-intro", duration: "3 min", priority: "HIGH", goals: ["Intro to QM"], avoid: [] },
                ],
                successMetrics: ["Domain confidence"],
              },
            },
          },
          onboardingSpec: {
            id: "init-1",
            slug: "INIT-001",
            name: "Onboarding",
            config: {
              firstCallFlow: {
                phases: [{ phase: "generic", duration: "2 min", priority: "LOW", goals: ["Generic"], avoid: [] }],
              },
            },
          },
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases![0].phase).toBe("domain-intro");
    });

    it("includes newMaterial for first module on first call", () => {
      const ctx = makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.newMaterial).toBeDefined();
      expect(result.newMaterial.module).toBe("Introduction");
    });

    it("includes content references in flow steps when phases have content", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          caller: {
            id: "c1", name: "Paul", email: null, phone: null, externalId: null,
            domain: {
              id: "d1", slug: "hist", name: "History", description: null,
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "first-topic", duration: "5 min", goals: ["Teach topic"], content: [
                    { mediaId: "media-1", instruction: "Share the passage at start" },
                  ]},
                ],
              },
            },
          },
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow[0]).not.toContain("[Content:");
      expect(result.flow[1]).toContain("[Content: Share the passage at start]");
    });

    it("omits content annotation for phases without content", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          caller: {
            id: "c1", name: "Paul", email: null, phone: null, externalId: null,
            domain: {
              id: "d1", slug: "hist", name: "History", description: null,
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "wrap-up", duration: "2 min", goals: ["Summarise"] },
                ],
              },
            },
          },
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      result.flow.forEach((step: string) => {
        expect(step).not.toContain("[Content:");
      });
    });
  });

  describe("LESSON PLAN session-type flows", () => {
    function makeLessonPlanContext(sessionType: string, moduleLabel: string = "Module A"): AssembledContext {
      return makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: false,
          isFirstCallInDomain: false,
          lessonPlanSessionType: sessionType,
          currentSessionNumber: 3,
          lessonPlanEntry: {
            session: 3,
            type: sessionType,
            moduleId: sessionType === "review" || sessionType === "assess" || sessionType === "consolidate" ? null : "MOD-1",
            moduleLabel,
            label: `${sessionType} session`,
          },
        },
      });
    }

    it("uses INTRODUCE session type with preview-oriented flow", () => {
      const ctx = makeLessonPlanContext("introduce", "Hazards");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("INTRODUCE");
      expect(result.flow.some((s: string) => s.includes("Hazards"))).toBe(true);
      expect(result.newMaterial).toBeDefined();
      expect(result.newMaterial.module).toBe("Hazards");
      expect(result.lessonPlanSession).toBeDefined();
      expect(result.lessonPlanSession.type).toBe("introduce");
    });

    it("uses DEEPEN session type with practice-oriented flow", () => {
      const ctx = makeLessonPlanContext("deepen", "Temperature Control");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("DEEPEN");
      expect(result.flow.some((s: string) => s.includes("edge cases") || s.includes("Deepen"))).toBe(true);
      expect(result.newMaterial).toBeDefined();
      expect(result.newMaterial.approach).toContain("Temperature Control");
    });

    it("uses REVIEW session type with spaced retrieval", () => {
      const ctx = makeLessonPlanContext("review");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("REVIEW");
      expect(result.flow.some((s: string) => s.includes("retrieval") || s.includes("recall"))).toBe(true);
    });

    it("uses ASSESS session type — no new material", () => {
      const ctx = makeLessonPlanContext("assess");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("ASSESS");
      expect(result.flow.some((s: string) => s.includes("NO new material") || s.includes("Diagnostic"))).toBe(true);
      expect(result.newMaterial).toBeUndefined();
    });

    it("uses CONSOLIDATE session type with synthesis focus", () => {
      const ctx = makeLessonPlanContext("consolidate");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("CONSOLIDATE");
      expect(result.flow.some((s: string) => s.includes("Synthesize") || s.includes("Big picture"))).toBe(true);
    });

    it("includes lessonPlanSession metadata in output", () => {
      const ctx = makeLessonPlanContext("introduce", "Hazards");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.lessonPlanSession).toEqual({
        number: 3,
        type: "introduce",
        label: "introduce session",
      });
    });

    it("falls back to generic flow for unknown session type", () => {
      const ctx = makeLessonPlanContext("mystery-type");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("MYSTERY-TYPE");
      expect(result.flow.length).toBeGreaterThan(0);
    });

    it("still includes curriculum pedagogy principles", () => {
      const ctx = makeLessonPlanContext("deepen");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.principles.some((p: string) => p.includes("Review BEFORE"))).toBe(true);
    });
  });

  describe("NO CURRICULUM flow (anti-hallucination)", () => {
    function makeNoCurriculumContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
      return makeContext({
        sharedState: {
          ...makeContext().sharedState,
          modules: [],
          moduleToReview: null,
          nextModule: null,
          isFirstCall: false,
          isFirstCallInDomain: false,
          lessonPlanSessionType: null,
          lessonPlanEntry: null,
        },
        sections: {},
        ...overrides,
      });
    }

    it("uses OPEN_CONVERSATION session type when no curriculum", () => {
      const ctx = makeNoCurriculumContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("OPEN_CONVERSATION");
    });

    it("includes anti-hallucination principle instead of review-based principles", () => {
      const ctx = makeNoCurriculumContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.principles.some((p: string) => p.includes("Do NOT invent"))).toBe(true);
      expect(result.principles.some((p: string) => p.includes("Review BEFORE"))).toBe(false);
    });

    it("does not include reviewFirst or newMaterial", () => {
      const ctx = makeNoCurriculumContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.reviewFirst).toBeUndefined();
      expect(result.newMaterial).toBeUndefined();
    });

    it("uses curriculum flow when modules exist (unchanged)", () => {
      const ctx = makeContext(); // has modules by default
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("RETURNING_CALLER");
      expect(result.principles.some((p: string) => p.includes("Review BEFORE"))).toBe(true);
    });

    it("uses curriculum flow when teachingContent is present even without modules", () => {
      const ctx = makeNoCurriculumContext({
        sections: { teachingContent: { hasTeachingContent: true } },
      });
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      // With teaching content but no modules, falls into curriculum branch
      expect(result.sessionType).toBe("RETURNING_CALLER");
    });
  });
});
