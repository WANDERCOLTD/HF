/**
 * Tests for recommendNextModule — #494 E2 Slice 2.5
 *
 * Pure read helper: given a curriculum and a learner's
 * CallerModuleProgress, return the next module to attempt. Algorithm:
 *
 *   1. First non-mastered module whose prerequisites are all mastered
 *      → "next-in-sequence".
 *   2. Otherwise, if `strictPrerequisites === false`, lowest-sortOrder
 *      non-mastered → "first-unstarted".
 *   3. Otherwise lowest-sortOrder IN_PROGRESS → "interleave-review".
 *   4. Otherwise null (all mastered, or strictly blocked).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PlaybookConfig } from "@/lib/types/json-fields";

// =====================================================
// MOCKS
// =====================================================

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    curriculumModule: {
      findMany: vi.fn(),
    },
    callerModuleProgress: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// FIXTURES
// =====================================================

const CALLER_ID = "caller-1";
const CURRICULUM_ID = "curr-1";

interface FakeModule {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  prerequisites?: string[];
}

interface FakeProgress {
  moduleId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
}

function setup(modules: FakeModule[], progress: FakeProgress[]) {
  mockPrisma.curriculumModule.findMany.mockResolvedValue(modules as never);
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue(progress as never);
}

function mkModule(
  slug: string,
  sortOrder: number,
  opts: { prerequisites?: string[]; title?: string } = {},
): FakeModule {
  return {
    id: `mod-${slug}`,
    slug,
    title: opts.title ?? `Module ${slug}`,
    sortOrder,
    prerequisites: opts.prerequisites,
  };
}

// =====================================================
// TESTS
// =====================================================

describe("recommendNextModule (#494 Slice 2.5)", () => {
  let recommendNextModule: typeof import("@/lib/curriculum/recommend-next-module").recommendNextModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/curriculum/recommend-next-module");
    recommendNextModule = mod.recommendNextModule;
  });

  it("returns null when the curriculum has no modules", async () => {
    setup([], []);
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result).toBeNull();
  });

  it("returns module[0] as next-in-sequence when nothing is done", async () => {
    setup(
      [mkModule("m1", 0), mkModule("m2", 1), mkModule("m3", 2)],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result).toEqual({
      moduleId: "mod-m1",
      slug: "m1",
      title: "Module m1",
      reason: "next-in-sequence",
    });
  });

  it("skips a mastered module and returns the next one as next-in-sequence", async () => {
    setup(
      [mkModule("m1", 0), mkModule("m2", 1), mkModule("m3", 2)],
      [{ moduleId: "mod-m1", status: "COMPLETED" }],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result?.slug).toBe("m2");
    expect(result?.reason).toBe("next-in-sequence");
  });

  it("returns the unmet prereq itself when strictPrerequisites=true blocks the later module", async () => {
    setup(
      [
        mkModule("m1", 0),
        mkModule("m2", 1, { prerequisites: ["m1"] }),
      ],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: true } as PlaybookConfig,
    });
    // m1 itself has no unmet prereqs, so it's the next-in-sequence pick.
    expect(result?.slug).toBe("m1");
    expect(result?.reason).toBe("next-in-sequence");
  });

  it("returns the lowest-sortOrder module first when strictPrerequisites=false (same shape)", async () => {
    setup(
      [
        mkModule("m1", 0),
        mkModule("m2", 1, { prerequisites: ["m1"] }),
      ],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: false } as PlaybookConfig,
    });
    // Step 1 still finds m1 (no prereqs, not mastered) — reason stays
    // next-in-sequence. The strict flag only changes behaviour when step 1
    // fails to find any reachable module.
    expect(result?.slug).toBe("m1");
    expect(result?.reason).toBe("next-in-sequence");
  });

  it("returns the terminal module when all non-terminal modules are mastered", async () => {
    setup(
      [
        mkModule("m1", 0),
        mkModule("m2", 1),
        mkModule("mock", 2, { prerequisites: ["m1", "m2"] }),
      ],
      [
        { moduleId: "mod-m1", status: "COMPLETED" },
        { moduleId: "mod-m2", status: "COMPLETED" },
      ],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: true } as PlaybookConfig,
    });
    expect(result?.slug).toBe("mock");
    expect(result?.reason).toBe("next-in-sequence");
  });

  it("returns null when every module is mastered", async () => {
    setup(
      [mkModule("m1", 0), mkModule("m2", 1)],
      [
        { moduleId: "mod-m1", status: "COMPLETED" },
        { moduleId: "mod-m2", status: "COMPLETED" },
      ],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result).toBeNull();
  });

  it("returns IN_PROGRESS as interleave-review when strict=true gates every NOT_STARTED via unmet prereqs", async () => {
    // m1 IN_PROGRESS (not mastered → can't satisfy prereqs).
    // m2 + m3 NOT_STARTED but both require m1 → gated.
    // Strict mode + no reachable NOT_STARTED → fall back to in-progress.
    setup(
      [
        mkModule("m1", 0),
        mkModule("m2", 1, { prerequisites: ["m1"] }),
        mkModule("m3", 2, { prerequisites: ["m1"] }),
      ],
      [{ moduleId: "mod-m1", status: "IN_PROGRESS" }],
    );

    // Force step 1 (next-in-sequence) to fail by mastering nothing yet
    // making m1 unreachable. To exercise the interleave branch we need
    // m1 to ALSO have an unmet prereq — re-shape:
    setup(
      [
        mkModule("m0", 0), // gate — not mastered, no prereqs
        mkModule("m1", 1, {
          prerequisites: ["m0"], // unmet (m0 not mastered)
        }),
      ],
      // m1 is IN_PROGRESS but gated by m0.
      [{ moduleId: "mod-m1", status: "IN_PROGRESS" }],
    );
    // With this shape, step 1 returns m0 (no prereqs, not mastered) →
    // next-in-sequence. interleave-review only fires when EVERY
    // non-mastered module has an unmet prereq. Reshape once more so even
    // m0 is unreachable: give m0 a prereq on a hypothetical "ghost" slug
    // not in the curriculum.
    setup(
      [
        mkModule("m0", 0, { prerequisites: ["ghost"] }), // unmet
        mkModule("m1", 1, {
          prerequisites: ["m0"], // unmet
        }),
      ],
      [{ moduleId: "mod-m1", status: "IN_PROGRESS" }],
    );

    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: true } as PlaybookConfig,
    });
    expect(result).toEqual({
      moduleId: "mod-m1",
      slug: "m1",
      title: "Module m1",
      reason: "interleave-review",
    });
  });

  it("returns null (not interleave-review) when strict=true blocks everything and no module is IN_PROGRESS", async () => {
    setup(
      [
        mkModule("m0", 0, { prerequisites: ["ghost"] }),
        mkModule("m1", 1, { prerequisites: ["m0"] }),
      ],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: true } as PlaybookConfig,
    });
    expect(result).toBeNull();
  });

  it("returns first-unstarted when strict=false AND every module is gated by an unmet prereq", async () => {
    setup(
      [
        mkModule("m0", 0, { prerequisites: ["ghost"] }),
        mkModule("m1", 1, { prerequisites: ["m0"] }),
      ],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { strictPrerequisites: false } as PlaybookConfig,
    });
    expect(result).toEqual({
      moduleId: "mod-m0",
      slug: "m0",
      title: "Module m0",
      reason: "first-unstarted",
    });
  });

  it("treats absent prerequisites field on a module as no prereqs", async () => {
    // Legacy row pre-slice-2.4 — prerequisites omitted. Should NOT block.
    setup(
      [
        { id: "mod-m1", slug: "m1", title: "Module m1", sortOrder: 0 },
        { id: "mod-m2", slug: "m2", title: "Module m2", sortOrder: 1 },
      ],
      [],
    );
    const result = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result?.slug).toBe("m1");
    expect(result?.reason).toBe("next-in-sequence");
  });

  it("returns null when callerId or curriculumId is empty", async () => {
    const a = await recommendNextModule({
      callerId: "",
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    const b = await recommendNextModule({
      callerId: CALLER_ID,
      curriculumId: "",
      playbookConfig: null,
    });
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(mockPrisma.curriculumModule.findMany).not.toHaveBeenCalled();
  });
});
