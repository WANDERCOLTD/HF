/**
 * Tests for Educator Active Calls API:
 *   GET /api/educator/active-calls — List active calls across educator's students
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Returns calls where: caller is LEARNER in educator's cohort,
 *     endedAt is null, createdAt within 2 hours
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
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

describe("GET /api/educator/active-calls", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/active-calls/route");
    GET = mod.GET;
  });

  it("returns active calls with correct shape", async () => {
    mockPrisma.call.findMany.mockResolvedValue([
      {
        id: "call-1",
        createdAt: new Date("2026-02-14T10:00:00Z"),
        caller: {
          id: "student-1",
          name: "Alice",
          cohortMemberships: [{ cohortGroup: { id: "c1", name: "Year 10" } }],
        },
      },
    ]);

    const req = new NextRequest("http://localhost/api/educator/active-calls");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.activeCalls).toHaveLength(1);
    expect(body.activeCalls[0]).toEqual({
      callId: "call-1",
      callerId: "student-1",
      callerName: "Alice",
      classroom: "Year 10",
      classroomId: "c1",
      startedAt: "2026-02-14T10:00:00.000Z",
    });
  });

  it("returns empty array when no active calls", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/educator/active-calls");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.activeCalls).toHaveLength(0);
  });

  it("queries with correct filters", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/educator/active-calls");
    await GET(req);

    expect(mockPrisma.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          caller: expect.objectContaining({
            role: "LEARNER",
          }),
          endedAt: null,
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
          }),
        }),
      })
    );
  });

  it("two-hour orphan guard uses recent cutoff", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);

    const before = Date.now();
    const req = new NextRequest("http://localhost/api/educator/active-calls");
    await GET(req);
    const after = Date.now();

    const callArgs = mockPrisma.call.findMany.mock.calls[0][0];
    const cutoff = callArgs.where.createdAt.gte.getTime();

    // Cutoff should be roughly 2 hours before now
    const twoHoursMs = 2 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - twoHoursMs - 1000);
    expect(cutoff).toBeLessThanOrEqual(after - twoHoursMs + 1000);
  });
});
