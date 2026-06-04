/**
 * Tests for `lib/curriculum/resolve-playbook-for-curriculum.ts` — #834.
 * Updated for #1034: `resolvePlaybookIdForCurriculum` and `…ForCurriculumModule`
 * now return `string[]` (CC-B fanout across sibling Playbooks sharing a Curriculum).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  curriculum: { findUnique: vi.fn() },
  curriculumModule: { findUnique: vi.fn() },
  playbookCurriculum: { findMany: vi.fn() },
  playbookSource: { findMany: vi.fn() },
  playbookItem: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("resolvePlaybookForCurriculum — #834 / #1034", () => {
  let mod: typeof import("@/lib/curriculum/resolve-playbook-for-curriculum");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/resolve-playbook-for-curriculum");
  });

  describe("resolvePlaybookIdForCurriculum (#1034 — returns string[])", () => {
    it("returns every Playbook linked via PlaybookCurriculum", async () => {
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([
        { playbookId: "pb-primary" },
        { playbookId: "pb-variant-1" },
        { playbookId: "pb-variant-2" },
      ]);
      await expect(
        mod.resolvePlaybookIdForCurriculum("c1"),
      ).resolves.toEqual(["pb-primary", "pb-variant-1", "pb-variant-2"]);
      // Should not hit the fallback when join rows exist.
      expect(mockPrisma.curriculum.findUnique).not.toHaveBeenCalled();
    });

    it("falls back to deprecated Curriculum.playbookId column when no join rows", async () => {
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([]);
      mockPrisma.curriculum.findUnique.mockResolvedValue({ playbookId: "pb-legacy" });
      await expect(
        mod.resolvePlaybookIdForCurriculum("c1"),
      ).resolves.toEqual(["pb-legacy"]);
    });

    it("returns empty array when no join row and no deprecated column value", async () => {
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([]);
      mockPrisma.curriculum.findUnique.mockResolvedValue({ playbookId: null });
      await expect(mod.resolvePlaybookIdForCurriculum("c1")).resolves.toEqual([]);
    });

    it("returns empty array when curriculum not found", async () => {
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([]);
      mockPrisma.curriculum.findUnique.mockResolvedValue(null);
      await expect(mod.resolvePlaybookIdForCurriculum("missing")).resolves.toEqual([]);
    });

    it("returns empty array on empty input without touching the DB", async () => {
      await expect(mod.resolvePlaybookIdForCurriculum("")).resolves.toEqual([]);
      expect(mockPrisma.playbookCurriculum.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.curriculum.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("resolvePlaybookIdForCurriculumModule (#1034 — returns string[])", () => {
    it("walks module → curriculum → playbookCurriculum siblings", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({ curriculumId: "c-shared" });
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([
        { playbookId: "pb-primary" },
        { playbookId: "pb-linked" },
      ]);
      await expect(
        mod.resolvePlaybookIdForCurriculumModule("m1"),
      ).resolves.toEqual(["pb-primary", "pb-linked"]);
    });

    it("falls through to the deprecated column when join is empty", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({ curriculumId: "c-shared" });
      mockPrisma.playbookCurriculum.findMany.mockResolvedValue([]);
      mockPrisma.curriculum.findUnique.mockResolvedValue({ playbookId: "pb-legacy" });
      await expect(
        mod.resolvePlaybookIdForCurriculumModule("m1"),
      ).resolves.toEqual(["pb-legacy"]);
    });

    it("returns empty array when module not found", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue(null);
      await expect(mod.resolvePlaybookIdForCurriculumModule("missing")).resolves.toEqual([]);
    });

    it("returns empty array when module has no curriculumId", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({ curriculumId: null });
      await expect(mod.resolvePlaybookIdForCurriculumModule("m1")).resolves.toEqual([]);
    });
  });

  describe("resolvePlaybookIdsForContentSource (unchanged)", () => {
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

  describe("resolvePlaybookIdsForAnalysisSpec (unchanged)", () => {
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
