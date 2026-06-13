/**
 * Tests for the compound-ref resolution + CallerAttribute read path in
 * lib/goals/track-progress.ts :: `deriveLearnGoalProgressFromRef`.
 *
 * Background — two-layer ref/strategy bug (commit c0e829ba):
 *   Goal templates seeded by `scripts/fix-cio-cto-playbooks.ts` use compound
 *   refs of the form `<moduleSlug>::LO<n>` (1-based position within the
 *   module's LOs) while the actual LearningObjective rows use canonical refs
 *   (`STD-04-01`, `STD-04-02`, ...). Pre-fix, the resolver looked up LO by
 *   raw ref and never matched, so every LEARN goal sat at 0% on CIO/CTO
 *   playbooks even when per-LO mastery was being captured correctly.
 *
 * Background — read-source drift (this commit):
 *   The mastery write site at `lib/curriculum/track-progress.ts:343` uses a
 *   `Math.max(existing, score)` monotonic ratchet against `CallerAttribute
 *   lo_mastery:*` rows. The `CallerModuleProgress.loScoresJson` write at
 *   line 530 uses an arithmetic mean across all calls. These two storage
 *   slots drift apart by ~6× on real learners (Cyrus STD-04-01: 0.70
 *   ratchet vs 0.11 mean). Educator dashboard reads the ratchet; Goal.progress
 *   should match. The resolver now reads from `CallerAttribute lo_mastery:*`.
 *
 * The resolver accepts three ref shapes:
 *   1. `<moduleSlug>::LO<n>`   — position within module
 *   2. `<moduleSlug>::<loRef>` — explicit LO ref scoped to one module
 *   3. `<loRef>`               — bare LO ref (#414 Phase 5b legacy form)
 *
 * Strategy registry alias `LO_MASTERY → lo_rollup` is covered by
 * `goals-strategy-registry-aliases.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    learningObjective: { findMany: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
    callerAttribute: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: () => mockPrisma }));

import { deriveLearnGoalProgressFromRef } from "@/lib/goals/track-progress";

/** Build a fake CallerAttribute row matching the canonical key shape. */
function attr(specSlug: string, moduleSlug: string, loRef: string, value: number) {
  return {
    key: `curriculum:${specSlug}:lo_mastery:${moduleSlug}:${loRef}`,
    numberValue: value,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveLearnGoalProgressFromRef — compound `<moduleSlug>::LO<n>` (position form)", () => {
  it("resolves LO1 to the first LO by sortOrder and reads CallerAttribute lo_mastery for that ref", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      slug: "standard-unit-04-it-operations-infrastructure",
      learningObjectives: [
        { ref: "STD-04-01", sortOrder: 1 },
        { ref: "STD-04-02", sortOrder: 2 },
        { ref: "STD-04-03", sortOrder: 3 },
      ],
    });
    mockPrisma.callerAttribute.findMany.mockResolvedValueOnce([
      attr("the-standard-v1", "standard-unit-04-it-operations-infrastructure", "STD-04-01", 0.7),
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
    expect(mockPrisma.callerAttribute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callerId: "caller-1",
          scope: "CURRICULUM",
          valueType: "NUMBER",
          validUntil: null,
          OR: [
            {
              key: {
                endsWith: ":lo_mastery:standard-unit-04-it-operations-infrastructure:STD-04-01",
              },
            },
          ],
        }),
      }),
    );
    expect(mockPrisma.learningObjective.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the position index is past the LO count", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      slug: "standard-unit-04-it-operations-infrastructure",
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
    expect(mockPrisma.callerAttribute.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the module slug doesn't exist in the playbook's curricula", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce(null);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "unknown-module::LO1",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when no CallerAttribute lo_mastery row exists yet (awaiting evidence)", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      slug: "standard-unit-04-it-operations-infrastructure",
      learningObjectives: [{ ref: "STD-04-01", sortOrder: 1 }],
    });
    mockPrisma.callerAttribute.findMany.mockResolvedValueOnce([]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::LO1",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });
});

describe("deriveLearnGoalProgressFromRef — compound `<moduleSlug>::<loRef>` (explicit form)", () => {
  it("resolves an explicit canonical loRef inside the named module and reads CallerAttribute lo_mastery", async () => {
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({
      id: "mod-04",
      slug: "standard-unit-04-it-operations-infrastructure",
      learningObjectives: [
        { ref: "STD-04-01", sortOrder: 1 },
        { ref: "STD-04-02", sortOrder: 2 },
      ],
    });
    mockPrisma.callerAttribute.findMany.mockResolvedValueOnce([
      attr("the-standard-v1", "standard-unit-04-it-operations-infrastructure", "STD-04-02", 0.55),
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
      slug: "standard-unit-04-it-operations-infrastructure",
      learningObjectives: [{ ref: "STD-04-01", sortOrder: 1 }],
    });

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "standard-unit-04-it-operations-infrastructure::STD-04-99",
      playbookId: "pb-1",
    });

    expect(result).toBeNull();
  });
});

describe("deriveLearnGoalProgressFromRef — bare `<loRef>` (legacy form, multi-module)", () => {
  it("aggregates across every module that contains an LO with the bare ref (mean of CallerAttribute lo_mastery rows)", async () => {
    mockPrisma.learningObjective.findMany.mockResolvedValueOnce([
      { moduleId: "mod-04", module: { slug: "module-04" } },
      { moduleId: "mod-09", module: { slug: "module-09" } },
    ]);
    mockPrisma.callerAttribute.findMany.mockResolvedValueOnce([
      attr("spec-v1", "module-04", "OUT-01", 0.6),
      attr("spec-v1", "module-09", "OUT-01", 0.4),
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

  it("partial coverage — one of two matching modules has a CallerAttribute row, the other doesn't", async () => {
    mockPrisma.learningObjective.findMany.mockResolvedValueOnce([
      { moduleId: "mod-04", module: { slug: "module-04" } },
      { moduleId: "mod-09", module: { slug: "module-09" } },
    ]);
    mockPrisma.callerAttribute.findMany.mockResolvedValueOnce([
      attr("spec-v1", "module-04", "OUT-01", 0.8),
    ]);

    const result = await deriveLearnGoalProgressFromRef("caller-1", {
      ref: "OUT-01",
      playbookId: "pb-1",
    });

    expect(result).toEqual({
      progress: 0.8,
      totalModulesWithRef: 2,
      touchedModules: 1,
    });
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
