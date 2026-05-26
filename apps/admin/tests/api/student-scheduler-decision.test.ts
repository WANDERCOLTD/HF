/**
 * Tests for Student Scheduler Decision API:
 *   GET /api/student/scheduler-decision — learner-facing "Why this call" data.
 *
 * #917 Slice 2 — verifies the defensive multi-curriculum guard, the stale
 * check, the sanitization passthrough, and the strict shape of the response
 * (internal scheduler fields must NEVER appear).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerAttribute: { findUnique: vi.fn() },
  callerPlaybook: { count: vi.fn() },
  call: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/student-access", () => ({
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

function makeRequest(): { nextUrl: { searchParams: URLSearchParams } } {
  return { nextUrl: { searchParams: new URLSearchParams() } };
}

describe("GET /api/student/scheduler-decision", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.callerPlaybook.count.mockResolvedValue(1);
    mockPrisma.call.findFirst.mockResolvedValue(null);
    mockPrisma.callerAttribute.findUnique.mockResolvedValue(null);
    const mod = await import("@/app/api/student/scheduler-decision/route");
    GET = mod.GET;
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { requireStudentOrAdmin } = await import("@/lib/student-access");
    const { NextResponse } = await import("next/server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireStudentOrAdmin as any).mockResolvedValueOnce({
      error: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  it("returns { decision: null } when no scheduler attribute exists", async () => {
    mockPrisma.callerAttribute.findUnique.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, decision: null });
  });

  it("returns { decision: null } when caller has 2+ active CallerPlaybook rows (multi-curriculum guard, #919)", async () => {
    mockPrisma.callerPlaybook.count.mockResolvedValue(2);
    mockPrisma.callerAttribute.findUnique.mockResolvedValue({
      jsonValue: {
        mode: "teach",
        reason: "Learning new material on Module 1 - long enough text",
        writtenAt: new Date().toISOString(),
        callsSinceAssess: 1,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    expect(body).toEqual({ ok: true, decision: null });
    // Attribute is NEVER read when the guard fires.
    expect(mockPrisma.callerAttribute.findUnique).not.toHaveBeenCalled();
  });

  it("returns { decision: null } when writtenAt is older than the most recent ended call (stale)", async () => {
    mockPrisma.callerAttribute.findUnique.mockResolvedValue({
      jsonValue: {
        mode: "review",
        reason: "Reviewing weak LOs from earlier this week.",
        writtenAt: "2026-05-01T10:00:00.000Z",
        callsSinceAssess: 2,
      },
    });
    mockPrisma.call.findFirst.mockResolvedValue({
      endedAt: new Date("2026-05-10T12:00:00.000Z"),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    expect(body).toEqual({ ok: true, decision: null });
  });

  it("returns the sanitized decision for the happy path", async () => {
    mockPrisma.callerAttribute.findUnique.mockResolvedValue({
      jsonValue: {
        mode: "review",
        outcomeId: "outcome-internal-123",
        contentSourceId: "content-internal-456",
        workingSetAssertionIds: ["assert-1", "assert-2"],
        reason:
          "Reviewing weak LOs on playbook f17d8616-3c31-4814-8de1-626fb42f16f6 from last call",
        writtenAt: "2026-05-20T10:00:00.000Z",
        callsSinceAssess: 2,
      },
    });
    mockPrisma.call.findFirst.mockResolvedValue({
      endedAt: new Date("2026-05-19T10:00:00.000Z"), // older than writtenAt
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.decision.mode).toBe("review");
    expect(body.decision.callsSinceAssess).toBe(2);
    expect(body.decision.writtenAt).toBe("2026-05-20T10:00:00.000Z");
    expect(body.decision.reason).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(body.decision.reason).toContain("Reviewing weak LOs");
  });

  it("strips internal scheduler fields from the response", async () => {
    mockPrisma.callerAttribute.findUnique.mockResolvedValue({
      jsonValue: {
        mode: "teach",
        outcomeId: "outcome-internal-123",
        contentSourceId: "content-internal-456",
        workingSetAssertionIds: ["assert-1", "assert-2", "assert-3"],
        reason: "Learning new material on Module 2 to build confidence.",
        writtenAt: new Date().toISOString(),
        callsSinceAssess: 0,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("outcomeId");
    expect(serialized).not.toContain("outcome-internal-123");
    expect(serialized).not.toContain("contentSourceId");
    expect(serialized).not.toContain("content-internal-456");
    expect(serialized).not.toContain("workingSetAssertionIds");
    expect(serialized).not.toContain("assert-1");
    expect(Object.keys(body.decision).sort()).toEqual(
      ["callsSinceAssess", "mode", "reason", "writtenAt"].sort(),
    );
  });

  it("returns reason: null when the sanitized reason falls below the useful threshold", async () => {
    mockPrisma.callerAttribute.findUnique.mockResolvedValue({
      jsonValue: {
        mode: "practice",
        reason: "[GUARD-001]", // strips to empty
        writtenAt: new Date().toISOString(),
        callsSinceAssess: 1,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const body = await res.json();
    expect(body.decision.reason).toBeNull();
    expect(body.decision.mode).toBe("practice");
  });
});
