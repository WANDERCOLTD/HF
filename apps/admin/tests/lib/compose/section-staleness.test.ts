/**
 * Tests for `lib/compose/section-staleness.ts` — #1557 (Story 2 of EPIC #1555).
 *
 * Pins the four acceptance properties:
 *   1. Write to a key in section X bumps only section X's hash.
 *   2. `bumpSectionHash` is idempotent — same inputs => no `staleSince` move.
 *   3. Bumping a section hash does NOT touch `Playbook.composeInputsUpdatedAt`.
 *   4. `hashSectionInputs` is deterministic across key insertion order
 *      (sorted-key JSON.stringify).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbookSectionStaleness: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  callerPlaybook: { count: vi.fn() },
  playbook: { update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("section-staleness — #1557", () => {
  let mod: typeof import("@/lib/compose/section-staleness");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/compose/section-staleness");
    mockPrisma.playbookSectionStaleness.findUnique.mockResolvedValue(null);
    mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([]);
    mockPrisma.playbookSectionStaleness.update.mockResolvedValue({});
    mockPrisma.playbookSectionStaleness.create.mockResolvedValue({});
    mockPrisma.callerPlaybook.count.mockResolvedValue(0);
    mockPrisma.playbook.update.mockResolvedValue({});
  });

  describe("hashSectionInputs — determinism", () => {
    it("returns a 16-hex-char digest", () => {
      const hash = mod.hashSectionInputs({ a: 1, b: 2 });
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("is deterministic regardless of key insertion order", () => {
      const a = mod.hashSectionInputs({ welcome: "hi", waitForAck: true });
      const b = mod.hashSectionInputs({ waitForAck: true, welcome: "hi" });
      expect(a).toBe(b);
    });

    it("differs when nested values change", () => {
      const a = mod.hashSectionInputs({ welcome: { line: "hi" } });
      const b = mod.hashSectionInputs({ welcome: { line: "hello" } });
      expect(a).not.toBe(b);
    });

    it("preserves array order (semantically meaningful)", () => {
      const a = mod.hashSectionInputs({ phases: ["intro", "outro"] });
      const b = mod.hashSectionInputs({ phases: ["outro", "intro"] });
      expect(a).not.toBe(b);
    });
  });

  describe("bumpSectionHash — idempotency + isolation", () => {
    it("creates a row on first write", async () => {
      mockPrisma.playbookSectionStaleness.findUnique.mockResolvedValue(null);
      const result = await mod.bumpSectionHash("pb-1", "welcome", { line: "hi" });
      expect(result.changed).toBe(true);
      expect(mockPrisma.playbookSectionStaleness.create).toHaveBeenCalledWith({
        data: { playbookId: "pb-1", sectionKey: "welcome", sectionHash: result.sectionHash },
      });
      expect(mockPrisma.playbookSectionStaleness.update).not.toHaveBeenCalled();
    });

    it("is a no-op when the hash is unchanged (idempotent)", async () => {
      const hash = mod.hashSectionInputs({ line: "hi" });
      mockPrisma.playbookSectionStaleness.findUnique.mockResolvedValue({
        id: "row-1",
        sectionHash: hash,
      });
      const result = await mod.bumpSectionHash("pb-1", "welcome", { line: "hi" });
      expect(result.changed).toBe(false);
      expect(result.sectionHash).toBe(hash);
      expect(mockPrisma.playbookSectionStaleness.update).not.toHaveBeenCalled();
      expect(mockPrisma.playbookSectionStaleness.create).not.toHaveBeenCalled();
    });

    it("updates sectionHash + staleSince when inputs change", async () => {
      mockPrisma.playbookSectionStaleness.findUnique.mockResolvedValue({
        id: "row-1",
        sectionHash: "deadbeefdeadbeef",
      });
      const result = await mod.bumpSectionHash("pb-1", "welcome", { line: "new" });
      expect(result.changed).toBe(true);
      expect(mockPrisma.playbookSectionStaleness.update).toHaveBeenCalledWith({
        where: { id: "row-1" },
        data: { sectionHash: result.sectionHash, staleSince: expect.any(Date) },
      });
    });

    it("does NOT touch Playbook.composeInputsUpdatedAt (separate clocks)", async () => {
      await mod.bumpSectionHash("pb-1", "welcome", { line: "hi" });
      expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
    });

    it("no-ops on empty playbookId", async () => {
      const result = await mod.bumpSectionHash("", "welcome", { line: "hi" });
      expect(result).toEqual({ changed: false, sectionHash: "" });
      expect(mockPrisma.playbookSectionStaleness.findUnique).not.toHaveBeenCalled();
    });

    it("no-ops on empty sectionKey", async () => {
      const result = await mod.bumpSectionHash(
        "pb-1",
        "" as Parameters<typeof mod.bumpSectionHash>[1],
        { line: "hi" },
      );
      expect(result).toEqual({ changed: false, sectionHash: "" });
      expect(mockPrisma.playbookSectionStaleness.findUnique).not.toHaveBeenCalled();
    });

    it("only bumps the requested section (welcome) — onboarding row untouched", async () => {
      mockPrisma.playbookSectionStaleness.findUnique.mockImplementation(
        async ({ where }: { where: { playbookId_sectionKey: { sectionKey: string } } }) => {
          if (where.playbookId_sectionKey.sectionKey === "welcome") return null;
          // Onboarding row shouldn't even be queried — assertion below verifies.
          return null;
        },
      );
      await mod.bumpSectionHash("pb-1", "welcome", { line: "hi" });
      expect(mockPrisma.playbookSectionStaleness.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.playbookSectionStaleness.findUnique).toHaveBeenCalledWith({
        where: { playbookId_sectionKey: { playbookId: "pb-1", sectionKey: "welcome" } },
        select: { id: true, sectionHash: true },
      });
    });

    it("runs against a supplied tx client when provided", async () => {
      const tx = {
        playbookSectionStaleness: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Parameters<typeof mod.bumpSectionHash>[3];
      await mod.bumpSectionHash("pb-1", "welcome", { line: "hi" }, tx);
      // Top-level prisma was NOT touched.
      expect(mockPrisma.playbookSectionStaleness.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.playbookSectionStaleness.create).not.toHaveBeenCalled();
    });
  });

  describe("getSectionStaleness — reader", () => {
    it("returns empty + uncapped for unknown playbook", async () => {
      const result = await mod.getSectionStaleness("");
      expect(result).toEqual({ sections: [], capped: false });
    });

    it("returns sections with caller count attached", async () => {
      const now = new Date("2026-06-14T00:00:00Z");
      mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([
        { sectionKey: "welcome", sectionHash: "aaaa1111aaaa1111", staleSince: now },
        { sectionKey: "onboarding", sectionHash: "bbbb2222bbbb2222", staleSince: now },
      ]);
      mockPrisma.callerPlaybook.count.mockResolvedValue(12);

      const result = await mod.getSectionStaleness("pb-1");
      expect(result.capped).toBe(false);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        sectionKey: "welcome",
        sectionHash: "aaaa1111aaaa1111",
        staleSince: now,
        affectedCallerCount: 12,
      });
    });

    it("caps affectedCallerCount at 1000", async () => {
      mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([
        { sectionKey: "welcome", sectionHash: "aaaa", staleSince: new Date() },
      ]);
      mockPrisma.callerPlaybook.count.mockResolvedValue(1001);
      const result = await mod.getSectionStaleness("pb-1");
      expect(result.capped).toBe(true);
      expect(result.sections[0].affectedCallerCount).toBe(1000);
    });

    it("counts only ACTIVE enrollments", async () => {
      await mod.getSectionStaleness("pb-1");
      expect(mockPrisma.callerPlaybook.count).toHaveBeenCalledWith({
        where: { playbookId: "pb-1", status: "ACTIVE" },
        take: 1001,
      });
    });
  });
});
