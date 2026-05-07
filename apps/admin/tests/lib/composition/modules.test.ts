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
  filterTeachableAssertions,
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

  // lesson plan session tracking tests removed — structured mode deleted.
  // All courses now use scheduler-driven pacing via computeSharedState's
  // continuous-mode branch. See ADR: outcome-graph-pacing.md
});

describe("computeModuleProgress transform", () => {
  const transform = getTransform("computeModuleProgress")!;

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });

  // ── #266 Slice 1: per-learner attempt counts ──

  function makeContext(
    modules: ModuleData[],
    moduleAttemptCounts: SharedComputedState["moduleAttemptCounts"] = undefined,
    hasAttemptData = false,
  ): any {
    const sharedState = {
      channel: "text" as const,
      modules,
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set<string>(),
      estimatedProgress: 0,
      lastCompletedIndex: 0,
      moduleToReview: null,
      nextModule: null,
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
      curriculumName: "Test Curriculum",
      isFinalSession: false,
      callNumber: 2,
      moduleAttemptCounts,
      hasAttemptData,
    };
    return {
      sharedState,
      loadedData: makeLoadedData({ callCount: 1 }),
      resolvedSpecs: makeResolvedSpecs(),
      sections: {},
      specConfig: {},
    };
  }

  it("surfaces hasAttemptData top-level on transform output", () => {
    const ctx = makeContext(
      [{ id: "m-1", slug: "baseline", name: "Baseline" }],
      { "m-1": { callCount: 2, status: "COMPLETED", completedAt: new Date() } },
      true,
    );
    const out: any = transform({}, ctx, {} as any);
    expect(out.hasAttemptData).toBe(true);
  });

  it("hasAttemptData is false when no attempts have been recorded", () => {
    const ctx = makeContext(
      [{ id: "m-1", slug: "baseline", name: "Baseline" }],
      undefined,
      false,
    );
    const out: any = transform({}, ctx, {} as any);
    expect(out.hasAttemptData).toBe(false);
  });

  it("populates per-module callCount, status, statusLabel from moduleAttemptCounts", () => {
    const modules: ModuleData[] = [
      { id: "m-1", slug: "baseline", name: "Baseline" },
      { id: "m-2", slug: "part-1", name: "Part 1" },
      { id: "m-3", slug: "part-2", name: "Part 2" },
    ];
    const ctx = makeContext(
      modules,
      {
        "m-1": { callCount: 2, status: "COMPLETED", completedAt: new Date() },
        "m-2": { callCount: 1, status: "IN_PROGRESS", completedAt: null },
        // m-3 deliberately missing — never attempted
      },
      true,
    );
    const out: any = transform({}, ctx, {} as any);
    expect(out.modules).toHaveLength(3);
    expect(out.modules[0]).toMatchObject({ id: "m-1", callCount: 2, status: "completed", statusLabel: "done", isCompleted: true });
    expect(out.modules[1]).toMatchObject({ id: "m-2", callCount: 1, status: "in_progress", statusLabel: "in progress", isCompleted: false });
    expect(out.modules[2]).toMatchObject({ id: "m-3", callCount: 0, statusLabel: "not started", isCompleted: false });
  });

  // ── #274 Slice A: locked-module via specConfig.requestedModuleId ──

  it("populates lockedModule when specConfig.requestedModuleId matches Playbook.config.modules", async () => {
    const data = makeLoadedData({
      playbooks: [{
        id: "pb-1", name: "C", isActive: true, isLatest: true,
        config: {
          modulesAuthored: true,
          modules: [
            { id: "baseline", label: "Baseline Assessment", outcomesPrimary: ["LO-1", "LO-2"] },
            { id: "part1", label: "Part 1: Familiar Topics" },
          ],
        } as any,
      } as any],
    });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(data, specs, { requestedModuleId: "part1" });
    expect(result.lockedModule).not.toBeNull();
    expect(result.lockedModule?.id).toBe("part1");
    expect(result.lockedModule?.name).toBe("Part 1: Familiar Topics");
    // nextModule is forced to the locked choice (downstream transforms narrate it)
    expect(result.nextModule?.id).toBe("part1");
  });

  it("locks via id-based match — slug-based requestedModuleId falls back gracefully", async () => {
    const data = makeLoadedData({
      playbooks: [{
        id: "pb-1", name: "C", isActive: true, isLatest: true,
        config: {
          modulesAuthored: true,
          modules: [{ id: "baseline", label: "Baseline" }],
        } as any,
      } as any],
    });
    const specs = makeResolvedSpecs();
    // requestedModuleId doesn't match any module.id → silent fallback
    const result = await computeSharedState(data, specs, { requestedModuleId: "nonexistent" });
    expect(result.lockedModule).toBeNull();
  });

  it("does NOT populate lockedModule when requestedModuleId is absent (regression)", async () => {
    const data = makeLoadedData({
      playbooks: [{
        id: "pb-1", name: "C", isActive: true, isLatest: true,
        config: { modulesAuthored: true, modules: [{ id: "baseline", label: "Baseline" }] } as any,
      } as any],
    });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(data, specs, {});
    expect(result.lockedModule).toBeNull();
  });

  it("falls back to attribute-derived status when moduleAttemptCounts is undefined", () => {
    const modules: ModuleData[] = [{ id: "m-1", slug: "baseline", name: "Baseline" }];
    const ctx = makeContext(modules, undefined, false);
    // Override loadedData callCount=0 + lastCompletedIndex=-1 so the legacy
    // attribute-based getModuleStatus path returns "not_started" (no progress signal).
    ctx.loadedData = makeLoadedData({ callCount: 0 });
    ctx.sharedState.lastCompletedIndex = -1;
    const out: any = transform({}, ctx, {} as any);
    expect(out.modules[0].callCount).toBe(0);
    expect(out.modules[0].status).toBe("not_started");
    expect(out.modules[0].statusLabel).toBe("not started");
  });
});

// resolveLessonPlanMode tests removed — function deleted.
// All courses now use scheduler-driven pacing.
// See ADR: docs/decisions/2026-04-14-outcome-graph-pacing.md

describe("filterTeachableAssertions", () => {
  // Regression for diagnosis 2026-04-14: COURSE_REFERENCE assertions are
  // tutor rules ("Do NOT summarise the passage", "Use silence", etc.),
  // not student teaching content. They legitimately have null
  // learningOutcomeRef and should never enter the working-set selector
  // — they're rendered separately via the course-instructions transform.

  it("excludes COURSE_REFERENCE assertions", () => {
    const input = [
      { id: "a1", sourceDocumentType: "READING_PASSAGE" },
      { id: "a2", sourceDocumentType: "COURSE_REFERENCE" },
      { id: "a3", sourceDocumentType: "QUESTION_BANK" },
      { id: "a4", sourceDocumentType: "COURSE_REFERENCE" },
    ];
    const result = filterTeachableAssertions(input);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["a1", "a3"]);
  });

  it("keeps assertions with null sourceDocumentType (defensive)", () => {
    // Legacy assertions might lack sourceDocumentType — keep them so we
    // don't silently drop teaching content with missing metadata.
    const input = [
      { id: "a1", sourceDocumentType: null },
      { id: "a2", sourceDocumentType: undefined },
      { id: "a3" } as any,
    ];
    expect(filterTeachableAssertions(input)).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(filterTeachableAssertions([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "a1", sourceDocumentType: "READING_PASSAGE" },
      { id: "a2", sourceDocumentType: "COURSE_REFERENCE" },
    ];
    const result = filterTeachableAssertions(input);
    expect(input).toHaveLength(2);
    expect(result).not.toBe(input);
  });

  it("keeps QUESTION_BANK and READING_PASSAGE and ASSESSMENT", () => {
    const input = [
      { id: "a1", sourceDocumentType: "READING_PASSAGE" },
      { id: "a2", sourceDocumentType: "QUESTION_BANK" },
      { id: "a3", sourceDocumentType: "ASSESSMENT" },
      { id: "a4", sourceDocumentType: "GENERIC" },
      { id: "a5", sourceDocumentType: "CURRICULUM" },
    ];
    expect(filterTeachableAssertions(input)).toHaveLength(5);
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
