/**
 * G5 / #1155 — accumulateSkillScores evidence filter
 *
 * Verifies that the AGGREGATE writer passes `NOT: { hasLearnerEvidence: false }`
 * to the CallScore query so that explicitly-false rows are dropped while null
 * (legacy back-compat) and true both pass through.
 *
 * Spec focus: the Prisma `where` clause shape, not the EMA arithmetic itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock setup ──────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockCallerPlaybookFindFirst = vi.fn().mockResolvedValue(null);
const mockCallerTargetUpsert = vi.fn().mockResolvedValue({});
const mockCallerTargetFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callScore: { findMany: mockFindMany },
    callerTarget: { upsert: mockCallerTargetUpsert, findUnique: mockCallerTargetFindUnique },
    callerPlaybook: { findFirst: mockCallerPlaybookFindFirst },
  },
  db: (tx?: unknown) =>
    tx ?? {
      callScore: { findMany: mockFindMany },
      callerTarget: { upsert: mockCallerTargetUpsert, findUnique: mockCallerTargetFindUnique },
      callerPlaybook: { findFirst: mockCallerPlaybookFindFirst },
    },
}));

// contracts / profile writes are not under test here. #1533 HF-A
// renamed `ContractRegistry.get` → `getContract`; mock the canonical
// method so the contract read returns null cleanly.
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: { getContract: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/lib/learner/profile", () => ({
  updateLearnerProfile: vi.fn().mockResolvedValue(undefined),
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function makeScore(
  id: string,
  parameterId: string,
  score: number,
  hasLearnerEvidence: boolean | null,
) {
  return { id, parameterId, score, createdAt: new Date("2026-06-01") };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("accumulateSkillScores — G5 evidence filter", () => {
  let accumulateSkillScores: typeof import("@/lib/pipeline/aggregate-runner").accumulateSkillScores;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/pipeline/aggregate-runner");
    accumulateSkillScores = mod.accumulateSkillScores;
  });

  it("passes NOT: { hasLearnerEvidence: false } in the Prisma where clause", async () => {
    mockFindMany.mockResolvedValue([]);

    await accumulateSkillScores("caller-abc", {
      parameterPattern: "skill_reading",
      halfLifeDays: 14,
      minCallsToFull: 4,
    });

    expect(mockFindMany).toHaveBeenCalledOnce();
    const [{ where }] = mockFindMany.mock.calls[0];

    // Core assertion: evidence-false rows are excluded at the DB layer
    expect(where).toMatchObject({
      callerId: "caller-abc",
      NOT: { hasLearnerEvidence: false },
    });
  });

  it("does NOT exclude null (legacy back-compat) rows from the filter", async () => {
    // null means legacy writer — should still fold into EMA
    mockFindMany.mockResolvedValue([]);

    await accumulateSkillScores("caller-abc", {
      parameterPattern: "skill_reading",
      halfLifeDays: 14,
      minCallsToFull: 4,
    });

    const [{ where }] = mockFindMany.mock.calls[0];
    // The filter is NOT: { hasLearnerEvidence: false } — which means:
    //   null passes (prisma treats null ≠ false in NOT filter)
    //   true passes
    //   false is excluded
    // We verify the shape does NOT include `hasLearnerEvidence: { not: null }` or similar
    expect(where.NOT).toEqual({ hasLearnerEvidence: false });
    expect(where.hasLearnerEvidence).toBeUndefined();
  });

  it("returns zero scores processed when all rows are filtered (evidence=false universe)", async () => {
    // Prisma returns empty because NOT:{hasLearnerEvidence:false} dropped everything
    mockFindMany.mockResolvedValue([]);

    const result = await accumulateSkillScores("caller-xyz", {
      parameterPattern: "skill_writing",
      halfLifeDays: 14,
      minCallsToFull: 4,
    });

    expect(result.scoresApplied).toBe(0);
    expect(result.paramsProcessed).toBe(0);
  });

  it("folds evidence=true rows into EMA normally", async () => {
    // Two scores, same parameter, evidence=true (Prisma already filtered to these)
    mockFindMany.mockResolvedValue([
      makeScore("s1", "skill_speaking", 0.5, true),
      makeScore("s2", "skill_speaking", 0.7, true),
    ]);

    const result = await accumulateSkillScores("caller-ema", {
      parameterPattern: "skill_speaking",
      halfLifeDays: 14,
      minCallsToFull: 4,
    });

    expect(result.scoresApplied).toBeGreaterThan(0);
    expect(result.paramsProcessed).toBe(1);
  });
});
