/**
 * Tests for Student Goals API:
 *   POST /api/student/goals — Create a custom learning goal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  goal: { create: vi.fn() },
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

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/student/goals"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/student/goals", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/goals/route");
    POST = mod.POST;
  });

  it("creates a goal with valid input", async () => {
    mockPrisma.goal.create.mockResolvedValue({
      id: "goal-1",
      name: "Learn fractions",
      type: "LEARN",
      progress: 0,
      description: null,
    });

    const res = await POST(createPostRequest({ name: "Learn fractions" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.goal.name).toBe("Learn fractions");
    expect(body.goal.type).toBe("LEARN");

    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callerId: "stu-caller-1",
          name: "Learn fractions",
          type: "LEARN",
          status: "ACTIVE",
          progress: 0,
        }),
      })
    );
  });

  it("accepts a valid goal type", async () => {
    mockPrisma.goal.create.mockResolvedValue({
      id: "goal-2",
      name: "Build confidence",
      type: "ACHIEVE",
      progress: 0,
      description: null,
    });

    const res = await POST(
      createPostRequest({ name: "Build confidence", type: "ACHIEVE" })
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ACHIEVE" }),
      })
    );
  });

  it("defaults to LEARN for invalid goal type", async () => {
    mockPrisma.goal.create.mockResolvedValue({
      id: "goal-3",
      name: "Something",
      type: "LEARN",
      progress: 0,
      description: null,
    });

    const res = await POST(
      createPostRequest({ name: "Something", type: "INVALID" })
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "LEARN" }),
      })
    );
  });

  it("returns 400 when name is empty", async () => {
    const res = await POST(createPostRequest({ name: "" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/name/i);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(createPostRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns auth error when requireStudentOrAdmin fails", async () => {
    const { requireStudentOrAdmin } = await import("@/lib/student-access");
    const { NextResponse } = await import("next/server");
    (requireStudentOrAdmin as any).mockResolvedValueOnce({
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(createPostRequest({ name: "Test" }));
    expect(res.status).toBe(401);
  });
});
