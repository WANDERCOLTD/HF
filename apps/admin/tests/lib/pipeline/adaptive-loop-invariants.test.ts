/**
 * Adaptive Loop invariant runner — Slice 1 of epic #1510 (#1511).
 *
 * Defends the structural contract documented in `docs/CHAIN-CONTRACTS.md` §6.
 *
 * Coverage:
 *   - I-AL1 fires when real-engine + transcript >= 200 + zero memories
 *   - I-AL1 doesn't fire when engine=mock (per route.ts:1029-1031 carve-out)
 *   - I-AL1 doesn't fire when transcript < 200
 *   - I-AL1 doesn't fire when memories were created
 *   - I-AL2 fires when CallScore exists in 6h window but CallerTarget.currentScore is null
 *   - I-AL2 doesn't fire when no CallScore rows
 *   - I-AL2 doesn't fire when CallerTarget.currentScore is non-null
 *   - I-AL2 doesn't fire when CallScore is older than 6h
 *   - I-AL4 cache-hit reason emits INFO not WARN
 *   - I-AL4 actionable reason emits WARN
 *   - I-AL5 escalates to ERROR when systemDefaultsEmpty
 *   - recordInvariantViolation writes through logger.log (AppLog row)
 *   - checkInvariantsAfterPipeline is non-blocking and swallows errors
 *   - checkInvariantsAfterPipeline returns empty array on missing call
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────

const mockCallFindUnique = vi.fn();
const mockCallScoreFindMany = vi.fn();
const mockCallScoreCount = vi.fn();
const mockCallerMemoryCount = vi.fn();
const mockCallerTargetFindUnique = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: { findUnique: (...args: unknown[]) => mockCallFindUnique(...args) },
    callScore: {
      findMany: (...args: unknown[]) => mockCallScoreFindMany(...args),
      count: (...args: unknown[]) => mockCallScoreCount(...args),
    },
    callerMemory: {
      count: (...args: unknown[]) => mockCallerMemoryCount(...args),
    },
    callerTarget: {
      findUnique: (...args: unknown[]) => mockCallerTargetFindUnique(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const mockLog = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

import {
  recordInvariantViolation,
  checkInvariantsAfterPipeline,
  recordIAL3DefaultFallback,
  recordIAL4ProsodySkip,
  recordIAL5ZeroTargets,
  defaultSeverityFor,
  APPLOG_STAGE_FILTER,
  I_AL1_TRANSCRIPT_MIN_CHARS,
} from "@/lib/pipeline/adaptive-loop-invariants";

beforeEach(() => {
  vi.clearAllMocks();
  mockCallerMemoryCount.mockResolvedValue(0);
  mockCallerTargetFindUnique.mockResolvedValue(null);
  mockQueryRaw.mockResolvedValue([]);
  mockCallScoreCount.mockResolvedValue(0);
});

// ── recordInvariantViolation ──────────────────────────────

describe("recordInvariantViolation", () => {
  it("writes via logger.log with stable stage prefix", async () => {
    await recordInvariantViolation({
      invariant: "I-AL1",
      severity: "warn",
      callerId: "caller-1",
      callId: "call-1",
      context: { transcriptLength: 500, memoriesCreated: 0 },
      observedAt: new Date("2026-06-11T00:00:00.000Z"),
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    const [type, stage, data] = mockLog.mock.calls[0];
    expect(type).toBe("system");
    expect(stage).toBe("pipeline.invariant.i-al1");
    expect(data.level).toBe("warn");
    expect(data.event).toBe("I-AL1-violation");
    expect(data.callerId).toBe("caller-1");
    expect(data.callId).toBe("call-1");
    expect(data.transcriptLength).toBe(500);
  });

  it("never throws even if logger throws", async () => {
    mockLog.mockImplementation(() => {
      throw new Error("logger exploded");
    });
    await expect(
      recordInvariantViolation({
        invariant: "I-AL2",
        severity: "warn",
        callerId: "c",
        context: {},
        observedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it("APPLOG_STAGE_FILTER matches every invariant stage", async () => {
    expect(APPLOG_STAGE_FILTER).toBe("pipeline.invariant.");
    for (const id of ["I-AL1", "I-AL2", "I-AL3", "I-AL4", "I-AL5"] as const) {
      await recordInvariantViolation({
        invariant: id,
        severity: defaultSeverityFor(id),
        context: {},
        observedAt: new Date(),
      });
    }
    expect(mockLog).toHaveBeenCalledTimes(5);
    for (const call of mockLog.mock.calls) {
      const [, stage] = call;
      expect(String(stage).startsWith(APPLOG_STAGE_FILTER)).toBe(true);
    }
  });
});

// ── I-AL1 ─────────────────────────────────────────────────

describe("I-AL1 — memory presence on real-engine EXTRACT", () => {
  function setupCall(opts: {
    transcriptLength: number;
    scoredByMarkers: string[];
    memoriesCreated: number;
  }) {
    const transcript = "x".repeat(opts.transcriptLength);
    mockCallFindUnique.mockResolvedValue({
      id: "call-AL1",
      callerId: "caller-AL1",
      transcript,
      createdAt: new Date("2026-06-11T00:00:00.000Z"),
    });
    mockCallScoreFindMany.mockResolvedValue(
      opts.scoredByMarkers.map((sb) => ({ scoredBy: sb })),
    );
    mockCallerMemoryCount.mockResolvedValue(opts.memoriesCreated);
    // I-AL2 path: no skill scores so I-AL2 short-circuits to empty.
    mockQueryRaw.mockResolvedValue([]);
  }

  it("FIRES when real-engine + transcript >= 200 + zero memories", async () => {
    setupCall({
      transcriptLength: 500,
      scoredByMarkers: ["claude_batched_v2"],
      memoriesCreated: 0,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL1");
    const al1 = violations.find((v) => v.invariant === "I-AL1");
    expect(al1).toBeDefined();
    expect(al1?.severity).toBe("warn");
    expect(al1?.callerId).toBe("caller-AL1");
    expect(al1?.callId).toBe("call-AL1");
    expect(al1?.context.transcriptLength).toBe(500);
    expect(al1?.context.memoriesCreated).toBe(0);
    expect(al1?.context.engine).toBe("claude");
  });

  it("does NOT fire when engine=mock", async () => {
    setupCall({
      transcriptLength: 500,
      scoredByMarkers: ["mock_batched_v1"],
      memoriesCreated: 0,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL1");
    expect(violations.find((v) => v.invariant === "I-AL1")).toBeUndefined();
  });

  it("does NOT fire when transcript < I_AL1_TRANSCRIPT_MIN_CHARS", async () => {
    setupCall({
      transcriptLength: I_AL1_TRANSCRIPT_MIN_CHARS - 1,
      scoredByMarkers: ["claude_batched_v2"],
      memoriesCreated: 0,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL1");
    expect(violations.find((v) => v.invariant === "I-AL1")).toBeUndefined();
  });

  it("does NOT fire when memories were created", async () => {
    setupCall({
      transcriptLength: 500,
      scoredByMarkers: ["claude_batched_v2"],
      memoriesCreated: 3,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL1");
    expect(violations.find((v) => v.invariant === "I-AL1")).toBeUndefined();
  });

  it("does NOT fire when classify returns 'unknown' (no CallScore rows)", async () => {
    setupCall({
      transcriptLength: 500,
      scoredByMarkers: [],
      memoriesCreated: 0,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL1");
    expect(violations.find((v) => v.invariant === "I-AL1")).toBeUndefined();
  });
});

// ── I-AL2 ─────────────────────────────────────────────────

describe("I-AL2 — skill score aggregation reaches CallerTarget.currentScore", () => {
  function baseSetup() {
    mockCallFindUnique.mockResolvedValue({
      id: "call-AL2",
      callerId: "caller-AL2",
      transcript: null,
      createdAt: new Date("2026-06-11T00:00:00.000Z"),
    });
    mockCallScoreFindMany.mockResolvedValue([]); // no I-AL1 classification
  }

  it("FIRES when skill CallScore exists in 6h window but CallerTarget.currentScore is null", async () => {
    baseSetup();
    mockQueryRaw.mockResolvedValue([
      {
        parameterId: "skill_speaking",
        callScoreCount: BigInt(4),
        lastScoredAt: new Date(Date.now() - 60_000), // 1 minute ago — well inside 6h
      },
    ]);
    mockCallerTargetFindUnique.mockResolvedValue({
      currentScore: null,
      lastScoredAt: null,
    });

    const violations = await checkInvariantsAfterPipeline("call-AL2");
    const al2 = violations.find((v) => v.invariant === "I-AL2");
    expect(al2).toBeDefined();
    expect(al2?.severity).toBe("warn");
    expect(al2?.parameterId).toBe("skill_speaking");
    expect(al2?.context.callScoreCount).toBe(4);
    expect(al2?.context.callerTargetScore).toBeNull();
  });

  it("does NOT fire when no skill_* CallScore rows", async () => {
    baseSetup();
    mockQueryRaw.mockResolvedValue([]);
    const violations = await checkInvariantsAfterPipeline("call-AL2");
    expect(violations.find((v) => v.invariant === "I-AL2")).toBeUndefined();
  });

  it("does NOT fire when CallerTarget.currentScore is non-null", async () => {
    baseSetup();
    mockQueryRaw.mockResolvedValue([
      {
        parameterId: "skill_listening",
        callScoreCount: BigInt(2),
        lastScoredAt: new Date(),
      },
    ]);
    mockCallerTargetFindUnique.mockResolvedValue({
      currentScore: 0.74,
      lastScoredAt: new Date(),
    });
    const violations = await checkInvariantsAfterPipeline("call-AL2");
    expect(violations.find((v) => v.invariant === "I-AL2")).toBeUndefined();
  });

  it("does NOT fire when last CallScore is older than 6h (drain / migration window)", async () => {
    baseSetup();
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    mockQueryRaw.mockResolvedValue([
      {
        parameterId: "skill_reading",
        callScoreCount: BigInt(1),
        lastScoredAt: sevenHoursAgo,
      },
    ]);
    mockCallerTargetFindUnique.mockResolvedValue({
      currentScore: null,
      lastScoredAt: null,
    });
    const violations = await checkInvariantsAfterPipeline("call-AL2");
    expect(violations.find((v) => v.invariant === "I-AL2")).toBeUndefined();
  });
});

// ── I-AL3 ─────────────────────────────────────────────────

describe("I-AL3 — spec config sourcing default-fallback", () => {
  it("emits INFO via logger.log when SKILL_DEFAULTS fires", async () => {
    await recordIAL3DefaultFallback({
      callerId: "caller-AL3",
      parameterId: "skill_speaking",
      source: "SKILL_DEFAULTS",
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    const [, stage, data] = mockLog.mock.calls[0];
    expect(stage).toBe("pipeline.invariant.i-al3");
    expect(data.level).toBe("info");
    expect(data.event).toBe("I-AL3-default-fallback");
    expect(data.source).toBe("SKILL_DEFAULTS");
  });
});

// ── I-AL4 ─────────────────────────────────────────────────

describe("I-AL4 — PROSODY skip observability", () => {
  it("emits INFO for existing-envelope cache hits (NOT WARN)", async () => {
    await recordIAL4ProsodySkip({
      callId: "call-AL4",
      reason: "existing-envelope",
    });
    const [, stage, data] = mockLog.mock.calls[0];
    expect(stage).toBe("pipeline.invariant.i-al4");
    expect(data.level).toBe("info");
    expect(data.reason).toBe("existing-envelope");
  });

  it("emits WARN for no-stereoUrl", async () => {
    await recordIAL4ProsodySkip({
      callId: "call-AL4",
      reason: "no-stereoUrl",
    });
    const [, , data] = mockLog.mock.calls[0];
    expect(data.level).toBe("warn");
    expect(data.reason).toBe("no-stereoUrl");
  });

  it("emits WARN for no-tierPreset", async () => {
    await recordIAL4ProsodySkip({
      callId: "call-AL4",
      reason: "no-tierPreset",
    });
    expect(mockLog.mock.calls[0][2].level).toBe("warn");
  });

  it("emits WARN for no-provider", async () => {
    await recordIAL4ProsodySkip({
      callId: "call-AL4",
      reason: "no-provider",
    });
    expect(mockLog.mock.calls[0][2].level).toBe("warn");
  });
});

// ── I-AL5 ─────────────────────────────────────────────────

describe("I-AL5 — SCORE_AGENT zero targets", () => {
  it("emits WARN when only the PLAYBOOK cascade is empty", async () => {
    await recordIAL5ZeroTargets({
      playbookId: "pb-1",
      callerId: "c-1",
      systemDefaultsEmpty: false,
    });
    const [, stage, data] = mockLog.mock.calls[0];
    expect(stage).toBe("pipeline.invariant.i-al5");
    expect(data.level).toBe("warn");
    expect(data.playbookId).toBe("pb-1");
    expect(data.scope).toBe("PLAYBOOK");
    expect(data.systemDefaultsEmpty).toBe(false);
  });

  it("escalates to ERROR when SYSTEM defaults are also empty", async () => {
    await recordIAL5ZeroTargets({
      playbookId: "pb-1",
      systemDefaultsEmpty: true,
    });
    const [, , data] = mockLog.mock.calls[0];
    expect(data.level).toBe("error");
    expect(data.systemDefaultsEmpty).toBe(true);
  });
});

// ── I-AL6 ─────────────────────────────────────────────────

describe("I-AL6 — CallScore.analysisSpecId stamped post-EXTRACT (#1539)", () => {
  beforeEach(() => {
    mockCallFindUnique.mockResolvedValue({
      id: "call-AL6",
      callerId: "caller-AL6",
      transcript: "x".repeat(50), // below I-AL1 threshold; isolates AL6
      createdAt: new Date(),
    });
    // Default to no AL2 violations (no skill_* rows in fresh window).
    mockQueryRaw.mockResolvedValue([]);
  });

  it("FIRES WARN when CallScore rows for this call lack analysisSpecId", async () => {
    mockCallScoreCount.mockResolvedValueOnce(3); // 3 rows without lineage
    const v = await checkInvariantsAfterPipeline("call-AL6");
    const al6 = v.find((row) => row.invariant === "I-AL6");
    expect(al6).toBeDefined();
    expect(al6!.severity).toBe("warn");
    expect(al6!.callId).toBe("call-AL6");
    expect(al6!.context.unspeccedCallScoreCount).toBe(3);
    const al6Log = mockLog.mock.calls.find(
      (call: unknown[]) => call[1] === "pipeline.invariant.i-al6",
    );
    expect(al6Log).toBeDefined();
    expect((al6Log![2] as { event: string }).event).toBe(
      "I-AL6-unspecced-callscore",
    );
  });

  it("does NOT fire when every CallScore row has analysisSpecId", async () => {
    mockCallScoreCount.mockResolvedValueOnce(0);
    const v = await checkInvariantsAfterPipeline("call-AL6");
    const al6 = v.find((row) => row.invariant === "I-AL6");
    expect(al6).toBeUndefined();
  });

  it("does NOT fire when count throws (durability — invariant is non-blocking)", async () => {
    mockCallScoreCount.mockRejectedValueOnce(new Error("db gone"));
    const v = await checkInvariantsAfterPipeline("call-AL6");
    const al6 = v.find((row) => row.invariant === "I-AL6");
    expect(al6).toBeUndefined();
  });

  it("defaultSeverityFor(I-AL6) is warn (will promote to error post-drain)", () => {
    expect(defaultSeverityFor("I-AL6")).toBe("warn");
  });
});

// ── checkInvariantsAfterPipeline durability ───────────────

describe("checkInvariantsAfterPipeline — non-blocking", () => {
  it("returns empty array when call not found", async () => {
    mockCallFindUnique.mockResolvedValue(null);
    const v = await checkInvariantsAfterPipeline("missing-call");
    expect(v).toEqual([]);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("returns empty array when call has no callerId", async () => {
    mockCallFindUnique.mockResolvedValue({
      id: "call-x",
      callerId: null,
      transcript: "x".repeat(500),
      createdAt: new Date(),
    });
    const v = await checkInvariantsAfterPipeline("call-x");
    expect(v).toEqual([]);
  });

  it("swallows errors thrown by prisma.call.findUnique", async () => {
    mockCallFindUnique.mockRejectedValue(new Error("DB gone"));
    await expect(
      checkInvariantsAfterPipeline("call-throws"),
    ).resolves.toEqual([]);
  });

  it("swallows errors thrown by $queryRaw inside I-AL2 derivation", async () => {
    mockCallFindUnique.mockResolvedValue({
      id: "c1",
      callerId: "caller-1",
      transcript: null,
      createdAt: new Date(),
    });
    mockCallScoreFindMany.mockResolvedValue([]);
    mockQueryRaw.mockRejectedValue(new Error("query failed"));
    const v = await checkInvariantsAfterPipeline("c1");
    expect(v).toEqual([]);
  });
});
