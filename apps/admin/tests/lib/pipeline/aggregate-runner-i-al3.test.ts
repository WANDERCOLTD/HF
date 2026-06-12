/**
 * #1513 Slice 3 — I-AL3 emit in aggregate-runner.ts::accumulateSkillScores.
 *
 * The emit fires ONCE per `accumulateSkillScores` invocation when BOTH
 * `halfLifeDays` AND `minCallsToFull` fell through to the SKILL_DEFAULTS
 * constants — i.e. no contract, no playbook config, no rule override
 * supplied either knob.
 *
 * Observability only — does NOT change cascade math. The pure functions
 * `capSkillScoreByCallCount` and `emaSkillScore` are not exercised here
 * (covered in their own tests); this file mocks the DB surface and pins
 * the emit conditions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallScoreFindMany = vi.fn();
const mockCallerTargetFindUnique = vi.fn();
const mockCallerTargetUpsert = vi.fn();
const mockCallerPlaybookFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callScore: { findMany: (...args: unknown[]) => mockCallScoreFindMany(...args) },
    callerTarget: {
      findUnique: (...args: unknown[]) => mockCallerTargetFindUnique(...args),
      upsert: (...args: unknown[]) => mockCallerTargetUpsert(...args),
    },
    callerPlaybook: {
      findFirst: (...args: unknown[]) => mockCallerPlaybookFindFirst(...args),
    },
  },
}));

const mockContractGet = vi.fn();
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    get: (...args: unknown[]) => mockContractGet(...args),
  },
}));

const mockUpdateLearnerProfile = vi.fn();
vi.mock("@/lib/learner/profile", () => ({
  updateLearnerProfile: (...args: unknown[]) => mockUpdateLearnerProfile(...args),
}));

const mockRecordIAL3 = vi.fn();
vi.mock("@/lib/pipeline/adaptive-loop-invariants", () => ({
  recordIAL3DefaultFallback: (...args: unknown[]) => mockRecordIAL3(...args),
}));

import { accumulateSkillScores } from "@/lib/pipeline/aggregate-runner";

beforeEach(() => {
  vi.clearAllMocks();
  mockCallerTargetFindUnique.mockResolvedValue(null); // first-call default
  mockCallerTargetUpsert.mockResolvedValue({});
});

function fixtureScores() {
  return [
    {
      id: "cs-1",
      parameterId: "skill_speaking",
      score: 0.6,
      createdAt: new Date("2026-06-10T12:00:00Z"),
    },
  ];
}

describe("accumulateSkillScores — I-AL3 emit conditions", () => {
  it("emits I-AL3 when neither contract, playbook, nor rule supplies overrides", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce(null); // no SKILL_MEASURE_V1 contract
    mockCallerPlaybookFindFirst.mockResolvedValueOnce(null); // no playbook config

    await accumulateSkillScores("caller-1", {}); // no rule overrides either

    expect(mockRecordIAL3).toHaveBeenCalledTimes(1);
    expect(mockRecordIAL3).toHaveBeenCalledWith({
      callerId: "caller-1",
      source: "SKILL_DEFAULTS",
    });
  });

  it("does NOT emit when rule.config.emaHalfLifeDays is set", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce(null);
    mockCallerPlaybookFindFirst.mockResolvedValueOnce(null);

    // Rule override on halfLifeDays — the source slot moves off "default".
    // (minCallsToFull is still default, so we exercise the AND-gate: BOTH
    // must be default for the emit to fire.)
    await accumulateSkillScores("caller-1", { halfLifeDays: 7 });

    expect(mockRecordIAL3).not.toHaveBeenCalled();
  });

  it("does NOT emit when playbook.config.skillScoringEmaHalfLifeDays is set", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce(null);
    mockCallerPlaybookFindFirst.mockResolvedValueOnce({
      playbook: { config: { skillScoringEmaHalfLifeDays: 21 } },
    });

    await accumulateSkillScores("caller-1", {});

    expect(mockRecordIAL3).not.toHaveBeenCalled();
  });

  it("does NOT emit when playbook.config.skillMinCallsToFull is set", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce(null);
    mockCallerPlaybookFindFirst.mockResolvedValueOnce({
      playbook: { config: { skillMinCallsToFull: 6 } },
    });

    await accumulateSkillScores("caller-1", {});

    expect(mockRecordIAL3).not.toHaveBeenCalled();
  });

  it("does NOT emit when SKILL_MEASURE_V1 contract supplies values", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce({
      config: { emaHalfLifeDays: 30, minCallsToFull: 5 },
    });
    mockCallerPlaybookFindFirst.mockResolvedValueOnce(null);

    await accumulateSkillScores("caller-1", {});

    expect(mockRecordIAL3).not.toHaveBeenCalled();
  });

  it("captures source='SKILL_DEFAULTS' identifier when emitting", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce(fixtureScores());
    mockContractGet.mockResolvedValueOnce(null);
    mockCallerPlaybookFindFirst.mockResolvedValueOnce(null);

    await accumulateSkillScores("caller-with-source", {});

    expect(mockRecordIAL3).toHaveBeenCalledWith(
      expect.objectContaining({ source: "SKILL_DEFAULTS" }),
    );
  });

  it("does NOT emit when no CallScore rows exist (function short-circuits before cascade resolution)", async () => {
    mockCallScoreFindMany.mockResolvedValueOnce([]);
    // Contract / playbook lookups should not even be hit when scores are empty.
    await accumulateSkillScores("caller-1", {});
    expect(mockRecordIAL3).not.toHaveBeenCalled();
  });
});
