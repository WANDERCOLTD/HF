/**
 * #854 / Story #855 — preview the blast radius of a recompose fan-out.
 *
 * Verifies count + sample-name extraction across playbook, domain, and
 * system scopes. Asserts the forward-compat shape (`source: 'live'`) so
 * #860's denormalised-counter swap can flip the field without breaking
 * callers.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerPlaybook: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    playbook: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { previewRecomposeFanout } from "@/lib/recompose/preview";

const cpCount = prisma.callerPlaybook.count as unknown as Mock;
const cpFindMany = prisma.callerPlaybook.findMany as unknown as Mock;
const pbFindMany = prisma.playbook.findMany as unknown as Mock;

beforeEach(() => {
  cpCount.mockReset();
  cpFindMany.mockReset();
  pbFindMany.mockReset();
});

describe("previewRecomposeFanout", () => {
  describe("playbook scope", () => {
    it("returns count + up to 3 first-name samples + eta + live source", async () => {
      cpCount.mockResolvedValue(47);
      cpFindMany.mockResolvedValue([
        { caller: { name: "Mary Smith" } },
        { caller: { name: "Bob Jones" } },
        { caller: { name: "Alice" } },
      ]);

      const result = await previewRecomposeFanout("playbook", "pb-1");

      expect(result).toEqual({
        count: 47,
        sampleNames: ["Mary", "Bob", "Alice"],
        etaSeconds: 94, // 47 * 2, under cap
        cacheHit: false,
        source: "live",
      });
    });

    it("caps eta at 300s for very large counts", async () => {
      cpCount.mockResolvedValue(5_000);
      cpFindMany.mockResolvedValue([]);

      const result = await previewRecomposeFanout("playbook", "pb-1");

      expect(result.etaSeconds).toBe(300);
    });

    it("dedupes duplicate first names in the sample", async () => {
      cpCount.mockResolvedValue(3);
      cpFindMany.mockResolvedValue([
        { caller: { name: "Mary Smith" } },
        { caller: { name: "Mary Jones" } }, // same first name
        { caller: { name: "Bob" } },
      ]);

      const result = await previewRecomposeFanout("playbook", "pb-1");

      expect(result.sampleNames).toEqual(["Mary", "Bob"]);
    });

    it("returns zero shape when scopeId is missing", async () => {
      const result = await previewRecomposeFanout("playbook", null);

      expect(result).toEqual({
        count: 0,
        sampleNames: [],
        etaSeconds: 0,
        cacheHit: false,
        source: "live",
      });
      expect(cpCount).not.toHaveBeenCalled();
    });
  });

  describe("domain scope", () => {
    it("aggregates across all playbooks in the domain", async () => {
      pbFindMany.mockResolvedValue([{ id: "pb-1" }, { id: "pb-2" }]);
      cpCount.mockResolvedValue(120);
      cpFindMany.mockResolvedValue([
        { caller: { name: "Alice Anderson" } },
      ]);

      const result = await previewRecomposeFanout("domain", "d-1");

      expect(result.count).toBe(120);
      expect(result.sampleNames).toEqual(["Alice"]);
      // Verify the IN-clause was constructed correctly
      expect(cpCount).toHaveBeenCalledWith({
        where: { playbookId: { in: ["pb-1", "pb-2"] }, status: "ACTIVE" },
      });
    });

    it("returns zero shape when domain has no playbooks", async () => {
      pbFindMany.mockResolvedValue([]);

      const result = await previewRecomposeFanout("domain", "d-empty");

      expect(result.count).toBe(0);
      expect(cpCount).not.toHaveBeenCalled();
    });
  });

  describe("system scope", () => {
    it("counts distinct callers across all active enrollments", async () => {
      cpFindMany
        .mockResolvedValueOnce([
          { callerId: "c-1" },
          { callerId: "c-2" },
          { callerId: "c-3" },
        ])
        .mockResolvedValueOnce([
          { caller: { name: "Mary" } },
          { caller: { name: "Bob" } },
        ]);

      const result = await previewRecomposeFanout("system", null);

      expect(result.count).toBe(3);
      expect(result.sampleNames).toEqual(["Mary", "Bob"]);
      expect(result.source).toBe("live");
    });

    it("ignores scopeId argument", async () => {
      cpFindMany.mockResolvedValue([]);

      const result = await previewRecomposeFanout("system", "ignored-id");

      expect(result.count).toBe(0);
      // Distinct query is called regardless of scopeId
      expect(cpFindMany).toHaveBeenCalled();
    });
  });

  describe("forward-compat shape", () => {
    it("every response carries source='live' in v1 (flips to 'counter' once #860 ships)", async () => {
      cpCount.mockResolvedValue(1);
      cpFindMany.mockResolvedValue([]);

      const playbook = await previewRecomposeFanout("playbook", "pb-1");
      expect(playbook.source).toBe("live");

      pbFindMany.mockResolvedValue([{ id: "pb-1" }]);
      const domain = await previewRecomposeFanout("domain", "d-1");
      expect(domain.source).toBe("live");

      cpFindMany.mockResolvedValue([]);
      const system = await previewRecomposeFanout("system", null);
      expect(system.source).toBe("live");
    });

    it("cacheHit defaults to false — route layer flips this when serving from cache", async () => {
      cpCount.mockResolvedValue(1);
      cpFindMany.mockResolvedValue([]);

      const result = await previewRecomposeFanout("playbook", "pb-1");
      expect(result.cacheHit).toBe(false);
    });
  });
});
