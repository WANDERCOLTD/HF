/**
 * Tests for GET /api/cohorts/overview — #760 Phase 1A aggregator.
 *
 * Coverage:
 *  - Auth: requireEntityAccess("cohorts", "R") gate (mocked allow)
 *  - Empty cohorts list → empty rows + zero rollup
 *  - Per-cohort mastery distribution buckets correctly (hi ≥0.7, mid ≥0.5, low <0.5, noData)
 *  - Per-cohort engagement metrics (calledThisWeek, calledPriorWeek, lapsedCount, trend, engagementPct)
 *  - Red-flag heuristic: fires when lapsed >50% OR low-mastery >50% of measured
 *  - Rollup math: totalLearners, activeThisWeek, activeThisWeekPct, avgMastery, redFlagCohorts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: { user: { id: "op1", role: "OPERATOR" } },
    scope: { kind: "ALL" },
  }),
  isEntityAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

const mockPrisma = {
  cohortGroup: { findMany: vi.fn() },
  callerCohortMembership: { findMany: vi.fn() },
  call: { findMany: vi.fn() },
  callerModuleProgress: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

type GetHandler = () => Promise<Response>;
type Row = Record<string, unknown>;

describe("GET /api/cohorts/overview", () => {
  let GET: GetHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/cohorts/overview/route");
    GET = mod.GET as GetHandler;
  });

  function setCohorts(cohorts: Row[]) {
    mockPrisma.cohortGroup.findMany.mockResolvedValue(cohorts);
  }
  function setMemberships(memberships: Row[]) {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue(memberships);
  }
  // First call.findMany call = last 7d; second = prior 7d
  function setCalls(thisWeek: Row[], priorWeek: Row[]) {
    mockPrisma.call.findMany
      .mockResolvedValueOnce(thisWeek)
      .mockResolvedValueOnce(priorWeek);
  }
  function setMastery(rows: Row[]) {
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue(rows);
  }

  it("returns empty rows + zero rollup when no active cohorts", async () => {
    setCohorts([]);
    setMemberships([]);
    // No callers → activity/mastery promises return [] (route short-circuits)

    const res = await GET();
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.cohorts).toEqual([]);
    expect(json.rollup).toMatchObject({
      totalCohorts: 0,
      totalLearners: 0,
      activeThisWeek: 0,
      activeThisWeekPct: 0,
      avgMastery: 0,
      redFlagCohorts: 0,
    });
  });

  it("buckets mastery correctly: hi ≥0.7, mid ≥0.5, low <0.5, noData when no rows", async () => {
    setCohorts([
      {
        id: "c1",
        name: "Cohort A",
        isActive: true,
        domain: { id: "d1", name: "Domain", slug: "domain" },
        _count: { members: 4 },
      },
    ]);
    setMemberships([
      { cohortGroupId: "c1", callerId: "u-hi" },
      { cohortGroupId: "c1", callerId: "u-mid" },
      { cohortGroupId: "c1", callerId: "u-low" },
      { cohortGroupId: "c1", callerId: "u-none" },
    ]);
    setCalls([], []); // no engagement
    setMastery([
      // u-hi: avg 0.85 → hi
      { callerId: "u-hi", mastery: 0.9 },
      { callerId: "u-hi", mastery: 0.8 },
      // u-mid: 0.55 → mid
      { callerId: "u-mid", mastery: 0.55 },
      // u-low: 0.3 → low
      { callerId: "u-low", mastery: 0.3 },
      // u-none has no rows → noData
    ]);

    const res = await GET();
    const json = await res.json();
    const row = json.cohorts[0];

    expect(row.masteryDist).toEqual({ hi: 1, mid: 1, low: 1, noData: 1 });
    expect(row.callerCount).toBe(4);
  });

  it("per-cohort engagement: calledThisWeek, calledPriorWeek, lapsedCount, trend, engagementPct", async () => {
    setCohorts([
      {
        id: "c1",
        name: "Cohort B",
        isActive: true,
        domain: null,
        _count: { members: 10 },
      },
    ]);
    setMemberships(
      ["u1", "u2", "u3", "u4", "u5"].map((u) => ({ cohortGroupId: "c1", callerId: u })),
    );
    setCalls(
      [{ callerId: "u1" }, { callerId: "u2" }, { callerId: "u3" }], // 3 active this week
      [{ callerId: "u1" }, { callerId: "u2" }], // 2 active prior week
    );
    setMastery([]); // no mastery data

    const res = await GET();
    const json = await res.json();
    const row = json.cohorts[0];

    expect(row.callerCount).toBe(5);
    expect(row.calledThisWeek).toBe(3);
    expect(row.calledPriorWeek).toBe(2);
    expect(row.lapsedCount).toBe(2); // 5 - 3
    expect(row.trend).toBe(1); // 3 - 2 = engagement improving
    expect(row.engagementPct).toBe(60); // 3/5
  });

  it("red flag fires when lapsed > 50%", async () => {
    setCohorts([
      { id: "c1", name: "Lapsing", isActive: true, domain: null, _count: { members: 4 } },
    ]);
    setMemberships(
      ["a", "b", "c", "d"].map((u) => ({ cohortGroupId: "c1", callerId: u })),
    );
    setCalls([{ callerId: "a" }], []); // only 1 of 4 active → 3 lapsed (75%)
    setMastery([]);

    const res = await GET();
    const json = await res.json();
    expect(json.cohorts[0].redFlag).toBe(true);
    expect(json.rollup.redFlagCohorts).toBe(1);
  });

  it("red flag fires when low-mastery > 50% of measured learners", async () => {
    setCohorts([
      { id: "c1", name: "Struggling", isActive: true, domain: null, _count: { members: 4 } },
    ]);
    setMemberships(
      ["a", "b", "c", "d"].map((u) => ({ cohortGroupId: "c1", callerId: u })),
    );
    // All active (so lapsed rule doesn't fire)
    setCalls(
      ["a", "b", "c", "d"].map((id) => ({ callerId: id })),
      [],
    );
    // 3 of 4 measured at low mastery (a=0.3, b=0.2, c=0.4), 1 at hi (d=0.9)
    setMastery([
      { callerId: "a", mastery: 0.3 },
      { callerId: "b", mastery: 0.2 },
      { callerId: "c", mastery: 0.4 },
      { callerId: "d", mastery: 0.9 },
    ]);

    const res = await GET();
    const json = await res.json();
    expect(json.cohorts[0].masteryDist).toEqual({ hi: 1, mid: 0, low: 3, noData: 0 });
    // 3 low / 4 measured = 75% > 50% → red flag
    expect(json.cohorts[0].redFlag).toBe(true);
  });

  it("rollup: totalLearners is the deduped set across cohorts; activeThisWeek is the deduped set of active callers", async () => {
    setCohorts([
      { id: "c1", name: "A", isActive: true, domain: null, _count: { members: 3 } },
      { id: "c2", name: "B", isActive: true, domain: null, _count: { members: 3 } },
    ]);
    // u2 belongs to BOTH cohorts — must only count once in totalLearners
    setMemberships([
      { cohortGroupId: "c1", callerId: "u1" },
      { cohortGroupId: "c1", callerId: "u2" },
      { cohortGroupId: "c2", callerId: "u2" },
      { cohortGroupId: "c2", callerId: "u3" },
    ]);
    setCalls([{ callerId: "u1" }, { callerId: "u2" }], []);
    setMastery([]);

    const res = await GET();
    const json = await res.json();
    expect(json.rollup.totalCohorts).toBe(2);
    expect(json.rollup.totalLearners).toBe(3); // deduped: {u1, u2, u3}
    expect(json.rollup.activeThisWeek).toBe(2); // {u1, u2}
    expect(json.rollup.activeThisWeekPct).toBe(67); // 2/3 ≈ 66.67 → rounded 67
  });

  it("rollup avgMastery averages per-caller means (not per-row)", async () => {
    setCohorts([
      { id: "c1", name: "A", isActive: true, domain: null, _count: { members: 2 } },
    ]);
    setMemberships([
      { cohortGroupId: "c1", callerId: "u1" },
      { cohortGroupId: "c1", callerId: "u2" },
    ]);
    setCalls([], []);
    setMastery([
      // u1: avg 0.5
      { callerId: "u1", mastery: 0.4 },
      { callerId: "u1", mastery: 0.6 },
      // u2: avg 0.9
      { callerId: "u2", mastery: 0.9 },
    ]);

    const res = await GET();
    const json = await res.json();
    // Per-caller means: u1=0.5, u2=0.9 → avg = 0.7
    expect(json.rollup.avgMastery).toBeCloseTo(0.7, 5);
  });

  it("trend negative = falling engagement (this week < prior)", async () => {
    setCohorts([
      { id: "c1", name: "Falling", isActive: true, domain: null, _count: { members: 5 } },
    ]);
    setMemberships(
      ["a", "b", "c", "d", "e"].map((u) => ({ cohortGroupId: "c1", callerId: u })),
    );
    setCalls(
      [{ callerId: "a" }, { callerId: "b" }], // 2 active this week
      ["a", "b", "c", "d"].map((id) => ({ callerId: id })), // 4 active prior week
    );
    setMastery([]);

    const res = await GET();
    const json = await res.json();
    expect(json.cohorts[0].trend).toBe(-2); // 2 - 4
  });

  it("empty cohort (no callers): no calls/mastery queries fired; redFlag=false", async () => {
    setCohorts([
      { id: "c1", name: "Brand new", isActive: true, domain: null, _count: { members: 0 } },
    ]);
    setMemberships([]);
    // route guards: `allCallerIdsArr.length ? prisma...` short-circuits to []
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);

    const res = await GET();
    const json = await res.json();
    expect(json.cohorts[0].callerCount).toBe(0);
    expect(json.cohorts[0].redFlag).toBe(false);
    // Critical: route does NOT spam prisma when caller set is empty
    expect(mockPrisma.call.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
  });
});
