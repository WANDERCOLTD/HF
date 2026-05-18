/**
 * Tests for lib/goals/strategies/* — #444 spec-driven goal-progress strategies.
 *
 * Covers:
 * - resolveStrategyKey: rule precedence + default fallback
 * - registry: getStrategy returns manual_only for unknown keys
 * - manual_only strategy: always returns null
 * - skill_ema / lo_rollup / assessment_readiness: wrap existing derivers
 * - connect_warmth_avg: uses spec-config-driven thresholds (no hardcoded 0.1)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prisma/client", async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    GoalType: { LEARN: "LEARN", ACHIEVE: "ACHIEVE", CONNECT: "CONNECT", CHANGE: "CHANGE", SUPPORT: "SUPPORT", CREATE: "CREATE" },
    GoalStatus: { ACTIVE: "ACTIVE", COMPLETED: "COMPLETED", PAUSED: "PAUSED", ARCHIVED: "ARCHIVED" },
  };
});

// `vi.mock` factories are hoisted above any top-level `const`. Declare the
// mock prisma inside `vi.hoisted` so it exists when the factory runs.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    callScore: { findMany: vi.fn() },
    analysisSpec: { findFirst: vi.fn() },
    parameter: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/registry", () => ({
  PARAMS: {
    BEH_WARMTH: "BEH-WARMTH",
    BEH_EMPATHY_RATE: "BEH-EMPATHY-RATE",
    BEH_INSIGHT_FREQUENCY: "BEH-INSIGHT-FREQUENCY",
  },
}));

vi.mock("@/lib/curriculum/exam-readiness", () => ({
  computeExamReadiness: vi.fn(),
}));

import {
  resolveStrategyKey,
  loadGoalProgressSpec,
  _resetGoalProgressCache,
  getStrategy,
  registeredKeys,
  type GoalProgressSpec,
} from "@/lib/goals/strategies";

beforeEach(() => {
  vi.clearAllMocks();
  _resetGoalProgressCache();
});

// =====================================================
// resolveStrategyKey — pure function
// =====================================================

describe("resolveStrategyKey", () => {
  const spec: GoalProgressSpec = {
    defaultStrategy: "manual_only",
    rules: [
      { priority: 100, match: { goalType: "ACHIEVE", refPattern: "^SKILL-\\d+$" }, strategy: "skill_ema" },
      { priority: 90, match: { goalType: "LEARN", refPattern: "^(OUT|LO|BAND)-" }, strategy: "lo_rollup" },
      { priority: 80, match: { isAssessmentTarget: true, hasContentSpec: true }, strategy: "assessment_readiness" },
      { priority: 70, match: { goalType: "CONNECT" }, strategy: "connect_warmth_avg" },
    ],
    strategyConfig: {},
  };

  it("matches SKILL-NN ACHIEVE → skill_ema", () => {
    const r = resolveStrategyKey(
      { type: "ACHIEVE" as any, ref: "SKILL-01", contentSpecId: null, isAssessmentTarget: true },
      spec,
    );
    expect(r).toBe("skill_ema");
  });

  it("matches LEARN+OUT-NN → lo_rollup", () => {
    const r = resolveStrategyKey(
      { type: "LEARN" as any, ref: "OUT-03", contentSpecId: null, isAssessmentTarget: false },
      spec,
    );
    expect(r).toBe("lo_rollup");
  });

  it("matches LEARN+BAND-2-GRA → lo_rollup", () => {
    const r = resolveStrategyKey(
      { type: "LEARN" as any, ref: "BAND-2-GRA", contentSpecId: null, isAssessmentTarget: false },
      spec,
    );
    expect(r).toBe("lo_rollup");
  });

  it("matches assessment+contentSpec → assessment_readiness when no SKILL ref", () => {
    const r = resolveStrategyKey(
      { type: "ACHIEVE" as any, ref: null, contentSpecId: "spec-1", isAssessmentTarget: true },
      spec,
    );
    expect(r).toBe("assessment_readiness");
  });

  it("matches CONNECT → connect_warmth_avg", () => {
    const r = resolveStrategyKey(
      { type: "CONNECT" as any, ref: null, contentSpecId: null, isAssessmentTarget: false },
      spec,
    );
    expect(r).toBe("connect_warmth_avg");
  });

  it("falls back to manual_only for caller-expressed ACHIEVE without ref", () => {
    const r = resolveStrategyKey(
      { type: "ACHIEVE" as any, ref: null, contentSpecId: null, isAssessmentTarget: false },
      spec,
    );
    expect(r).toBe("manual_only");
  });

  it("falls back to manual_only for CHANGE / SUPPORT / CREATE", () => {
    for (const t of ["CHANGE", "SUPPORT", "CREATE"] as const) {
      const r = resolveStrategyKey(
        { type: t as any, ref: null, contentSpecId: null, isAssessmentTarget: false },
        spec,
      );
      expect(r).toBe("manual_only");
    }
  });

  it("SKILL-NN ACHIEVE wins over assessment_readiness (priority order)", () => {
    const r = resolveStrategyKey(
      { type: "ACHIEVE" as any, ref: "SKILL-04", contentSpecId: "spec-1", isAssessmentTarget: true },
      spec,
    );
    expect(r).toBe("skill_ema");
  });

  it("uses spec.defaultStrategy when no rules match", () => {
    const noRules: GoalProgressSpec = { defaultStrategy: "manual_only", rules: [], strategyConfig: {} };
    const r = resolveStrategyKey(
      { type: "LEARN" as any, ref: null, contentSpecId: null, isAssessmentTarget: false },
      noRules,
    );
    expect(r).toBe("manual_only");
  });

  it("invalid regex in refPattern is skipped (does not throw)", () => {
    const broken: GoalProgressSpec = {
      defaultStrategy: "manual_only",
      rules: [{ priority: 100, match: { refPattern: "[invalid(" }, strategy: "skill_ema" }],
      strategyConfig: {},
    };
    const r = resolveStrategyKey(
      { type: "ACHIEVE" as any, ref: "SKILL-01", contentSpecId: null, isAssessmentTarget: false },
      broken,
    );
    expect(r).toBe("manual_only");
  });
});

// =====================================================
// loadGoalProgressSpec — DB-backed loader
// =====================================================

describe("loadGoalProgressSpec", () => {
  it("returns empty default when spec is not seeded", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);
    const spec = await loadGoalProgressSpec();
    expect(spec.defaultStrategy).toBe("manual_only");
    expect(spec.rules).toEqual([]);
  });

  it("sorts rules by priority descending", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      config: {
        parameters: [
          {
            id: "goal_progress_strategies",
            config: {
              defaultStrategy: "manual_only",
              rules: [
                { priority: 50, match: {}, strategy: "low" },
                { priority: 100, match: {}, strategy: "high" },
                { priority: 75, match: {}, strategy: "mid" },
              ],
              strategyConfig: {},
            },
          },
        ],
      },
    });
    const spec = await loadGoalProgressSpec();
    expect(spec.rules.map((r) => r.strategy)).toEqual(["high", "mid", "low"]);
  });

  it("falls back to empty default on prisma error", async () => {
    mockPrisma.analysisSpec.findFirst.mockRejectedValue(new Error("db down"));
    const spec = await loadGoalProgressSpec();
    expect(spec.defaultStrategy).toBe("manual_only");
  });
});

// =====================================================
// Strategy registry
// =====================================================

describe("strategy registry", () => {
  it("registers all five strategies", () => {
    const keys = registeredKeys();
    expect(keys).toEqual(
      expect.arrayContaining([
        "skill_ema",
        "lo_rollup",
        "assessment_readiness",
        "connect_warmth_avg",
        "manual_only",
      ]),
    );
  });

  it("unknown strategy key falls back to manual_only", async () => {
    const strategy = getStrategy("nonexistent_strategy");
    const result = await strategy({ id: "g1" } as any, { callerId: "c1", callId: "call-1" });
    expect(result).toBeNull();
  });

  it("manual_only always returns null (no engagement noise)", async () => {
    const strategy = getStrategy("manual_only");
    const result = await strategy(
      { id: "g1", type: "ACHIEVE", progress: 0, ref: null } as any,
      { callerId: "c1", callId: "call-1" },
    );
    expect(result).toBeNull();
  });
});

// =====================================================
// connect_warmth_avg — spec-config-driven, no hardcodes
// =====================================================

describe("connect_warmth_avg strategy", () => {
  it("uses spec-config thresholds (lowBump / highBump configurable)", async () => {
    mockPrisma.callScore.findMany.mockResolvedValue([
      { score: 0.8 }, // > highBumpThreshold (0.7)
    ]);
    const strategy = getStrategy("connect_warmth_avg");
    const result = await strategy(
      { id: "g1", type: "CONNECT", progress: 0 } as any,
      {
        callerId: "c1",
        callId: "call-1",
        strategyConfig: {
          paramKeys: ["warmth"],
          highBumpThreshold: 0.7,
          highBump: 0.20, // ← spec-config override (not hardcoded 0.10)
          lowBumpThreshold: 0.5,
          lowBump: 0.05,
        },
      },
    );
    expect(result?.progressDelta).toBe(0.20);
  });

  it("returns null when avg below lowBumpThreshold", async () => {
    mockPrisma.callScore.findMany.mockResolvedValue([{ score: 0.3 }]);
    const strategy = getStrategy("connect_warmth_avg");
    const result = await strategy(
      { id: "g1" } as any,
      { callerId: "c1", callId: "call-1", strategyConfig: { paramKeys: ["warmth"] } },
    );
    expect(result).toBeNull();
  });

  it("returns null when no scores exist (no engagement-noise fallback)", async () => {
    mockPrisma.callScore.findMany.mockResolvedValue([]);
    const strategy = getStrategy("connect_warmth_avg");
    const result = await strategy(
      { id: "g1" } as any,
      { callerId: "c1", callId: "call-1", strategyConfig: { paramKeys: ["warmth"] } },
    );
    expect(result).toBeNull();
  });
});
