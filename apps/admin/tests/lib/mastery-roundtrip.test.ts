/**
 * Mastery write→read round-trip — #1599.
 *
 * Pins the contract documented in `.claude/rules/ai-to-db-guard.md`
 * row "mastery-write canonical contract":
 *
 *   - The authoritative read column for per-LO mastery is
 *     `CallerAttribute` with key shape
 *     `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`.
 *   - The read path
 *     `lib/goals/track-progress.ts::deriveLearnGoalProgressFromRef`
 *     returns the canonical value written by the AGGREGATE stage
 *     into that column.
 *   - The strategy key `lo_rollup` is the only valid
 *     `progressStrategy` for LEARN goals tracking per-LO mastery.
 *
 * If a future refactor changes the read path's column or key shape,
 * or removes a `StrategyKey` member, this bank fails before reaching
 * hf_sandbox — closing the divergence pattern that produced the
 * #1554 / #1561 / #1573 / #1552 fix chain on 2026-06-13.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    callerAttribute: { findMany: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
    learningObjective: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("mastery-roundtrip — #1599", () => {
  let trackProgress: typeof import("@/lib/goals/track-progress");
  let StrategyKey: typeof import("@/lib/goals/strategies/types").StrategyKey;
  let ALL_STRATEGY_KEYS: typeof import("@/lib/goals/strategies/types").ALL_STRATEGY_KEYS;

  beforeEach(async () => {
    vi.clearAllMocks();
    trackProgress = await import("@/lib/goals/track-progress");
    const types = await import("@/lib/goals/strategies/types");
    StrategyKey = types.StrategyKey;
    ALL_STRATEGY_KEYS = types.ALL_STRATEGY_KEYS;
  });

  describe("StrategyKey contract", () => {
    it("exports every registered strategy as a const member", () => {
      expect(StrategyKey.skill_ema).toBe("skill_ema");
      expect(StrategyKey.lo_rollup).toBe("lo_rollup");
      expect(StrategyKey.assessment_readiness).toBe("assessment_readiness");
      expect(StrategyKey.connect_warmth_avg).toBe("connect_warmth_avg");
      expect(StrategyKey.manual_only).toBe("manual_only");
    });

    it("`lo_rollup` is the canonical key for LEARN-by-LO goals (defends the #1554 freeze)", () => {
      expect(StrategyKey.lo_rollup).toBe("lo_rollup");
      // The historical uppercase form must NOT be a valid enum value.
      // The alias map handles legacy DB rows; new write sites must use
      // the canonical key.
      expect((StrategyKey as Record<string, string>).LO_MASTERY).toBeUndefined();
    });

    it("ALL_STRATEGY_KEYS reflects the const object (covers ESLint allow-list)", () => {
      const fromObj = Object.values(StrategyKey).sort();
      expect([...ALL_STRATEGY_KEYS].sort()).toEqual(fromObj);
    });
  });

  describe("CallerAttribute → deriveLearnGoalProgressFromRef round-trip", () => {
    it("reads from CallerAttribute (NOT loScoresJson) and returns the written value", async () => {
      // Synthetic LO resolution — one module, one LO ref.
      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "m-1", module: { slug: "module-1" } },
      ]);
      // Authoritative read column: CallerAttribute with canonical key shape.
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        {
          key: "curriculum:LEARN-001:lo_mastery:module-1:OUT-01",
          numberValue: 0.8,
        },
      ]);

      const result = await trackProgress.deriveLearnGoalProgressFromRef(
        "caller-1",
        { ref: "OUT-01", playbookId: "pb-1" },
      );

      expect(result).not.toBeNull();
      expect(result?.progress).toBeCloseTo(0.8, 5);
      expect(result?.touchedModules).toBe(1);
      expect(result?.totalModulesWithRef).toBe(1);
    });

    it("queries the canonical CallerAttribute key shape (`scope=CURRICULUM`, `valueType=NUMBER`, suffix-match on `:lo_mastery:{moduleSlug}:{loRef}`)", async () => {
      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "m-1", module: { slug: "module-1" } },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        {
          key: "curriculum:LEARN-001:lo_mastery:module-1:OUT-01",
          numberValue: 0.5,
        },
      ]);

      await trackProgress.deriveLearnGoalProgressFromRef("caller-1", {
        ref: "OUT-01",
        playbookId: "pb-1",
      });

      const callArgs = mockPrisma.callerAttribute.findMany.mock.calls[0][0];
      expect(callArgs.where.scope).toBe("CURRICULUM");
      expect(callArgs.where.valueType).toBe("NUMBER");
      expect(callArgs.where.validUntil).toBeNull();
      expect(callArgs.where.OR).toEqual([
        { key: { endsWith: ":lo_mastery:module-1:OUT-01" } },
      ]);
    });

    it("means across modules when a ref resolves to multiple LOs (canonical roll-up)", async () => {
      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "m-1", module: { slug: "module-1" } },
        { moduleId: "m-2", module: { slug: "module-2" } },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        {
          key: "curriculum:LEARN-001:lo_mastery:module-1:OUT-01",
          numberValue: 0.8,
        },
        {
          key: "curriculum:LEARN-001:lo_mastery:module-2:OUT-01",
          numberValue: 0.6,
        },
      ]);

      const result = await trackProgress.deriveLearnGoalProgressFromRef(
        "caller-1",
        { ref: "OUT-01", playbookId: "pb-1" },
      );
      expect(result?.progress).toBeCloseTo(0.7, 5);
      expect(result?.touchedModules).toBe(2);
    });

    it("returns null when the ref resolves to zero LOs (no fallback to other columns)", async () => {
      mockPrisma.learningObjective.findMany.mockResolvedValue([]);
      const result = await trackProgress.deriveLearnGoalProgressFromRef(
        "caller-1",
        { ref: "MISSING-99", playbookId: "pb-1" },
      );
      expect(result).toBeNull();
      // No second-source fallback — divergent read columns produced the
      // #1561 fingerprint. The contract is single-source-of-truth.
      expect(mockPrisma.callerAttribute.findMany).not.toHaveBeenCalled();
    });

    it("returns null when the LO resolves but no CallerAttribute row exists (awaiting evidence)", async () => {
      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "m-1", module: { slug: "module-1" } },
      ]);
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
      const result = await trackProgress.deriveLearnGoalProgressFromRef(
        "caller-1",
        { ref: "OUT-01", playbookId: "pb-1" },
      );
      expect(result).toBeNull();
    });
  });
});
