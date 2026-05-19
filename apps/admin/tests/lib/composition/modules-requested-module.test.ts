/**
 * #492 Slice 3.1: tests for `requestedModuleId` threaded into the composer.
 *
 * Covers the new explicit param on `computeSharedState` (a CurriculumModule.id
 * from `Call.curriculumModuleId`) — separate from the existing
 * `specConfig.requestedModuleId` flow that matches authored Playbook.config.modules
 * (#274 Slice A). When the param resolves to a loaded module, it becomes the
 * highest-priority pick and the scheduler / authored-id pathway are both
 * bypassed. When it does not resolve, behaviour falls back silently with a
 * warning so wizard/route bugs surface early in dev.
 *
 * Also asserts the slice-3.2 sibling-thinning still applies through the
 * transform — the locked module must be marked `isCurrent: true` and keep
 * `description` + `content`, while siblings get the thinned shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeSharedState,
} from "@/lib/prompt/composition/transforms/modules";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  LoadedDataContext,
  ResolvedSpecs,
  SharedComputedState,
  ModuleData,
} from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/modules";

// =====================================================
// HELPERS (mirror modules.test.ts shapes)
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

/**
 * Subject-curriculum fallback path produces ModuleData where m.id = the raw
 * module id from notableInfo.modules. That is the simplest way to exercise
 * the new requestedModuleId branch without mocking prisma.
 */
const subjectSourcesWithModules = {
  subjects: [
    {
      id: "subj-1",
      slug: "course-x",
      name: "Course X",
      defaultTrustLevel: "ACCREDITED_MATERIAL",
      qualificationRef: null,
      sources: [],
      curriculum: {
        id: "curr-1",
        slug: "CURR-X",
        name: "Curriculum X",
        description: null,
        notableInfo: {
          modules: [
            {
              id: "MOD-1",
              title: "Module 1",
              description: "Module 1 description",
              sortOrder: 0,
              learningOutcomes: ["LO1"],
            },
            {
              id: "MOD-2",
              title: "Module 2",
              description: "Module 2 description",
              sortOrder: 1,
              learningOutcomes: ["LO2"],
            },
            {
              id: "MOD-3",
              title: "Module 3",
              description: "Module 3 description",
              sortOrder: 2,
              learningOutcomes: ["LO3"],
            },
          ],
        },
        deliveryConfig: null,
        trustLevel: "ACCREDITED_MATERIAL",
        qualificationBody: null,
        qualificationNumber: null,
        qualificationLevel: null,
      },
    },
  ],
};

// =====================================================
// computeSharedState — requestedModuleIdArg priority
// =====================================================

describe("computeSharedState — #492 Slice 3.1 requestedModuleId arg", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("locks to the requested CurriculumModule.id when it matches a loaded module", async () => {
    const data = makeLoadedData({ subjectSources: subjectSourcesWithModules as any });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(data, specs, {}, undefined, "MOD-2");

    expect(result.lockedModule).not.toBeNull();
    expect(result.lockedModule?.id).toBe("MOD-2");
    expect(result.lockedModule?.name).toBe("Module 2");
    expect(result.nextModule?.id).toBe("MOD-2");
  });

  it("overrides any caller-attribute-derived next module pick", async () => {
    // MOD-1 mastered → without locking, nextModule would advance to MOD-2.
    // With requestedModuleId pointing at MOD-3, MOD-3 wins regardless of progress.
    const data = makeLoadedData({
      subjectSources: subjectSourcesWithModules as any,
      callerAttributes: [
        {
          key: "mastery_MOD-1",
          scope: "CURRICULUM",
          domain: null,
          valueType: "NUMBER",
          stringValue: null,
          numberValue: 0.95,
          booleanValue: null,
          jsonValue: null,
          confidence: 0.9,
          sourceSpecSlug: null,
        },
      ],
    });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(data, specs, {}, undefined, "MOD-3");

    expect(result.lockedModule?.id).toBe("MOD-3");
    expect(result.nextModule?.id).toBe("MOD-3");
  });

  it("falls back silently with a warning when requestedModuleId does not resolve in the curriculum", async () => {
    const data = makeLoadedData({ subjectSources: subjectSourcesWithModules as any });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(data, specs, {}, undefined, "MOD-DOES-NOT-EXIST");

    expect(result.lockedModule).toBeNull();
    // Existing fallback: with no progress, moduleToReview=MOD-1 and nextModule=MOD-2.
    expect(result.moduleToReview?.id).toBe("MOD-1");
    expect(result.nextModule?.id).toBe("MOD-2");
    // Warning surfaced so wizard/route bugs are visible in dev.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not resolve to any CurriculumModule"),
    );
  });

  it("is identical to current behaviour when requestedModuleIdArg is undefined (regression)", async () => {
    const data = makeLoadedData({ subjectSources: subjectSourcesWithModules as any });
    const specs = makeResolvedSpecs();

    const withoutArg = await computeSharedState(data, specs, {});
    const withUndefinedArg = await computeSharedState(data, specs, {}, undefined, undefined);
    const withNullArg = await computeSharedState(data, specs, {}, undefined, null);

    expect(withoutArg.lockedModule).toBeNull();
    expect(withUndefinedArg.lockedModule).toBeNull();
    expect(withNullArg.lockedModule).toBeNull();

    // Stable pick — without any override, MOD-1 is moduleToReview, MOD-2 is next.
    expect(withoutArg.moduleToReview?.id).toBe("MOD-1");
    expect(withoutArg.nextModule?.id).toBe("MOD-2");
    expect(withUndefinedArg.nextModule?.id).toBe("MOD-2");
    expect(withNullArg.nextModule?.id).toBe("MOD-2");
  });

  it("wins over specConfig.requestedModuleId (DB-id route beats authored-id route)", async () => {
    // Both paths configured: authored picker says "baseline", DB call row says "MOD-2".
    // The DB-id route is the explicit Call-row signal and must win.
    const data = makeLoadedData({
      subjectSources: subjectSourcesWithModules as any,
      playbooks: [
        {
          id: "pb-1",
          name: "C",
          isActive: true,
          isLatest: true,
          config: {
            modulesAuthored: true,
            modules: [
              { id: "baseline", label: "Baseline Authored" },
              { id: "MOD-2", label: "Module 2 Authored" },
            ],
          } as any,
        } as any,
      ],
    });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(
      data,
      specs,
      { requestedModuleId: "baseline" },
      undefined,
      "MOD-2",
    );

    // DB-id wins — locked to MOD-2 with the subject-curriculum-derived name.
    expect(result.lockedModule?.id).toBe("MOD-2");
    expect(result.lockedModule?.name).toBe("Module 2");
    expect(result.nextModule?.id).toBe("MOD-2");
  });

  it("falls through to specConfig.requestedModuleId when the DB-id route does not resolve", async () => {
    // DB id is bogus → DB path warns and falls back. specConfig.requestedModuleId
    // still has its chance to match against authored modules.
    const data = makeLoadedData({
      playbooks: [
        {
          id: "pb-1",
          name: "C",
          isActive: true,
          isLatest: true,
          config: {
            modulesAuthored: true,
            modules: [
              { id: "baseline", label: "Baseline" },
              { id: "part1", label: "Part 1" },
            ],
          } as any,
        } as any,
      ],
    });
    const specs = makeResolvedSpecs();
    const result = await computeSharedState(
      data,
      specs,
      { requestedModuleId: "part1" },
      undefined,
      "MOD-NONE",
    );

    // DB-id miss warns, authored-id then locks.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not resolve to any CurriculumModule"),
    );
    expect(result.lockedModule?.id).toBe("part1");
    expect(result.nextModule?.id).toBe("part1");
  });
});

// =====================================================
// computeModuleProgress transform — sibling thinning still applies
// =====================================================

describe("computeModuleProgress — sibling thinning with #492 Slice 3.1 lock", () => {
  const transform = getTransform("computeModuleProgress")!;

  it("the requestedModuleId target becomes the current module with full body, siblings are thin", () => {
    const modules: ModuleData[] = [
      { id: "MOD-1", slug: "mod-1", name: "Module 1", description: "d1", content: { x: 1 } as any },
      { id: "MOD-2", slug: "mod-2", name: "Module 2", description: "d2", content: { x: 2 } as any },
      { id: "MOD-3", slug: "mod-3", name: "Module 3", description: "d3", content: { x: 3 } as any },
    ];
    // Simulate the post-computeSharedState state where requestedModuleId set
    // lockedModule and forced nextModule to the same module.
    const ctx: any = {
      sharedState: {
        channel: "text",
        modules,
        isFirstCall: false,
        daysSinceLastCall: 0,
        completedModules: new Set<string>(),
        estimatedProgress: 0,
        lastCompletedIndex: 0,
        moduleToReview: null,
        nextModule: modules[1],
        lockedModule: modules[1],
        reviewType: "quick_recall",
        reviewReason: "",
        thresholds: { high: 0.65, low: 0.35 },
        curriculumName: "Curriculum X",
        isFinalSession: false,
        callNumber: 1,
        moduleAttemptCounts: undefined,
        hasAttemptData: false,
      } satisfies Partial<SharedComputedState>,
      loadedData: makeLoadedData({ callCount: 0 }),
      resolvedSpecs: makeResolvedSpecs(),
      sections: {},
      specConfig: {},
    };

    const out: any = transform({}, ctx, {} as any);

    // MOD-2 is current — full body, isCurrent flag.
    expect(out.modules[1]).toMatchObject({ id: "MOD-2", isCurrent: true });
    expect(out.modules[1].description).toBe("d2");
    expect(out.modules[1].content).toBeDefined();

    // Siblings thinned — no description, no content, isCurrent=false.
    expect(out.modules[0]).toMatchObject({ id: "MOD-1", isCurrent: false });
    expect(out.modules[0].description).toBeUndefined();
    expect(out.modules[0].content).toBeUndefined();
    expect(out.modules[2]).toMatchObject({ id: "MOD-3", isCurrent: false });
    expect(out.modules[2].description).toBeUndefined();
    expect(out.modules[2].content).toBeUndefined();

    // currentModuleSlug + currentModuleTeachingInstructions still wired.
    expect(out.currentModuleSlug).toBe("mod-2");
  });
});
