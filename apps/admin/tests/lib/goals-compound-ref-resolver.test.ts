/**
 * Tests for the compound-ref resolution in lib/goals/track-progress.ts ::
 * `deriveLearnGoalProgressFromRef`.
 *
 * Background: Goal templates seeded by `scripts/fix-cio-cto-playbooks.ts`
 * use compound refs of the form `<moduleSlug>::LO<n>` (1-based position
 * within the module's LOs) while the actual LearningObjective rows use
 * canonical refs (`STD-04-01`, `STD-04-02`, ...). Pre-fix, the resolver
 * looked up LO by raw ref and never matched, so every LEARN goal sat at
 * 0% on CIO/CTO playbooks even when per-LO mastery was being captured
 * correctly into `CallerModuleProgress.loScoresJson`.
 *
 * The resolver now accepts three shapes:
 *   1. `<moduleSlug>::LO<n>`   — position within module
 *   2. `<moduleSlug>::<loRef>` — explicit LO ref scoped to one module
 *   3. `<loRef>`               — bare LO ref (#414 Phase 5b legacy form)
 *
 * It also relies on the strategy registry alias `LO_MASTERY → lo_rollup`
 * (registry.ts) — that path is covered by `goals-strategy-registry-aliases.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    learningObjective: { findMany: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
    callerModuleProgress: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: () => mockPrisma }));

import { deriveLearnGoalProgressFromRef } from "@/lib/goals/track-progress";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveLearnGoalProgressFromRef — compound `<moduleSlug>::LO<n>` (position form)", () => {
  it("resolves LO1 to the first LO in the module by sortOrder and reads loScoresJson with its canonical ref", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      learningObjectives: [
        { ref: "STD-04-01", sortOrder: 1 },
        { ref: "STD-04-02", sortOrder: 2 },
        { ref: "STD-04-03", sortOrder: 3 },
      ],
    });
    mockPrisma.callerModuleProgress.findMany.mockResolvedValueOnce([
      {
        moduleId: "mod-04",
        loScoresJson: {
          "STD-04-01": { mastery: 0.7 },
          "STD-04-02": { mastery: 0.6 },
        },
      },
    ]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::LO1",
      playbookId: "pb-1",
    });

    expect(result).toEqual({
      progress: 0.7,
      totalModulesWithRef: 1,
      touchedModules: 1,
    });
    expect(mockPrisma.curriculumModule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: "standard-unit-04-it-operations-infrastructure",
          curriculum: {
            playbookLinks: { some: { playbookId: "pb-1", role: "primary" } },
          },
        }),
      }),
    );
    expect(mockPrisma.learningObjective.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the position index is past the LO count", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      learningObjectives: [
        { ref: "STD-04-01", sortOrder: 1 },
        { ref: "STD-04-02", sortOrder: 2 },
      ],
    });

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::LO99",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
    expect(mockPrisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the module slug doesn't exist in the playbook's curricula", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce(null);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "unknown-module::LO1",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when the module exists but the caller has no progress row for it (awaiting evidence)", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      learningObjectives: [{ ref: "STD-04-01", sortOrder: 1 }],
    });
    mockPrisma.callerModuleProgress.findMany.mockResolvedValueOnce([]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::LO1",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });
});

describe("deriveLearnGoalProgressFromRef — compound `<moduleSlug>::<loRef>` (explicit form)", () => {
  it("resolves an explicit canonical loRef inside the named module", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      learningObjectives: [
        { ref: "STD-04-01", sortOrder: 1 },
        { ref: "STD-04-02", sortOrder: 2 },
      ],
    });
    mockPrisma.callerModuleProgress.findMany.mockResolvedValueOnce([
      {
        moduleId: "mod-04",
        loScoresJson: { "STD-04-02": { mastery: 0.55 } },
      },
    ]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::STD-04-02",
      playbookId: "pb-1",
    });

    expect(result).toEqual({
      progress: 0.55,
      totalModulesWithRef: 1,
      touchedModules: 1,
    });
  });

  it("returns null when the explicit loRef doesn't exist in the named module", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      learningObjectives: [{ ref: "STD-04-01", sortOrder: 1 }],
    });

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::STD-04-99",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });
});

describe("deriveLearnGoalProgressFromRef — bare `<loRef>` (legacy form)", () => {
  it("matches the original #414 Phase 5b path — looks up LO across all modules in the playbook", async () => {
    mockPrisma.learningObjective.findMany.mockResolvedValueOnce([
      { moduleId: "mod-04", ref: "OUT-01" },
      { moduleId: "mod-09", ref: "OUT-01" },
    ]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValueOnce([
      { moduleId: "mod-04", loScoresJson: { "OUT-01": { mastery: 0.6 } } },
      { moduleId: "mod-09", loScoresJson: { "OUT-01": { mastery: 0.4 } } },
    ]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "OUT-01",
      playbookId: "pb-1",
    });

    expect(result).toEqual({
      progress: 0.5,
      totalModulesWithRef: 2,
      touchedModules: 2,
    });
    expect(mockPrisma.curriculumModule.findFirst).not.toHaveBeenCalled();
  });
});

describe("deriveLearnGoalProgressFromRef — input gates", () => {
  it("returns null when goal.ref is empty", async () => {
    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "",
      playbookId: "pb-1",
    });
    expect(result).toBeNull();
  });

  it("returns null when goal.playbookId is null", async () => {
    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::LO1",
      playbookId: null,
    });
    expect(result).toBeNull();
  });
});
