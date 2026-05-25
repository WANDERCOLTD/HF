/**
 * Tests for `lib/curriculum/resolve-playbook-for-curriculum.ts` — #834.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  curriculum: { findUnique: vi.fn() },
  curriculumModule: { findUnique: vi.fn() },
  playbookSource: { findMany: vi.fn() },
  playbookItem: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("resolvePlaybookForCurriculum — #834", () => {
  let mod: typeof import("@/lib/curriculum/resolve-playbook-for-curriculum");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/resolve-playbook-for-curriculum");
  });

  describe("resolvePlaybookIdForCurriculum", () => {
    it("returns the playbookId from the curriculum row", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ playbookId: "pb-1" });
      await expect(mod.resolvePlaybookIdForCurriculum("c1")).resolves.toBe("pb-1");
    });

    it("returns null when curriculum has no playbook FK", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ playbookId: null });
      await expect(mod.resolvePlaybookIdForCurriculum("c1")).resolves.toBeNull();
    });

    it("returns null when curriculum not found", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue(null);
      await expect(mod.resolvePlaybookIdForCurriculum("missing")).resolves.toBeNull();
    });

    it("returns null on empty input", async () => {
      await expect(mod.resolvePlaybookIdForCurriculum("")).resolves.toBeNull();
      expect(mockPrisma.curriculum.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("resolvePlaybookIdForCurriculumModule", () => {
    it("walks module → curriculum → playbookId", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({
        curriculum: { playbookId: "pb-x" },
      });
      await expect(mod.resolvePlaybookIdForCurriculumModule("m1")).resolves.toBe("pb-x");
    });

    it("returns null when module has no parent or no FK", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue(null);
      await expect(mod.resolvePlaybookIdForCurriculumModule("missing")).resolves.toBeNull();
    });
  });

  describe("resolvePlaybookIdsForContentSource", () => {
    it("returns every PlaybookSource linkage for the source", async () => {
      mockPrisma.playbookSource.findMany.mockResolvedValue([
        { playbookId: "pb-1" },
        { playbookId: "pb-2" },
      ]);
      await expect(
        mod.resolvePlaybookIdsForContentSource("src-1"),
      ).resolves.toEqual(["pb-1", "pb-2"]);
    });

    it("returns empty array on empty input", async () => {
      await expect(mod.resolvePlaybookIdsForContentSource("")).resolves.toEqual([]);
      expect(mockPrisma.playbookSource.findMany).not.toHaveBeenCalled();
    });
  });

  describe("resolvePlaybookIdsForAnalysisSpec", () => {
    it("returns every PlaybookItem linkage with non-null playbookId", async () => {
      mockPrisma.playbookItem.findMany.mockResolvedValue([
        { playbookId: "pb-1" },
        { playbookId: null },
        { playbookId: "pb-2" },
      ]);
      await expect(
        mod.resolvePlaybookIdsForAnalysisSpec("spec-1"),
      ).resolves.toEqual(["pb-1", "pb-2"]);
    });

    it("returns empty array on empty input", async () => {
      await expect(mod.resolvePlaybookIdsForAnalysisSpec("")).resolves.toEqual([]);
    });
  });
});
