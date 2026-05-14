/**
 * Tests for /api/cohorts/:cohortId/dashboard and /api/cohorts/:cohortId/activity
 *
 * Dashboard: Aggregated per-pupil stats (calls, goals, memories, last active)
 * Activity: Recent call feed for cohort members
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findMany: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
  },
  call: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  goal: {
    groupBy: vi.fn(),
  },
  cohortGroup: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: "test-user",
        email: "test@example.com",
        name: "Test User",
        role: "ADMIN",
        image: null,
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    scope: "ALL",
  }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/cohort-access", () => ({
  requireCohortOwnership: vi.fn().mockResolvedValue({
    cohort: {
      id: "cohort-1",
      name: "Test Cohort",
      domainId: "domain-1",
      ownerId: "teacher-1",
      maxMembers: 50,
      isActive: true,
      owner: { id: "teacher-1", name: "Teacher A" },
      domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
      _count: { members: 2 },
    },
  }),
  isCohortOwnershipError: vi.fn().mockReturnValue(false),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/cohorts/:cohortId/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should return dashboard with summary and pupils", async () => {
    // Mock members via join table
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      {
        caller: {
          id: "pupil-1",
          name: "Alice",
          email: "alice@test.com",
          role: "LEARNER",
          createdAt: new Date("2025-01-01"),
          archivedAt: null,
          personality: null,
          _count: { calls: 5, goals: 3, memories: 10 },
        },
      },
      {
        caller: {
          id: "pupil-2",
          name: "Bob",
          email: null,
          role: "LEARNER",
          createdAt: new Date("2025-02-01"),
          archivedAt: null,
          personality: null,
          _count: { calls: 2, goals: 1, memories: 4 },
        },
      },
    ]);

    // Mock recent calls (distinct per caller)
    mockPrisma.call.findMany.mockResolvedValue([
      { callerId: "pupil-1", createdAt: new Date("2026-02-13") },
      { callerId: "pupil-2", createdAt: new Date("2026-01-01") },
    ]);

    // Mock goal stats
    mockPrisma.goal.groupBy.mockResolvedValue([
      { callerId: "pupil-1", status: "ACTIVE", _count: { id: 2 } },
      { callerId: "pupil-1", status: "COMPLETED", _count: { id: 1 } },
      { callerId: "pupil-2", status: "ACTIVE", _count: { id: 1 } },
    ]);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/dashboard/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/dashboard"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.summary).toBeDefined();
    expect(data.summary.memberCount).toBe(2);
    expect(data.summary.totalCalls).toBe(7); // 5 + 2
    expect(data.summary.totalGoals).toBe(4); // 2+1+1
    expect(data.summary.completedGoals).toBe(1);
    expect(data.pupils).toHaveLength(2);
    expect(data.pupils[0].name).toBe("Alice");
    expect(data.pupils[0].callCount).toBe(5);
    expect(data.pupils[0].goals.completed).toBe(1);
    expect(data.pupils[0].goals.active).toBe(2);
  });

  it("should return empty dashboard for cohort with no members", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/dashboard/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/dashboard"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.summary.memberCount).toBe(0);
    expect(data.summary.totalCalls).toBe(0);
    expect(data.pupils).toHaveLength(0);
  });

  it("should compute goalCompletionRate correctly", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      {
        caller: {
          id: "pupil-1",
          name: "Alice",
          email: null,
          role: "LEARNER",
          createdAt: new Date(),
          archivedAt: null,
          personality: null,
          _count: { calls: 10, goals: 4, memories: 0 },
        },
      },
    ]);

    mockPrisma.call.findMany.mockResolvedValue([
      { callerId: "pupil-1", createdAt: new Date() },
    ]);

    mockPrisma.goal.groupBy.mockResolvedValue([
      { callerId: "pupil-1", status: "COMPLETED", _count: { id: 3 } },
      { callerId: "pupil-1", status: "ACTIVE", _count: { id: 1 } },
    ]);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/dashboard/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/dashboard"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.summary.goalCompletionRate).toBe(75); // 3/4 = 75%
  });
});

describe("/api/cohorts/:cohortId/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should return paginated activity feed", async () => {
    // Mock member IDs via join table
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      { callerId: "pupil-1" },
      { callerId: "pupil-2" },
    ]);

    const mockCalls = [
      {
        id: "call-1",
        createdAt: new Date("2026-02-14"),
        source: "vapi",
        callerId: "pupil-1",
        caller: { id: "pupil-1", name: "Alice" },
        _count: { scores: 3, extractedMemories: 2 },
      },
      {
        id: "call-2",
        createdAt: new Date("2026-02-13"),
        source: "sim",
        callerId: "pupil-2",
        caller: { id: "pupil-2", name: "Bob" },
        _count: { scores: 1, extractedMemories: 0 },
      },
    ];

    mockPrisma.call.findMany.mockResolvedValue(mockCalls);
    mockPrisma.call.count.mockResolvedValue(2);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/activity/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/activity?limit=50"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.activity).toHaveLength(2);
    expect(data.activity[0].type).toBe("call");
    expect(data.activity[0].callerName).toBe("Alice");
    expect(data.activity[0].scoreCount).toBe(3);
    expect(data.total).toBe(2);
  });

  it("should return empty activity for cohort with no members", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/activity/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/activity"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.activity).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it("should respect limit parameter", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([{ callerId: "pupil-1" }]);
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);

    const { GET } = await import(
      "../../app/api/cohorts/[cohortId]/activity/route"
    );
    const request = new Request(
      "http://localhost/api/cohorts/cohort-1/activity?limit=10&offset=5"
    );
    const response = await GET(request, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(5);
  });
});
