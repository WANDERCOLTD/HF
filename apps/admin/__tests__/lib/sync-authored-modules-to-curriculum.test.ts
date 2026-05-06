/**
 * Tests for syncAuthoredModulesToCurriculum (#245).
 *
 * Mocks the Tx parameter directly rather than the @/lib/prisma module —
 * the helper takes a Tx so we can hand-roll one for unit testing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthoredModule } from "@/lib/types/json-fields";
import { syncAuthoredModulesToCurriculum } from "@/lib/wizard/sync-authored-modules-to-curriculum";

function mod(over: Partial<AuthoredModule>): AuthoredModule {
  return {
    id: "m",
    label: "Module",
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    ...over,
  };
}

interface MockTx {
  playbook: { findUnique: ReturnType<typeof vi.fn> };
  curriculum: { create: ReturnType<typeof vi.fn> };
  curriculumModule: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

function makeTx(): MockTx {
  return {
    playbook: { findUnique: vi.fn() },
    curriculum: { create: vi.fn() },
    curriculumModule: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("syncAuthoredModulesToCurriculum", () => {
  let tx: MockTx;

  beforeEach(() => {
    tx = makeTx();
  });

  it("uses the playbook's existing primary curriculum when present", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "IELTS Speaking",
      curricula: [{ id: "curr-1" }],
    });
    tx.curriculumModule.findMany.mockResolvedValue([]);
    tx.curriculumModule.upsert.mockResolvedValue({
      id: "m-1",
      createdAt: new Date("2026-05-01"),
      updatedAt: new Date("2026-05-01"),
    });

    const result = await syncAuthoredModulesToCurriculum(tx as never, "pb-1", [
      mod({ id: "baseline", label: "Baseline" }),
    ]);

    expect(result.curriculumId).toBe("curr-1");
    expect(tx.curriculum.create).not.toHaveBeenCalled();
    expect(tx.curriculumModule.upsert).toHaveBeenCalledOnce();
  });

  it("creates a default curriculum when the playbook has none", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-2",
      name: "Brand-new course",
      curricula: [],
    });
    tx.curriculum.create.mockResolvedValue({ id: "curr-new" });
    tx.curriculumModule.findMany.mockResolvedValue([]);
    tx.curriculumModule.upsert.mockResolvedValue({
      id: "m-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await syncAuthoredModulesToCurriculum(tx as never, "pb-2", [
      mod({ id: "intro", label: "Intro" }),
    ]);

    expect(tx.curriculum.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          playbookId: "pb-2",
          name: expect.stringContaining("Brand-new course"),
        }),
      }),
    );
    expect(result.curriculumId).toBe("curr-new");
  });

  it("forwards label, position, and prerequisites on upsert", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "Course",
      curricula: [{ id: "curr-1" }],
    });
    tx.curriculumModule.findMany.mockResolvedValue([]);
    tx.curriculumModule.upsert.mockResolvedValue({
      id: "m",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await syncAuthoredModulesToCurriculum(tx as never, "pb-1", [
      mod({ id: "ch2", label: "Chapter 2", position: 2, prerequisites: ["ch1"] }),
    ]);

    const call = tx.curriculumModule.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ curriculumId_slug: { curriculumId: "curr-1", slug: "ch2" } });
    expect(call.create).toMatchObject({
      curriculumId: "curr-1",
      slug: "ch2",
      title: "Chapter 2",
      sortOrder: 2,
      prerequisites: ["ch1"],
    });
    // Update path must NOT clobber masteryThreshold or other non-authored fields
    expect(call.update).toEqual({
      title: "Chapter 2",
      sortOrder: 2,
      prerequisites: ["ch1"],
    });
  });

  it("counts created vs updated based on createdAt/updatedAt heuristic", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "C",
      curricula: [{ id: "curr-1" }],
    });
    tx.curriculumModule.findMany.mockResolvedValue([]);
    const same = new Date("2026-05-01T00:00:00Z");
    const diff = new Date("2026-05-02T00:00:00Z");
    tx.curriculumModule.upsert
      .mockResolvedValueOnce({ id: "a", createdAt: same, updatedAt: same })
      .mockResolvedValueOnce({ id: "b", createdAt: same, updatedAt: diff });

    const result = await syncAuthoredModulesToCurriculum(tx as never, "pb-1", [
      mod({ id: "a" }),
      mod({ id: "b" }),
    ]);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("counts orphans (in DB but not in import) without deleting them", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "C",
      curricula: [{ id: "curr-1" }],
    });
    tx.curriculumModule.findMany.mockResolvedValue([
      { slug: "kept" },
      { slug: "stale-1" },
      { slug: "stale-2" },
    ]);
    tx.curriculumModule.upsert.mockResolvedValue({
      id: "x",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await syncAuthoredModulesToCurriculum(tx as never, "pb-1", [
      mod({ id: "kept" }),
    ]);

    expect(result.orphaned).toBe(2);
    // Critically: never call delete or deleteMany
    expect(Object.keys(tx.curriculumModule)).not.toContain("delete");
    expect(Object.keys(tx.curriculumModule)).not.toContain("deleteMany");
  });

  it("throws if playbook not found", async () => {
    tx.playbook.findUnique.mockResolvedValue(null);
    await expect(
      syncAuthoredModulesToCurriculum(tx as never, "nope", []),
    ).rejects.toThrow(/Playbook nope not found/);
  });

  it("handles empty modules array as a no-op upsert (still resolves curriculum)", async () => {
    tx.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "C",
      curricula: [{ id: "curr-1" }],
    });
    tx.curriculumModule.findMany.mockResolvedValue([]);

    const result = await syncAuthoredModulesToCurriculum(tx as never, "pb-1", []);

    expect(result.curriculumId).toBe("curr-1");
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.orphaned).toBe(0);
    expect(tx.curriculumModule.upsert).not.toHaveBeenCalled();
  });
});
