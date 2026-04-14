/**
 * Tests for modules.ts transforms
 *
 * Verifies:
 * - computeSharedState() extracts modules from Subject curriculum fallback
 * - Module extraction from CONTENT spec parameters (contract-driven)
 * - Review schedule thresholds from specConfig (not hardcoded)
 * - Progress tracking from CallerAttributes
 * - Module ordering and sequencing
 */
import { describe, it, expect } from "vitest";
import {
  computeSharedState,
  findCurriculumInfo,
  resolveLessonPlanMode,
} from "@/lib/prompt/composition/transforms/modules";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  LoadedDataContext,
  ResolvedSpecs,
  SharedComputedState,
  ModuleData,
  CallerAttributeData,
} from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/modules";

// =====================================================
// HELPERS
// =====================================================

function makeLoadedData(overrides: Partial<LoadedDataContext> = {}): LoadedDataContext {
  return {
    caller: { id: "caller-1", name: "Test", email: null, phone: null, externalId: null, domain: null },
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
    subjectSources: null,
    onboardingSession: null,
    ...overrides,
  };
}

function makeResolvedSpecs(overrides: Partial<ResolvedSpecs> = {}): ResolvedSpecs {
  return {
    identitySpec: null,
    voiceSpec: null,
    ...overrides,
  };
}

function makeCallerAttribute(overrides: Partial<CallerAttributeData> = {}): CallerAttributeData {
  return {
    key: "test_key",
    scope: "CURRICULUM",
    domain: null,
    valueType: "NUMBER",
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue: null,
    confidence: 0.8,
    sourceSpecSlug: null,
    ...overrides,
  };
}

// =====================================================
// TESTS
// =====================================================

describe("computeSharedState", () => {
  describe("no modules available", () => {
    it("returns empty modules when no content spec and no subject curriculum", async () => {
      const data = makeLoadedData();
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.modules).toHaveLength(0);
      expect(result.nextModule).toBeNull();
      expect(result.moduleToReview).toBeNull();
    });

    it("detects first call correctly", async () => {
      const data = makeLoadedData({ recentCalls: [] });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.isFirstCall).toBe(true);
    });

    it("detects non-first call", async () => {
      const data = makeLoadedData({
        recentCalls: [{ id: "call-1", transcript: "hello", createdAt: new Date(), scores: [] }],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.isFirstCall).toBe(false);
    });
  });

  describe("Subject curriculum fallback", () => {
    const subjectSources = {
      subjects: [
        {
          id: "subj-1",
          slug: "food-safety",
          name: "Food Safety",
          defaultTrustLevel: "ACCREDITED_MATERIAL",
          qualificationRef: "L2-FS",
          sources: [],
          curriculum: {
            id: "curr-1",
            slug: "CURR-FS-L2-001",
            name: "Level 2 Food Safety",
            description: "Full curriculum",
            notableInfo: {
              modules: [
                {
                  id: "MOD-1",
                  title: "Introduction to Food Safety",
                  description: "Basics",
                  sortOrder: 0,
                  learningOutcomes: ["LO1: Explain why food safety matters"],
                  assessmentCriteria: ["AC1.1: Define food safety"],
                  keyTerms: ["hazard", "risk"],
                },
                {
                  id: "MOD-2",
                  title: "Food Safety Hazards",
                  description: "Types of hazards",
                  sortOrder: 1,
                  learningOutcomes: ["LO2: Identify hazard types"],
                },
                {
                  id: "MOD-3",
                  title: "Temperature Control",
                  description: "Danger zone",
                  sortOrder: 2,
                  learningOutcomes: ["LO3: Explain temperature control"],
                },
              ],
            },
            deliveryConfig: null,
            trustLevel: "ACCREDITED_MATERIAL",
            qualificationBody: "RSPH",
            qualificationNumber: "L2-FS-001",
            qualificationLevel: "2",
          },
        },
      ],
    };

    it("extracts modules from Subject curriculum when no content spec", async () => {
      const data = makeLoadedData({ subjectSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.modules).toHaveLength(3);
      expect(result.modules[0].id).toBe("MOD-1");
      expect(result.modules[0].name).toBe("Introduction to Food Safety");
      expect(result.modules[1].id).toBe("MOD-2");
      expect(result.modules[2].id).toBe("MOD-3");
    });

    it("preserves learningOutcomes from subject modules", async () => {
      const data = makeLoadedData({ subjectSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.modules[0].learningOutcomes).toContain("LO1: Explain why food safety matters");
      expect(result.modules[1].learningOutcomes).toContain("LO2: Identify hazard types");
    });

    it("sets curriculumSpecSlug from curriculum slug", async () => {
      const data = makeLoadedData({ subjectSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.curriculumSpecSlug).toBe("CURR-FS-L2-001");
    });

    it("sets default metadata for Subject curriculum", async () => {
      const data = makeLoadedData({ subjectSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.curriculumMetadata).toBeDefined();
      expect(result.curriculumMetadata!.type).toBe("sequential");
      expect(result.curriculumMetadata!.trackingMode).toBe("module-based");
    });

    it("identifies next module when no progress", async () => {
      const data = makeLoadedData({ subjectSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // With no calls/mastery, MOD-1 is moduleToReview (index 0) and nextModule is MOD-2 (index 1)
      expect(result.moduleToReview).toBeDefined();
      expect(result.moduleToReview!.id).toBe("MOD-1");
      expect(result.nextModule).toBeDefined();
      expect(result.nextModule!.id).toBe("MOD-2");
    });

    it("skips subjects with no curriculum", async () => {
      const noModulesSources = {
        subjects: [
          {
            ...subjectSources.subjects[0],
            curriculum: null,
          },
        ],
      };
      const data = makeLoadedData({ subjectSources: noModulesSources });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.modules).toHaveLength(0);
    });
  });

  // CONTENT spec modules tests removed — content spec fallback removed (ADR-002)
  // Modules now come exclusively from CurriculumModule DB records or subject fallback.

  describe("progress tracking from CallerAttributes", () => {
    const subjectSources = {
      subjects: [{
        id: "s-1", slug: "food-safety", name: "Food Safety",
        defaultTrustLevel: "ACCREDITED_MATERIAL", qualificationRef: null, sources: [],
        curriculum: {
          id: "c-1", slug: "CURR-FS", name: "FS Curriculum", description: null,
          notableInfo: {
            modules: [
              { id: "MOD-1", title: "Module 1", sortOrder: 0 },
              { id: "MOD-2", title: "Module 2", sortOrder: 1 },
              { id: "MOD-3", title: "Module 3", sortOrder: 2 },
            ],
          },
          deliveryConfig: null, trustLevel: "L4", qualificationBody: null,
          qualificationNumber: null, qualificationLevel: null,
        },
      }],
    };

    it("detects completed modules from mastery attributes", async () => {
      const data = makeLoadedData({
        subjectSources,
        callerAttributes: [
          makeCallerAttribute({ key: "mastery_MOD-1", numberValue: 0.85, valueType: "NUMBER" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.completedModules.has("MOD-1")).toBe(true);
      expect(result.completedModules.size).toBe(1);
    });

    it("detects completed modules from boolean completed_ attributes", async () => {
      const data = makeLoadedData({
        subjectSources,
        callerAttributes: [
          makeCallerAttribute({ key: "completed_MOD-1", booleanValue: true, valueType: "BOOLEAN" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.completedModules.has("MOD-1")).toBe(true);
    });

    it("advances nextModule past completed ones", async () => {
      const data = makeLoadedData({
        subjectSources,
        callerAttributes: [
          makeCallerAttribute({ key: "mastery_MOD-1", numberValue: 0.9, valueType: "NUMBER" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // MOD-1 completed, so next should be MOD-2
      expect(result.nextModule).toBeDefined();
      expect(result.nextModule!.id).toBe("MOD-2");
    });
  });

  describe("review schedule (from specConfig, not hardcoded)", () => {
    it("uses default review schedule when not in specConfig", async () => {
      const data = makeLoadedData({
        recentCalls: [{
          id: "call-1",
          transcript: "test",
          createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
          scores: [],
        }],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // 15 days >= default 14-day reintroduce threshold
      expect(result.reviewType).toBe("reintroduce");
    });

    it("uses custom review schedule from specConfig", async () => {
      const data = makeLoadedData({
        recentCalls: [{
          id: "call-1",
          transcript: "test",
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          scores: [],
        }],
      });
      const specs = makeResolvedSpecs();
      // Custom schedule: reintroduce at 20 days, deep review at 10, application at 5
      const result = await computeSharedState(data, specs, {
        reviewSchedule: { reintroduce: 20, deepReview: 10, application: 5 },
      });

      // 10 days >= custom 10-day deepReview threshold (but < 20 reintroduce)
      expect(result.reviewType).toBe("deep_review");
    });

    it("returns quick_recall when gap is short", async () => {
      const data = makeLoadedData({
        recentCalls: [{
          id: "call-1",
          transcript: "test",
          createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
          scores: [],
        }],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.reviewType).toBe("quick_recall");
    });
  });

  describe("lesson plan session tracking", () => {
    const subjectSourcesWithPlan = {
      subjects: [{
        id: "s-1", slug: "food-safety", name: "Food Safety",
        defaultTrustLevel: "ACCREDITED_MATERIAL", qualificationRef: null, sources: [],
        curriculum: {
          id: "c-1", slug: "CURR-FS", name: "FS Curriculum", description: null,
          notableInfo: {
            modules: [
              { id: "MOD-1", title: "Introduction", sortOrder: 0, learningOutcomes: [] },
              { id: "MOD-2", title: "Hazards", sortOrder: 1, learningOutcomes: [] },
              { id: "MOD-3", title: "Temperature", sortOrder: 2, learningOutcomes: [] },
            ],
          },
          deliveryConfig: {
            lessonPlan: {
              estimatedSessions: 6,
              entries: [
                { session: 1, type: "onboarding", moduleId: null, moduleLabel: "Onboarding", label: "Welcome & orientation" },
                { session: 2, type: "introduce", moduleId: "MOD-1", moduleLabel: "Introduction", label: "First exposure", assertionIds: ["a1", "a2"], vocabularyIds: ["v1", "v2"], questionIds: ["q1"] },
                { session: 3, type: "deepen", moduleId: "MOD-1", moduleLabel: "Introduction", label: "Deepen basics" },
                { session: 4, type: "introduce", moduleId: "MOD-2", moduleLabel: "Hazards", label: "Hazard types" },
                { session: 5, type: "review", moduleId: null, moduleLabel: "Review", label: "Review session" },
                { session: 6, type: "assess", moduleId: null, moduleLabel: "Assessment", label: "Final check" },
              ],
            },
          },
          trustLevel: "L4", qualificationBody: null,
          qualificationNumber: null, qualificationLevel: null,
        },
      }],
    };

    it("does NOT use lesson plan when onboarding is incomplete", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: false, completedPhases: [], currentPhase: "welcome" },
        callerAttributes: [
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 2, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // Should use mastery-based selection, not lesson plan
      expect(result.lessonPlanSessionType).toBeNull();
      expect(result.lessonPlanEntry).toBeNull();
    });

    it("uses lesson plan when onboarding is complete and currentSession is set", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 2, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.currentSessionNumber).toBe(2);
      expect(result.lessonPlanSessionType).toBe("introduce");
      expect(result.lessonPlanEntry).toBeDefined();
      expect(result.lessonPlanEntry!.moduleId).toBe("MOD-1");
      expect(result.lessonPlanEntry!.moduleLabel).toBe("Introduction");
    });

    it("threads assertionIds, vocabularyIds, and questionIds from lesson plan entry", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 2, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // Session 2 has assertionIds, vocabularyIds, questionIds
      expect(result.lessonPlanEntry).toBeDefined();
      expect(result.lessonPlanEntry!.assertionIds).toEqual(["a1", "a2"]);
      expect(result.lessonPlanEntry!.vocabularyIds).toEqual(["v1", "v2"]);
      expect(result.lessonPlanEntry!.questionIds).toEqual(["q1"]);
    });

    it("returns null for ID arrays when lesson plan entry has none", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [
          // Session 5 is "review" with no ID arrays
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 5, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.lessonPlanEntry).toBeDefined();
      expect(result.lessonPlanEntry!.assertionIds).toBeNull();
      expect(result.lessonPlanEntry!.vocabularyIds).toBeNull();
      expect(result.lessonPlanEntry!.questionIds).toBeNull();
    });

    it("overrides nextModule to match lesson plan entry", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 4, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // Session 4 is "introduce MOD-2"
      expect(result.nextModule).toBeDefined();
      expect(result.nextModule!.id).toBe("MOD-2");
      expect(result.lessonPlanSessionType).toBe("introduce");
    });

    it("handles cross-module sessions (review, assess) with null moduleId", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [
          makeCallerAttribute({ key: "curriculum:CURR-FS:current_session", numberValue: 5, scope: "CURRICULUM" }),
        ],
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      // Session 5 is "review" with no moduleId
      expect(result.lessonPlanSessionType).toBe("review");
      expect(result.lessonPlanEntry!.moduleId).toBeNull();
    });

    it("falls back to mastery-based selection when no lesson plan", async () => {
      const subjectSourcesNoLP = {
        subjects: [{
          ...subjectSourcesWithPlan.subjects[0],
          curriculum: {
            ...subjectSourcesWithPlan.subjects[0].curriculum,
            deliveryConfig: null,
          },
        }],
      };
      const data = makeLoadedData({
        subjectSources: subjectSourcesNoLP,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.lessonPlanSessionType).toBeNull();
      expect(result.lessonPlanEntry).toBeNull();
      expect(result.currentSessionNumber).toBeNull();
    });

    it("returns null fields when currentSession not in callerAttributes", async () => {
      const data = makeLoadedData({
        subjectSources: subjectSourcesWithPlan,
        recentCalls: [{ id: "call-1", transcript: "hi", createdAt: new Date(), scores: [] }],
        onboardingSession: { isComplete: true, completedPhases: [], currentPhase: null },
        callerAttributes: [], // no currentSession
      });
      const specs = makeResolvedSpecs();
      const result = await computeSharedState(data, specs, {});

      expect(result.currentSessionNumber).toBeNull();
      expect(result.lessonPlanSessionType).toBeNull();
    });
  });
});

describe("computeModuleProgress transform", () => {
  const transform = getTransform("computeModuleProgress")!;

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });
});

// =====================================================
// REGRESSION: comprehension routing + specSlug propagation
// Covers Phase 0 fixes from 304d602b and f1c6508a (2026-04-14).
// =====================================================

describe("resolveLessonPlanMode", () => {
  it("returns 'continuous' when deliveryConfig.lessonPlanMode is explicitly continuous", () => {
    expect(resolveLessonPlanMode({ lessonPlanMode: "continuous" }, null)).toBe("continuous");
    expect(resolveLessonPlanMode({ lessonPlanMode: "continuous" }, { teachingMode: "recall" })).toBe("continuous");
  });

  it("returns 'continuous' when playbook.teachingMode is comprehension (Phase 0 routing fix)", () => {
    // Regression for Boaz 2026-04-13 B2: Secret Garden served wrong passage because
    // comprehension courses never set deliveryConfig.lessonPlanMode=continuous, so
    // they silently fell through to the structured session-index lookup.
    expect(resolveLessonPlanMode(null, { teachingMode: "comprehension" })).toBe("continuous");
    expect(resolveLessonPlanMode({}, { teachingMode: "comprehension" })).toBe("continuous");
    expect(resolveLessonPlanMode(undefined, { teachingMode: "comprehension" })).toBe("continuous");
  });

  it("returns 'structured' for all other teachingMode values", () => {
    expect(resolveLessonPlanMode(null, { teachingMode: "recall" })).toBe("structured");
    expect(resolveLessonPlanMode(null, { teachingMode: "practice" })).toBe("structured");
    expect(resolveLessonPlanMode(null, { teachingMode: "syllabus" })).toBe("structured");
  });

  it("returns 'structured' when both inputs are empty", () => {
    expect(resolveLessonPlanMode(null, null)).toBe("structured");
    expect(resolveLessonPlanMode(undefined, undefined)).toBe("structured");
    expect(resolveLessonPlanMode({}, {})).toBe("structured");
  });

  it("explicit deliveryConfig='structured' does not override comprehension routing", () => {
    // Comprehension is an inherent course property; if a continuous-style
    // delivery was not set, comprehension still forces continuous. This is
    // intentional — see ADR 2026-04-14-outcome-graph-pacing.md.
    expect(resolveLessonPlanMode({ lessonPlanMode: "structured" }, { teachingMode: "comprehension" })).toBe("continuous");
  });
});

describe("findCurriculumInfo", () => {
  it("returns null when there are no subjects", () => {
    const data = makeLoadedData();
    expect(findCurriculumInfo(data)).toBeNull();
  });

  it("returns id, name, and slug for the first subject with a curriculum", () => {
    // Regression for Phase 0 commit f1c6508a: findCurriculumInfo must surface
    // the curriculum slug so the DB-first module path can populate specSlug,
    // which is required by the continuous branch guard.
    const data = makeLoadedData({
      subjectSources: {
        subjects: [
          {
            id: "subj-1",
            slug: "sg",
            name: "Secret Garden",
            defaultTrustLevel: "ACCREDITED_MATERIAL",
            qualificationRef: null,
            sources: [],
            curriculum: {
              id: "curr-abc",
              slug: "abacus-academy-english-language-curriculum",
              name: "Secret Garden Comprehension",
              description: null,
              notableInfo: null,
              deliveryConfig: null,
              trustLevel: "ACCREDITED_MATERIAL",
              qualificationBody: null,
              qualificationNumber: null,
              qualificationLevel: null,
            },
          },
        ],
      } as any,
    });
    const info = findCurriculumInfo(data);
    expect(info).not.toBeNull();
    expect(info!.id).toBe("curr-abc");
    expect(info!.name).toBe("Secret Garden Comprehension");
    expect(info!.slug).toBe("abacus-academy-english-language-curriculum");
  });

  it("returns slug:null when curriculum record has no slug field", () => {
    const data = makeLoadedData({
      subjectSources: {
        subjects: [
          {
            id: "subj-1",
            slug: "x",
            name: "X",
            defaultTrustLevel: "ACCREDITED_MATERIAL",
            qualificationRef: null,
            sources: [],
            curriculum: {
              id: "curr-xyz",
              name: "No Slug",
              description: null,
              notableInfo: null,
              deliveryConfig: null,
              trustLevel: "ACCREDITED_MATERIAL",
              qualificationBody: null,
              qualificationNumber: null,
              qualificationLevel: null,
            } as any,
          },
        ],
      } as any,
    });
    const info = findCurriculumInfo(data);
    expect(info).not.toBeNull();
    expect(info!.slug).toBeNull();
  });
});
