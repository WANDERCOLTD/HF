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
      callNumber: 5,
      channel: "voice" as const,
      isFinalSession: false,
      schedulerDecision: null,
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

    // ── Welcome-flow opt-out (issue #205) ─────────────────────────────

    it("filters discovery phase when ALL welcome phases disabled (Playbook flow)", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: false },
                aboutYou: { enabled: false },
                knowledgeCheck: { enabled: false },
              },
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "discovery", duration: "5 min", goals: ["Find name"] },
                  { phase: "first-topic", duration: "5 min", goals: ["Teach"] },
                ],
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase === "discovery")).toBe(false);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("discovery"))).toBe(false);
    });

    it("filters discovery phase when ALL welcome phases disabled (INIT-001 fallback)", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: false },
                aboutYou: { enabled: false },
                knowledgeCheck: { enabled: false },
              },
            },
          }],
          onboardingSpec: {
            id: "init-1",
            slug: "INIT-001",
            name: "Onboarding",
            config: {
              firstCallFlow: {
                phases: [
                  { phase: "welcome", duration: "2 min", priority: "HIGH", goals: ["Greet"], avoid: [] },
                  { phase: "Discovery", duration: "5 min", priority: "HIGH", goals: ["Find name"], avoid: [] }, // capitalised — case-insensitive match
                  { phase: "wrap-up", duration: "2 min", priority: "MEDIUM", goals: ["Summarise"], avoid: [] },
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
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase.toLowerCase() === "discovery")).toBe(false);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("discovery"))).toBe(false);
    });

    it("keeps discovery phase when welcome phases are enabled (regression)", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: true },
                aboutYou: { enabled: true },
                knowledgeCheck: { enabled: true },
              },
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "discovery", duration: "5 min", goals: ["Find name"] },
                ],
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase === "discovery")).toBe(true);
    });

    it("filters \"discover\" phase (no -y) when ALL welcome phases disabled — INIT-001/COACH-001 seed shape", () => {
      // The live INIT-001 + COACH-001 seed JSONs use "discover" (verb), not "discovery".
      // Filter must catch both forms.
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: false },
                aboutYou: { enabled: false },
                knowledgeCheck: { enabled: false },
              },
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "discover", duration: "5 min", goals: ["Find name"] },
                  { phase: "first-topic", duration: "5 min", goals: ["Teach"] },
                ],
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase === "discover")).toBe(false);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("discover"))).toBe(false);
    });

    it("KEEPS \"discover\" phase (no -y) when welcome phases enabled (regression)", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: true },
                aboutYou: { enabled: true },
                knowledgeCheck: { enabled: true },
              },
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "discover", duration: "5 min", goals: ["Find name"] },
                ],
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(2);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase === "discover")).toBe(true);
    });

    it("KEEPS discovery phase on partial opt-out (only aboutYou off)", () => {
      // Coarse-grained block: discovery survives unless ALL three toggles are off.
      // Per-phase guidance in `discovery_guidance` tells the AI what to skip.
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: true },
                aboutYou: { enabled: false },
                knowledgeCheck: { enabled: true },
              },
              onboardingFlowPhases: {
                phases: [
                  { phase: "welcome", duration: "2 min", goals: ["Greet"] },
                  { phase: "discovery", duration: "5 min", goals: ["Find name"] },
                  { phase: "first-topic", duration: "5 min", goals: ["Teach"] },
                ],
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.firstCallPhases).toHaveLength(3);
      expect(result.firstCallPhases!.some((p: { phase: string }) => p.phase === "discovery")).toBe(true);
    });

    // ── Hardcoded-fallback gating (#212) ─────────────────────────────
    // When the cascade resolves nothing (no playbookFlow / domainFlow / initFlow),
    // the transform falls back to a 5-step hardcoded array. Step 2 is the
    // "Probe existing knowledge" step. Pre-#212 this fallback ignored welcome
    // toggles entirely.

    it("hardcoded fallback drops 'Probe existing knowledge' step when ALL welcome phases disabled", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: false },
                aboutYou: { enabled: false },
                knowledgeCheck: { enabled: false },
              },
            },
          }],
          // No onboardingSpec, no domain.onboardingFlowPhases — falls through to hardcoded
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow).toHaveLength(4);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("probe existing knowledge"))).toBe(false);
      expect(result.flow[0]).toContain("Welcome");
      expect(result.flow[1]).toContain("Introduce foundation");
    });

    it("hardcoded fallback KEEPS 'Probe existing knowledge' when welcome phases default-enabled", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [],
          // No welcome config at all → defaults true
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow).toHaveLength(5);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("probe existing knowledge"))).toBe(true);
    });

    it("hardcoded fallback KEEPS 'Probe existing knowledge' on partial opt-out (only goals off)", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: false },
                aboutYou: { enabled: true },
                knowledgeCheck: { enabled: true },
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow).toHaveLength(5);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("probe existing knowledge"))).toBe(true);
    });

    it("hardcoded fallback drops 'Probe' when ONLY Knowledge Check is OFF (probe gated by knowledgeCheck)", () => {
      // The probe step is conceptually a Socratic version of Knowledge Check.
      // Educator turning OFF Knowledge Check should turn off probe too — even
      // if Goals/AboutYou are still ON.
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [{
            id: "pb-1",
            name: "Course",
            status: "PUBLISHED",
            domain: null,
            items: [],
            config: {
              welcome: {
                goals: { enabled: true },
                aboutYou: { enabled: true },
                knowledgeCheck: { enabled: false },
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: true,
        },
      });

      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.flow).toHaveLength(4);
      expect(result.flow.some((s: string) => s.toLowerCase().includes("probe existing knowledge"))).toBe(false);
    });
  });

  describe("SCHEDULER MODE flows", () => {
    function makeSchedulerContext(mode: "teach" | "review" | "assess" | "practice"): AssembledContext {
      return makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: false,
          isFirstCallInDomain: false,
          callNumber: 3,
          schedulerDecision: { mode, outcomeId: "lo-1" },
          lessonPlanEntry: null,
        },
      });
    }

    it("uses TEACH mode with introduce-oriented flow", () => {
      const ctx = makeSchedulerContext("teach");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("TEACH");
      expect(result.flow.length).toBeGreaterThan(0);
      expect(result.flow.some((s: string) => s.includes("Introduce") || s.includes("Preview"))).toBe(true);
      expect(result.lessonPlanSession).toBeDefined();
      expect(result.lessonPlanSession.type).toBe("teach");
    });

    it("uses REVIEW mode with spaced retrieval", () => {
      const ctx = makeSchedulerContext("review");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("REVIEW");
      expect(result.flow.some((s: string) => s.includes("retrieval") || s.includes("recall"))).toBe(true);
    });

    it("uses ASSESS mode — no new material", () => {
      const ctx = makeSchedulerContext("assess");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("ASSESS");
      expect(result.flow.some((s: string) => s.includes("NO new material") || s.includes("Diagnostic"))).toBe(true);
      expect(result.newMaterial).toBeUndefined();
    });

    it("uses PRACTICE mode with synthesis focus", () => {
      const ctx = makeSchedulerContext("practice");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.sessionType).toBe("PRACTICE");
      expect(result.flow.some((s: string) => s.includes("Synthesize") || s.includes("Application"))).toBe(true);
    });

    it("includes lessonPlanSession metadata in output", () => {
      const ctx = makeSchedulerContext("teach");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.lessonPlanSession).toEqual({
        number: 3,
        type: "teach",
        label: "Scheduler: teach",
      });
    });

    it("still includes curriculum pedagogy principles", () => {
      const ctx = makeSchedulerContext("review");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());

      expect(result.principles.some((p: string) => p.includes("Review BEFORE"))).toBe(true);
    });
  });

  describe("postCoverageGuidance", () => {
    const schedulerModes = ["teach", "review", "assess", "practice"] as const;

    function makeSchedulerCtx(mode: string): AssembledContext {
      return makeContext({
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: false,
          isFirstCallInDomain: false,
          callNumber: 3,
          schedulerDecision: { mode: mode as any, outcomeId: "lo-1" },
          lessonPlanEntry: null,
        },
      });
    }

    it.each(schedulerModes)("produces postCoverageGuidance for %s mode", (mode) => {
      const result = getTransform("computeSessionPedagogy")!(null, makeSchedulerCtx(mode), makeSectionDef());
      expect(result.postCoverageGuidance).toBeDefined();
      expect(result.postCoverageGuidance).toContain("IF YOU COVER ALL TEACHING POINTS");
    });

    it("produces postCoverageGuidance for generic returning caller with curriculum", () => {
      const ctx = makeContext(); // has modules, not first call
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.postCoverageGuidance).toContain("IF YOU COVER ALL TEACHING POINTS");
    });

    it("does NOT produce postCoverageGuidance for first calls", () => {
      const ctx = makeContext({
        sharedState: { ...makeContext().sharedState, isFirstCall: true },
      });
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.postCoverageGuidance).toBeUndefined();
    });

    it("does NOT produce postCoverageGuidance for open conversation", () => {
      const ctx = makeContext({
        sharedState: {
          ...makeContext().sharedState,
          modules: [],
          moduleToReview: null,
          nextModule: null,
          isFirstCall: false,
          schedulerDecision: null,
          lessonPlanEntry: null,
        },
        sections: {},
      });
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.postCoverageGuidance).toBeUndefined();
    });

    it("uses spec-driven phases when TUT-001 has postCoverageFlow", () => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          systemSpecs: [{
            slug: "spec-tut-001",
            name: "TUT-001",
            config: {
              session_pedagogy: {
                postCoverageFlow: {
                  phases: [
                    { phase: "custom_signal", action: "Custom signal text" },
                    { phase: "custom_check", condition: "Custom condition", action: "Custom action" },
                  ],
                  principles: ["Custom principle one"],
                },
              },
            },
          }],
        },
        sharedState: {
          ...makeContext().sharedState,
          isFirstCall: false,
          callNumber: 2,
          schedulerDecision: { mode: "teach", outcomeId: "lo-1" },
          lessonPlanEntry: null,
        },
      });
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      expect(result.postCoverageGuidance).toContain("Custom signal text");
      expect(result.postCoverageGuidance).toContain("[Custom condition]");
      expect(result.postCoverageGuidance).toContain("Custom principle one");
    });

    it("uses hardcoded fallback when no TUT-001 spec is loaded", () => {
      const ctx = makeSchedulerCtx("review");
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef());
      // Fallback includes teach-back instruction
      expect(result.postCoverageGuidance).toContain("Teach-back");
      expect(result.postCoverageGuidance).toContain("Confidence check");
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
          schedulerDecision: null,
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
