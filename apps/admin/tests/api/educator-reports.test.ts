/**
 * Tests for Educator Reports API:
 *   GET /api/educator/reports — Aggregated analytics across classrooms
 *   GET /api/educator/classrooms/[id]/progress — Cohort progress data
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Optional cohortId filter for reports
 *   - Progress is scoped to owned cohorts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  cohortGroup: {
    findMany: vi.fn(),
  },
  caller: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  call: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
  ROLE_LEVEL: {
    SUPERADMIN: 5,
    ADMIN: 4,
    OPERATOR: 3,
    EDUCATOR: 3,
    SUPER_TESTER: 2,
    TESTER: 1,
    STUDENT: 1,
    DEMO: 0,
    VIEWER: 1,
  },
}));

vi.mock("@/lib/educator-access", () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
    callerId: "edu-caller-1",
    institutionId: null,
  }),
  requireEducatorOrAdmin: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
    callerId: "edu-caller-1",
    institutionId: null,
  }),
  isEducatorAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result
  ),
  requireEducatorCohortOwnership: vi.fn().mockResolvedValue({
    cohort: {
      id: "cohort-1",
      name: "Year 10",
      ownerId: "edu-caller-1",
      domain: { id: "d1", name: "English", slug: "english" },
      _count: { members: 3 },
    },
  }),
}));

// =====================================================
// HELPERS
// =====================================================

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

// =====================================================
// REPORTS
// =====================================================

describe("GET /api/educator/reports", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/reports/route");
    GET = mod.GET;
  });

  it("returns aggregated reports across all classrooms", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([
      { id: "c1", name: "Year 10" },
    ]);

    mockPrisma.caller.count
      .mockResolvedValueOnce(10) // totalStudents
      .mockResolvedValueOnce(6); // activeStudents

    mockPrisma.call.count
      .mockResolvedValueOnce(50) // totalCalls
      .mockResolvedValueOnce(12); // recentCalls

    mockPrisma.call.findMany.mockResolvedValue([]); // callsLast30

    const request = new NextRequest(
      new URL("http://localhost:3000/api/educator/reports"),
      { method: "GET" }
    );

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stats.totalStudents).toBe(10);
    expect(body.stats.totalCalls).toBe(50);
    expect(body.stats.callsThisWeek).toBe(12);
    expect(body.stats.engagementRate).toBe(60); // 6/10 * 100
    expect(body.callsPerDay).toHaveLength(30);
    expect(body.classrooms).toHaveLength(1);
  });

  it("filters by cohortId when provided", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([
      { id: "c1", name: "Year 10" },
    ]);
    mockPrisma.caller.count.mockResolvedValue(0);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.call.findMany.mockResolvedValue([]);

    const request = new NextRequest(
      new URL("http://localhost:3000/api/educator/reports?cohortId=c1"),
      { method: "GET" }
    );

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

// =====================================================
// COHORT PROGRESS
// =====================================================

describe("GET /api/educator/classrooms/[id]/progress", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import(
      "@/app/api/educator/classrooms/[id]/progress/route"
    );
    GET = mod.GET;
  });

  it("returns cohort progress with engagement breakdown", async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      {
        caller: {
          id: "s1",
          name: "Alice",
          role: "LEARNER",
          _count: { calls: 5 },
          calls: [{ createdAt: recentDate }],
        },
      },
      {
        caller: {
          id: "s2",
          name: "Bob",
          role: "LEARNER",
          _count: { calls: 0 },
          calls: [],
        },
      },
    ]);

    const res = await GET(
      new NextRequest(new URL("http://localhost:3000"), { method: "GET" }),
      makeParams({ id: "cohort-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.engagement.total).toBe(2);
    expect(body.engagement.notStarted).toBe(1); // Bob
    expect(body.engagement.active).toBe(1); // Alice (recent call)
    expect(body.callsPerDay).toHaveLength(30);
    expect(body.perStudent).toHaveLength(2);
    expect(body.summary.totalCalls).toBe(5);
  });
});
