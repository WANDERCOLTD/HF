/**
 * Tests for Student Calls API:
 *   GET /api/student/calls — Call history for a student
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  call: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/student-access", () => ({
  requireStudent: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

describe("GET /api/student/calls", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/calls/route");
    GET = mod.GET;
  });

  it("returns call list for authenticated student", async () => {
    mockPrisma.call.findMany.mockResolvedValue([
      {
        id: "call-1",
        createdAt: new Date("2026-02-14T10:00:00Z"),
        endedAt: new Date("2026-02-14T10:15:00Z"),
        caller: { domain: { name: "English" } },
      },
      {
        id: "call-2",
        createdAt: new Date("2026-02-13T09:00:00Z"),
        endedAt: null,
        caller: { domain: null },
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.calls).toHaveLength(2);
    expect(body.calls[0].id).toBe("call-1");
    expect(body.calls[0].domain).toBe("English");
    expect(body.calls[1].domain).toBeNull();
  });

  it("returns empty list when no calls exist", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.calls).toHaveLength(0);
  });
});
