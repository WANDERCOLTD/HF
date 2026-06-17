/**
 * #1750 T12 — cloneDemoCaller helper pins.
 *
 *   - `fresh` always creates new
 *   - `return` finds existing clone via (sourceCallerId, testerEmail) lineage
 *   - `return` falls through to `fresh` when no prior clone
 *   - profile:* CallerAttribute rows copied from source
 *   - Lineage markers (sourceCallerId, testerEmail, createdAt) written
 *   - Throws on missing args
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/fake-names", () => ({
  randomFakeName: vi.fn(() => "Test Name"),
}));

vi.mock("@/lib/enrollment", () => ({
  enrollCaller: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enrollment/instantiate-goals", () => ({
  instantiatePlaybookGoals: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enrollment/instantiate-targets", () => ({
  instantiatePlaybookTargets: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enrollment/instantiate-module-progress", () => ({
  instantiatePlaybookModuleProgress: vi.fn(async () => ({})),
}));

import {
  cloneDemoCaller,
  TEST_HARNESS_SCOPE,
  TEST_HARNESS_KEYS,
} from "@/lib/test-harness/clone-demo-caller";

const SOURCE_ID = "caller-source";
const PLAYBOOK_ID = "playbook-1";
const TESTER = "paul@example.com";

function makePrisma(opts: {
  /** Pass `null` (explicitly) to simulate source-not-found. Omit for default. */
  sourceCaller?: { id: string; name: string | null; domainId: string | null } | null;
  sourceProfileAttrs?: Array<Record<string, unknown>>;
  existingSourceMatches?: Array<{ callerId: string }>;
  existingTesterMatches?: Array<{ callerId: string; updatedAt: Date }>;
  existingClone?: { id: string; name: string | null };
} = {}) {
  // Distinguish "explicit null" from "key omitted" — the test for
  // `source caller not found` passes `null` and expects findUnique to
  // return null (not the default Source Caller).
  const sourceCallerProvided = "sourceCaller" in opts;
  const createdCallers: Array<Record<string, unknown>> = [];
  const createdAttrs: Array<Record<string, unknown>> = [];

  return {
    caller: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === SOURCE_ID) {
          if (sourceCallerProvided) return opts.sourceCaller;
          return { id: SOURCE_ID, name: "Source Caller", domainId: "dom-1" };
        }
        if (opts.existingClone && where.id === opts.existingClone.id) {
          return opts.existingClone;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `new-caller-${createdCallers.length}`, ...data };
        createdCallers.push(created);
        return created;
      }),
    },
    callerAttribute: {
      findMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          // Return matchers based on the query shape.
          if (where.key === TEST_HARNESS_KEYS.sourceCallerId) {
            return opts.existingSourceMatches ?? [];
          }
          if (where.key === TEST_HARNESS_KEYS.testerEmail) {
            return opts.existingTesterMatches ?? [];
          }
          if (
            (where.key as { startsWith?: string } | undefined)?.startsWith === "profile:"
          ) {
            return opts.sourceProfileAttrs ?? [];
          }
          return [];
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `attr-${createdAttrs.length}`, ...data };
        createdAttrs.push(created);
        return created;
      }),
    },
    playbook: { findUnique: vi.fn() },
    _captures: { createdCallers, createdAttrs },
  };
}

describe("cloneDemoCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("throws on empty sourceCallerId", async () => {
      const prisma = makePrisma();
      await expect(
        cloneDemoCaller(prisma as never, {
          sourceCallerId: "",
          playbookId: PLAYBOOK_ID,
          testerEmail: TESTER,
          mode: "fresh",
        }),
      ).rejects.toThrow(/sourceCallerId is required/);
    });

    it("throws on empty playbookId", async () => {
      const prisma = makePrisma();
      await expect(
        cloneDemoCaller(prisma as never, {
          sourceCallerId: SOURCE_ID,
          playbookId: "",
          testerEmail: TESTER,
          mode: "fresh",
        }),
      ).rejects.toThrow(/playbookId is required/);
    });

    it("throws on empty testerEmail", async () => {
      const prisma = makePrisma();
      await expect(
        cloneDemoCaller(prisma as never, {
          sourceCallerId: SOURCE_ID,
          playbookId: PLAYBOOK_ID,
          testerEmail: "",
          mode: "fresh",
        }),
      ).rejects.toThrow(/testerEmail is required/);
    });

    it("throws when source caller not found", async () => {
      const prisma = makePrisma({ sourceCaller: null });
      await expect(
        cloneDemoCaller(prisma as never, {
          sourceCallerId: SOURCE_ID,
          playbookId: PLAYBOOK_ID,
          testerEmail: TESTER,
          mode: "fresh",
        }),
      ).rejects.toThrow(/not found/);
    });

    it("throws when source caller has no domainId", async () => {
      const prisma = makePrisma({
        sourceCaller: { id: SOURCE_ID, name: "S", domainId: null },
      });
      await expect(
        cloneDemoCaller(prisma as never, {
          sourceCallerId: SOURCE_ID,
          playbookId: PLAYBOOK_ID,
          testerEmail: TESTER,
          mode: "fresh",
        }),
      ).rejects.toThrow(/no domainId/);
    });
  });

  describe("fresh mode", () => {
    it("creates a new caller + writes lineage markers + isNew=true", async () => {
      const prisma = makePrisma();
      const result = await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "fresh",
      });
      expect(result.isNew).toBe(true);
      expect(result.sourceCallerId).toBe(SOURCE_ID);
      expect(result.callerId).toMatch(/^new-caller-/);
      expect(prisma.caller.create).toHaveBeenCalledTimes(1);
      // 3 lineage markers written (sourceCallerId, testerEmail, createdAt)
      const lineageWrites = prisma._captures.createdAttrs.filter(
        (a) => a.scope === TEST_HARNESS_SCOPE,
      );
      expect(lineageWrites.length).toBe(3);
      expect(
        lineageWrites.find((a) => a.key === TEST_HARNESS_KEYS.sourceCallerId)
          ?.stringValue,
      ).toBe(SOURCE_ID);
      expect(
        lineageWrites.find((a) => a.key === TEST_HARNESS_KEYS.testerEmail)
          ?.stringValue,
      ).toBe(TESTER);
    });

    it("copies source's profile:* CallerAttribute rows", async () => {
      const prisma = makePrisma({
        sourceProfileAttrs: [
          {
            key: "profile:targetBand",
            scope: "GLOBAL",
            domain: null,
            valueType: "NUMBER",
            stringValue: null,
            numberValue: 7.0,
            booleanValue: null,
            jsonValue: null,
          },
          {
            key: "profile:reason",
            scope: "GLOBAL",
            domain: null,
            valueType: "STRING",
            stringValue: "Immigration",
            numberValue: null,
            booleanValue: null,
            jsonValue: null,
          },
        ],
      });
      await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "fresh",
      });
      const profileWrites = prisma._captures.createdAttrs.filter((a) =>
        (a.key as string).startsWith("profile:"),
      );
      expect(profileWrites.length).toBe(2);
      expect(
        profileWrites.find((a) => a.key === "profile:targetBand")?.numberValue,
      ).toBe(7.0);
      expect(
        profileWrites.find((a) => a.key === "profile:reason")?.stringValue,
      ).toBe("Immigration");
    });
  });

  describe("return mode", () => {
    it("returns existing clone when lineage matches", async () => {
      const prisma = makePrisma({
        existingSourceMatches: [{ callerId: "existing-clone-1" }],
        existingTesterMatches: [
          { callerId: "existing-clone-1", updatedAt: new Date() },
        ],
        existingClone: { id: "existing-clone-1", name: "Prior Clone" },
      });
      const result = await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "return",
      });
      expect(result.isNew).toBe(false);
      expect(result.callerId).toBe("existing-clone-1");
      expect(result.callerName).toBe("Prior Clone");
      // No new caller created.
      expect(prisma.caller.create).not.toHaveBeenCalled();
    });

    it("falls through to fresh creation when no prior clone", async () => {
      const prisma = makePrisma({
        existingSourceMatches: [],
        existingTesterMatches: [],
      });
      const result = await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "return",
      });
      expect(result.isNew).toBe(true);
      expect(prisma.caller.create).toHaveBeenCalledTimes(1);
    });

    it("picks the MOST RECENT clone when multiple exist", async () => {
      const older = new Date("2026-06-01T00:00:00Z");
      const newer = new Date("2026-06-15T00:00:00Z");
      const prisma = makePrisma({
        existingSourceMatches: [
          { callerId: "clone-old" },
          { callerId: "clone-new" },
        ],
        existingTesterMatches: [
          { callerId: "clone-new", updatedAt: newer },
          { callerId: "clone-old", updatedAt: older },
        ],
        existingClone: { id: "clone-new", name: "Most Recent" },
      });
      const result = await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "return",
      });
      expect(result.callerId).toBe("clone-new");
    });

    it("falls through to fresh when source matches exist but tester does not", async () => {
      // Different tester took clones of this source — not OUR clone.
      const prisma = makePrisma({
        existingSourceMatches: [{ callerId: "clone-other-tester" }],
        existingTesterMatches: [], // tester filter narrows to zero
      });
      const result = await cloneDemoCaller(prisma as never, {
        sourceCallerId: SOURCE_ID,
        playbookId: PLAYBOOK_ID,
        testerEmail: TESTER,
        mode: "return",
      });
      expect(result.isNew).toBe(true);
    });
  });
});
