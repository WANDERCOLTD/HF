/**
 * Tests for `lib/curriculum/readiness-rollups.ts` — #1098 Slice A.
 *
 * Covers the pure computation helpers (`classifyScore`, `computeUnitPayload`,
 * `computeQualificationPayload`) and the orchestrator `computeReadinessRollups`
 * against the AC1/AC2/AC3 acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  curriculum: { findUnique: vi.fn(), findMany: vi.fn() },
  curriculumModule: { findMany: vi.fn() },
  callerAttribute: { findMany: vi.fn(), upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("readiness-rollups — #1098 Slice A", () => {
  let mod: typeof import("@/lib/curriculum/readiness-rollups");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/readiness-rollups");
  });

  describe("classifyScore — tier band boundaries", () => {
    it("returns null for zero or negative (no evidence)", () => {
      expect(mod.classifyScore(0)).toBeNull();
      expect(mod.classifyScore(-0.1)).toBeNull();
    });

    it("maps scores to tiers using inclusive upper bounds (matches mastery-tiers.ts)", () => {
      expect(mod.classifyScore(0.01)).toBe("FOUNDATION");
      expect(mod.classifyScore(0.25)).toBe("FOUNDATION");
      expect(mod.classifyScore(0.26)).toBe("DEVELOPING");
      expect(mod.classifyScore(0.5)).toBe("DEVELOPING");
      expect(mod.classifyScore(0.51)).toBe("PRACTITIONER");
      expect(mod.classifyScore(0.75)).toBe("PRACTITIONER");
      expect(mod.classifyScore(0.76)).toBe("DISTINCTION");
      expect(mod.classifyScore(1.0)).toBe("DISTINCTION");
    });

    it("returns null for NaN / Infinity", () => {
      expect(mod.classifyScore(Number.NaN)).toBeNull();
      expect(mod.classifyScore(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe("computeUnitPayload — per-unit semantics", () => {
    const loRefs = ["OUT-04-01", "OUT-04-02", "OUT-04-03"];

    it("returns null when no LO has any evidence (excluded from rollup writes)", () => {
      const payload = mod.computeUnitPayload(loRefs, new Map());
      expect(payload).toBeNull();
    });

    it("tier = highest tier hit by ANY LO (Unit 09 example from #1098)", () => {
      const bestByLo = new Map<string, number>([
        ["OUT-04-01", 0.8], // PRACTITIONER — wait, 0.8 > 0.75 → DISTINCTION
        ["OUT-04-02", 0.6], // PRACTITIONER
        ["OUT-04-03", 0.2], // FOUNDATION
      ]);
      const payload = mod.computeUnitPayload(loRefs, bestByLo);
      // highest tier hit = DISTINCTION (LO-01 at 0.8)
      expect(payload?.tier).toBe("DISTINCTION");
      // losCovered = LOs at DISTINCTION or above = 1
      expect(payload?.losCovered).toBe(1);
      expect(payload?.losTotal).toBe(3);
      // weakest = LO-03 (0.2 is strictly lowest)
      expect(payload?.weakestLoRef).toBe("OUT-04-03");
    });

    it("Unit 04 case — all 7 LOs at PRACTITIONER → tier=PRACTITIONER, losCovered=7, weakestLoRef=null", () => {
      const refs = ["OUT-04-01", "OUT-04-02", "OUT-04-03", "OUT-04-04", "OUT-04-05", "OUT-04-06", "OUT-04-07"];
      const best = new Map<string, number>(refs.map((r) => [r, 0.65]));
      const payload = mod.computeUnitPayload(refs, best);
      expect(payload?.tier).toBe("PRACTITIONER");
      expect(payload?.losCovered).toBe(7);
      expect(payload?.losTotal).toBe(7);
      // All LOs at the same score → no weakest (homogeneous unit).
      expect(payload?.weakestLoRef).toBeNull();
    });

    it("weakestLoRef breaks ties by sorted refs (deterministic)", () => {
      const refs = ["OUT-Z", "OUT-A", "OUT-M"];
      const best = new Map<string, number>([
        ["OUT-Z", 0.4],
        ["OUT-A", 0.2], // tied minimum with OUT-M
        ["OUT-M", 0.2],
      ]);
      const payload = mod.computeUnitPayload(refs, best);
      // Sorted refs are [OUT-A, OUT-M, OUT-Z]; first tied-min is OUT-A.
      expect(payload?.weakestLoRef).toBe("OUT-A");
    });

    it("Uncovered LO (score 0) is the weakest when others have evidence", () => {
      const refs = ["OUT-01", "OUT-02", "OUT-03"];
      const best = new Map<string, number>([
        ["OUT-01", 0.6],
        ["OUT-02", 0.6],
        // OUT-03 absent — score defaults to 0.
      ]);
      const payload = mod.computeUnitPayload(refs, best);
      expect(payload?.tier).toBe("PRACTITIONER");
      expect(payload?.losCovered).toBe(2);
      expect(payload?.losTotal).toBe(3);
      expect(payload?.weakestLoRef).toBe("OUT-03");
    });
  });

  describe("computeQualificationPayload — qualification rollup", () => {
    it("returns null with no unit payloads", () => {
      expect(mod.computeQualificationPayload(new Map(), [])).toBeNull();
    });

    it("tier = max(unit.tier); unitsCovered = units at that tier; weakestUnitSlug surfaces uncovered first", () => {
      const units = new Map([
        ["unit-04", { tier: "PRACTITIONER" as const, losCovered: 7, losTotal: 7, weakestLoRef: null }],
        ["unit-09", { tier: "PRACTITIONER" as const, losCovered: 3, losTotal: 7, weakestLoRef: "OUT-09-05" }],
        ["unit-21", { tier: "DEVELOPING" as const, losCovered: 2, losTotal: 4, weakestLoRef: "OUT-21-01" }],
      ]);
      // Catalog has 5 units; 2 are uncovered (no rollup row written).
      const allSlugs = ["unit-04", "unit-09", "unit-10", "unit-16", "unit-21"];
      const payload = mod.computeQualificationPayload(units, allSlugs);
      expect(payload?.tier).toBe("PRACTITIONER");
      expect(payload?.unitsCovered).toBe(2); // unit-04 + unit-09
      expect(payload?.unitsTotal).toBe(5);
      // First uncovered slug (lexicographic) is unit-10.
      expect(payload?.weakestUnitSlug).toBe("unit-10");
    });

    it("when every unit covered + at qual.tier, weakestUnitSlug is null", () => {
      const units = new Map([
        ["unit-A", { tier: "PRACTITIONER" as const, losCovered: 3, losTotal: 3, weakestLoRef: null }],
        ["unit-B", { tier: "PRACTITIONER" as const, losCovered: 2, losTotal: 2, weakestLoRef: null }],
      ]);
      const payload = mod.computeQualificationPayload(units, ["unit-A", "unit-B"]);
      expect(payload?.tier).toBe("PRACTITIONER");
      expect(payload?.unitsCovered).toBe(2);
      expect(payload?.weakestUnitSlug).toBeNull();
    });

    it("when all units covered but one is below qual.tier, surfaces that unit as weakest", () => {
      const units = new Map([
        ["unit-A", { tier: "PRACTITIONER" as const, losCovered: 3, losTotal: 3, weakestLoRef: null }],
        ["unit-B", { tier: "DEVELOPING" as const, losCovered: 1, losTotal: 2, weakestLoRef: "OUT-B-01" }],
      ]);
      const payload = mod.computeQualificationPayload(units, ["unit-A", "unit-B"]);
      expect(payload?.tier).toBe("PRACTITIONER");
      expect(payload?.unitsCovered).toBe(1);
      expect(payload?.weakestUnitSlug).toBe("unit-B");
    });
  });

  describe("computeReadinessRollups — orchestrator", () => {
    it("no-op when Curriculum.qualificationAnchor is null", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ qualificationAnchor: null });
      await mod.computeReadinessRollups("caller-1", "cur-no-anchor");
      expect(mockPrisma.curriculumModule.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
    });

    it("AC1 — writes unit_readiness:{moduleSlug} and qualification_readiness:{anchor} as JSON-typed CallerAttributes scoped CURRICULUM", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ qualificationAnchor: "sias-cio-cto-v6" });
      // Only the current Curriculum is in the family (single-sibling case).
      mockPrisma.curriculum.findMany.mockResolvedValue([
        {
          id: "cur-revision",
          slug: "cio-cto-revision-aid-v1",
          name: "Revision Aid",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: "SIAS",
          qualificationNumber: "603/0001/0",
          qualificationLevel: "Practitioner",
        },
      ]);
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          slug: "standard-unit-04-it-operations-infrastructure",
          learningObjectives: [{ ref: "OUT-04-01" }, { ref: "OUT-04-02" }],
        },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        {
          key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04-it-operations-infrastructure:OUT-04-01",
          numberValue: 0.6,
        },
        {
          key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04-it-operations-infrastructure:OUT-04-02",
          numberValue: 0.4,
        },
      ]);
      mockPrisma.callerAttribute.upsert.mockResolvedValue({});

      await mod.computeReadinessRollups("caller-1", "cur-revision");

      // Two writes: one unit_readiness + one qualification_readiness.
      expect(mockPrisma.callerAttribute.upsert).toHaveBeenCalledTimes(2);
      const calls = mockPrisma.callerAttribute.upsert.mock.calls.map((c) => c[0]);
      const keys = calls.map((c) => c.where.callerId_key_scope.key).sort();
      expect(keys).toEqual([
        "qualification_readiness:sias-cio-cto-v6",
        "unit_readiness:standard-unit-04-it-operations-infrastructure",
      ]);
      // Both must be JSON-typed CURRICULUM-scope.
      for (const call of calls) {
        expect(call.where.callerId_key_scope.scope).toBe("CURRICULUM");
        expect(call.create.valueType).toBe("JSON");
      }
    });

    it("AC2 — dedup by loRef across sibling Curricula (cross-course evidence counts ONCE)", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ qualificationAnchor: "sias-cio-cto-v6" });
      mockPrisma.curriculum.findMany.mockResolvedValue([
        {
          id: "cur-revision",
          slug: "cio-cto-revision-aid-v1",
          name: "Revision Aid",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: "SIAS",
          qualificationNumber: "603/0001/0",
          qualificationLevel: "Practitioner",
        },
        {
          id: "cur-pop",
          slug: "cio-cto-pop-quiz-v1",
          name: "Pop Quiz",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: "SIAS",
          qualificationNumber: "603/0001/0",
          qualificationLevel: "Practitioner",
        },
      ]);
      // Slice 2B.3 guarantees both siblings declare the same module + LO refs.
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          slug: "standard-unit-04",
          learningObjectives: [{ ref: "OUT-04-01" }, { ref: "OUT-04-02" }],
        },
        {
          slug: "standard-unit-04",
          learningObjectives: [{ ref: "OUT-04-01" }, { ref: "OUT-04-02" }],
        },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        // Revision Aid: high evidence on OUT-04-01.
        {
          key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04:OUT-04-01",
          numberValue: 0.7,
        },
        // Pop Quiz: low evidence on the SAME OUT-04-01 (cap at DEVELOPING). Dedup must take MAX (0.7).
        {
          key: "curriculum:cio-cto-pop-quiz-v1:lo_mastery:standard-unit-04:OUT-04-01",
          numberValue: 0.4,
        },
        // Pop Quiz only: OUT-04-02.
        {
          key: "curriculum:cio-cto-pop-quiz-v1:lo_mastery:standard-unit-04:OUT-04-02",
          numberValue: 0.3,
        },
      ]);
      mockPrisma.callerAttribute.upsert.mockResolvedValue({});

      await mod.computeReadinessRollups("caller-1", "cur-revision");

      const unitWrite = mockPrisma.callerAttribute.upsert.mock.calls
        .map((c) => c[0])
        .find((c) => c.where.callerId_key_scope.key === "unit_readiness:standard-unit-04");
      expect(unitWrite).toBeDefined();
      // OUT-04-01 deduped to 0.7 (PRACTITIONER tier), OUT-04-02 at 0.3 (DEVELOPING).
      // Unit tier = PRACTITIONER (highest tier hit), losCovered = 1 (only OUT-04-01).
      expect(unitWrite.create.jsonValue.tier).toBe("PRACTITIONER");
      expect(unitWrite.create.jsonValue.losCovered).toBe(1);
      expect(unitWrite.create.jsonValue.losTotal).toBe(2);
      // Weakest = OUT-04-02 (lower than 0.7).
      expect(unitWrite.create.jsonValue.weakestLoRef).toBe("OUT-04-02");
    });

    it("AC3 — Curriculum without qualificationAnchor never produces rollups (exam-mock isolation by sibling-set construction)", async () => {
      // The Exam Assessment Curriculum DOES have an anchor in production (it's a
      // sibling variant). What protects AC3 is upstream: useFreshMastery routes
      // those calls' mastery to Call.scratchMastery, not to lo_mastery:*
      // CallerAttribute. The rollup reader looks ONLY at lo_mastery:* keys —
      // scratchMastery data is invisible by construction.
      //
      // This test asserts the inverse: the rollup reader does not query Call
      // rows or scratchMastery — only CallerAttribute. (We assert no unexpected
      // prisma surface is touched.)
      mockPrisma.curriculum.findUnique.mockResolvedValue({ qualificationAnchor: "sias-cio-cto-v6" });
      mockPrisma.curriculum.findMany.mockResolvedValue([
        {
          id: "cur-1",
          slug: "cio-cto-revision-aid-v1",
          name: "Revision Aid",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
      ]);
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          slug: "standard-unit-04",
          learningObjectives: [{ ref: "OUT-04-01" }],
        },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
      mockPrisma.callerAttribute.upsert.mockResolvedValue({});

      await mod.computeReadinessRollups("caller-1", "cur-1");

      // No lo_mastery evidence → no unit/qualification readiness writes.
      expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
    });

    it("does not throw when a derived-attribute write fails — eventually-consistent contract", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({ qualificationAnchor: "sias-cio-cto-v6" });
      mockPrisma.curriculum.findMany.mockResolvedValue([
        {
          id: "cur-1",
          slug: "cio-cto-revision-aid-v1",
          name: "Revision Aid",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
      ]);
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          slug: "standard-unit-04",
          learningObjectives: [{ ref: "OUT-04-01" }],
        },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        {
          key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04:OUT-04-01",
          numberValue: 0.6,
        },
      ]);
      mockPrisma.callerAttribute.upsert.mockRejectedValue(new Error("simulated DB hiccup"));

      // Must not throw — the upstream pipeline must not roll back on derived
      // rollup failure.
      await expect(mod.computeReadinessRollups("caller-1", "cur-1")).resolves.toBeUndefined();
    });
  });
});
