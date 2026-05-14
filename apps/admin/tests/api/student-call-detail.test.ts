/**
 * Tests for Student Call Detail API:
 *   GET /api/student/calls/:callId — Single call with transcript
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  call: { findUnique: vi.fn() },
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

describe("GET /api/student/calls/:callId", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/calls/[callId]/route");
    GET = mod.GET;
  });

  const makeRequest = (callId: string) => {
    const req = new NextRequest("http://localhost/api/student/calls/" + callId);
    const params = Promise.resolve({ callId });
    return { req, params };
  };

  it("returns call detail for owned call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-1",
      callerId: "stu-caller-1",
      createdAt: new Date("2026-02-14T10:00:00Z"),
      endedAt: new Date("2026-02-14T10:15:00Z"),
      transcript: "Hello, how are you?",
    });

    const { req, params } = makeRequest("call-1");
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.call.id).toBe("call-1");
    expect(body.call.transcript).toBe("Hello, how are you?");
  });

  it("returns 404 for non-existent call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);

    const { req, params } = makeRequest("missing-id");
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Call not found");
  });

  it("returns 404 when call belongs to another student", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-2",
      callerId: "other-caller",
      createdAt: new Date(),
      endedAt: null,
      transcript: "Secret",
    });

    const { req, params } = makeRequest("call-2");
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Call not found");
  });
});
