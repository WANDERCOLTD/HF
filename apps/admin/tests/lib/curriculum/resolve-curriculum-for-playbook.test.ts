/**
 * Tests for `lib/curriculum/resolve-module.ts::resolveCurriculumIdForPlaybook`.
 * #1034 — TL hard-block regression: a variant Playbook's Curriculum must be
 * resolved via PlaybookCurriculum (join), not via the deprecated
 * Curriculum.playbookId column. Without this, the pipeline at
 * `app/api/calls/[callId]/pipeline/route.ts:148` would silently skip
 * module-aware composition for every variant Call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbookCurriculum: { findFirst: vi.fn() },
  curriculum: { findFirst: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("resolveCurriculumIdForPlaybook — #1034", () => {
  let mod: typeof import("@/lib/curriculum/resolve-module");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/resolve-module");
  });

  it("reads PlaybookCurriculum first — primary row resolves to the shared Curriculum", async () => {
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({
      curriculumId: "c-shared",
    });
    await expect(
      mod.resolveCurriculumIdForPlaybook("pb-primary"),
    ).resolves.toBe("c-shared");
    // Must not fall through to the deprecated column when join row exists.
    expect(mockPrisma.curriculum.findFirst).not.toHaveBeenCalled();
  });

  it("REGRESSION (TL block #1): variant Playbook's linked row resolves to PARENT's Curriculum", async () => {
    // A variant Playbook has a PlaybookCurriculum row with role='linked'
    // pointing at the parent's Curriculum. The pre-#1034 implementation
    // queried Curriculum.playbookId directly and returned null for variants
    // — pipeline COMPOSE then silently skipped module-aware composition.
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({
      curriculumId: "c-parent-owned",
    });
    await expect(
      mod.resolveCurriculumIdForPlaybook("pb-variant"),
    ).resolves.toBe("c-parent-owned");
    expect(mockPrisma.playbookCurriculum.findFirst).toHaveBeenCalledWith({
      where: { playbookId: "pb-variant" },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { curriculumId: true },
    });
  });

  it("falls back to deprecated Curriculum.playbookId only when no join row exists", async () => {
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue(null);
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "c-legacy" });
    await expect(
      mod.resolveCurriculumIdForPlaybook("pb-legacy"),
    ).resolves.toBe("c-legacy");
  });

  it("returns null when neither join nor deprecated column matches", async () => {
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue(null);
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);
    await expect(
      mod.resolveCurriculumIdForPlaybook("pb-orphan"),
    ).resolves.toBeNull();
  });

  it("returns null on falsy input without touching the DB", async () => {
    await expect(mod.resolveCurriculumIdForPlaybook(null)).resolves.toBeNull();
    await expect(mod.resolveCurriculumIdForPlaybook(undefined)).resolves.toBeNull();
    await expect(mod.resolveCurriculumIdForPlaybook("")).resolves.toBeNull();
    expect(mockPrisma.playbookCurriculum.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.curriculum.findFirst).not.toHaveBeenCalled();
  });
});
