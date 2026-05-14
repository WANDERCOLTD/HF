/**
 * Tests for Educator Dashboard API:
 *   GET /api/educator/dashboard — Dashboard stats for an educator
 *
 * Business rules:
 *   - Only accessible to authenticated educators with a TEACHER Caller
 *   - Returns classrooms owned, student counts, recent activity, needs attention
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
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/educator-access", () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
    callerId: "edu-caller-1",
  }),
  isEducatorAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result
  ),
}));

// =====================================================
// TESTS
// =====================================================

describe("GET /api/educator/dashboard", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/dashboard/route");
    GET = mod.GET;
  });

  function makeRequest(params?: Record<string, string>) {
    const url = new URL("http://localhost/api/educator/dashboard");
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    return new NextRequest(url);
  }

  it("returns dashboard stats for authenticated educator", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([
      {
        id: "cohort-1",
        name: "Year 10 English",
        isActive: true,
        domain: { id: "d-1", name: "English", slug: "english" },
        _count: { members: 5 },
        createdAt: new Date(),
      },
    ]);

    mockPrisma.caller.count
      .mockResolvedValueOnce(5) // totalStudents
      .mockResolvedValueOnce(3); // activeStudents

    mockPrisma.call.findMany.mockResolvedValue([
      {
        id: "call-1",
        createdAt: new Date(),
        caller: { id: "s1", name: "Alice" },
      },
    ]);

    mockPrisma.caller.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stats).toBeDefined();
    expect(body.stats.classroomCount).toBe(1);
    expect(body.classrooms).toHaveLength(1);
    expect(body.recentCalls).toHaveLength(1);
  });

  it("returns empty stats when educator has no classrooms", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([]);
    mockPrisma.caller.count.mockResolvedValue(0);
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.caller.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stats.classroomCount).toBe(0);
    expect(body.stats.totalStudents).toBe(0);
    expect(body.classrooms).toHaveLength(0);
  });

  it("returns 403 when educator has no TEACHER caller", async () => {
    const { requireEducator } = await import("@/lib/educator-access");
    const mockRequireEducator = vi.mocked(requireEducator);
    const { NextResponse } = await import("next/server");

    mockRequireEducator.mockResolvedValueOnce({
      error: NextResponse.json(
        { ok: false, error: "No educator profile found." },
        { status: 403 }
      ),
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
  });
});
