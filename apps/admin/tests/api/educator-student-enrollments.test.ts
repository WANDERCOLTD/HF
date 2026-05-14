/**
 * Tests for Educator Student Enrollments API:
 *   GET  /api/educator/students/:id/enrollments              — List enrollments
 *   POST /api/educator/students/:id/enrollments              — Enroll in course
 *   PATCH /api/educator/students/:id/enrollments/:enrollmentId — Update status
 *
 * Business rules:
 *   - Requires educator auth + student in educator's cohort
 *   - POST validates playbook belongs to student's domain and is PUBLISHED
 *   - PATCH validates enrollment belongs to the student
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  playbook: {
    findFirst: vi.fn(),
  },
  callerPlaybook: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({ error: { status: 403 } }),
  isAuthError: vi.fn().mockReturnValue(true),
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
  requireEducatorStudentAccess: vi.fn().mockResolvedValue({
    student: {
      id: "student-1",
      name: "Alice Smith",
      email: "alice@test.com",
      createdAt: new Date(),
      cohortGroup: { id: "c1", name: "Year 10", ownerId: "edu-caller-1" },
      domain: { id: "d1", slug: "english", name: "English" },
    },
  }),
}));

const mockGetAllEnrollments = vi.fn();
const mockEnrollCaller = vi.fn();
const mockUnenrollCaller = vi.fn();
const mockPauseEnrollment = vi.fn();
const mockResumeEnrollment = vi.fn();

vi.mock("@/lib/enrollment", () => ({
  getAllEnrollments: (...args: unknown[]) => mockGetAllEnrollments(...args),
  enrollCaller: (...args: unknown[]) => mockEnrollCaller(...args),
  unenrollCaller: (...args: unknown[]) => mockUnenrollCaller(...args),
  pauseEnrollment: (...args: unknown[]) => mockPauseEnrollment(...args),
  resumeEnrollment: (...args: unknown[]) => mockResumeEnrollment(...args),
}));

// =====================================================
// HELPERS
// =====================================================

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

function makeRequest(url = "http://localhost:3000", body?: unknown): NextRequest {
  if (body) {
    return new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(url);
}

// =====================================================
// GET /api/educator/students/:id/enrollments
// =====================================================

describe("GET /api/educator/students/:id/enrollments", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/students/[id]/enrollments/route");
    GET = mod.GET;
  });

  it("returns enrollments for a student", async () => {
    const mockEnrollments = [
      {
        id: "enr-1",
        callerId: "student-1",
        playbookId: "pb-1",
        status: "ACTIVE",
        enrolledAt: new Date(),
        playbook: { id: "pb-1", name: "English 101", status: "PUBLISHED", domainId: "d1" },
      },
    ];
    mockGetAllEnrollments.mockResolvedValue(mockEnrollments);

    const res = await GET(makeRequest(), makeParams({ id: "student-1" }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollments).toHaveLength(1);
    expect(data.enrollments[0].status).toBe("ACTIVE");
    expect(mockGetAllEnrollments).toHaveBeenCalledWith("student-1");
  });

  it("returns 403 for student not in educator's cohort", async () => {
    const { requireEducatorStudentAccess } = await import("@/lib/educator-access");
    vi.mocked(requireEducatorStudentAccess).mockResolvedValueOnce({
      error: new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403 }),
    } as any);

    const res = await GET(makeRequest(), makeParams({ id: "other-student" }));
    expect(res.status).toBe(403);
  });
});

// =====================================================
// POST /api/educator/students/:id/enrollments
// =====================================================

describe("POST /api/educator/students/:id/enrollments", () => {
  let POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/students/[id]/enrollments/route");
    POST = mod.POST;
  });

  it("enrolls student in a PUBLISHED domain playbook", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      domain: { id: "d1" },
    });
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "English 101",
    });
    mockEnrollCaller.mockResolvedValue({
      id: "enr-new",
      callerId: "student-1",
      playbookId: "pb-1",
      status: "ACTIVE",
    });

    const req = makeRequest("http://localhost:3000", { playbookId: "pb-1" });
    const res = await POST(req, makeParams({ id: "student-1" }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollment.status).toBe("ACTIVE");
    expect(mockEnrollCaller).toHaveBeenCalledWith("student-1", "pb-1", "educator");
    expect(mockPrisma.playbook.findFirst).toHaveBeenCalledWith({
      where: { id: "pb-1", domainId: "d1", status: "PUBLISHED" },
      select: { id: true, name: true },
    });
  });

  it("returns 400 when playbookId is missing", async () => {
    const req = makeRequest("http://localhost:3000", {});
    const res = await POST(req, makeParams({ id: "student-1" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("playbookId");
  });

  it("returns 400 when playbook is not in student's domain", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      domain: { id: "d1" },
    });
    mockPrisma.playbook.findFirst.mockResolvedValue(null);

    const req = makeRequest("http://localhost:3000", { playbookId: "pb-other" });
    const res = await POST(req, makeParams({ id: "student-1" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("not found");
  });
});

// =====================================================
// PATCH /api/educator/students/:id/enrollments/:enrollmentId
// =====================================================

describe("PATCH /api/educator/students/:id/enrollments/:enrollmentId", () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string; enrollmentId: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/students/[id]/enrollments/[enrollmentId]/route");
    PATCH = mod.PATCH;
  });

  it("pauses an active enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      callerId: "student-1",
      playbookId: "pb-1",
    });
    mockPauseEnrollment.mockResolvedValue({
      id: "enr-1",
      status: "PAUSED",
    });

    const req = new NextRequest("http://localhost:3000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });
    const res = await PATCH(req, makeParams({ id: "student-1", enrollmentId: "enr-1" }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollment.status).toBe("PAUSED");
    expect(mockPauseEnrollment).toHaveBeenCalledWith("student-1", "pb-1");
  });

  it("resumes a paused enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      callerId: "student-1",
      playbookId: "pb-1",
    });
    mockResumeEnrollment.mockResolvedValue({
      id: "enr-1",
      status: "ACTIVE",
    });

    const req = new NextRequest("http://localhost:3000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    const res = await PATCH(req, makeParams({ id: "student-1", enrollmentId: "enr-1" }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollment.status).toBe("ACTIVE");
  });

  it("drops an enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      callerId: "student-1",
      playbookId: "pb-1",
    });
    mockUnenrollCaller.mockResolvedValue({
      id: "enr-1",
      status: "DROPPED",
    });

    const req = new NextRequest("http://localhost:3000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DROPPED" }),
    });
    const res = await PATCH(req, makeParams({ id: "student-1", enrollmentId: "enr-1" }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollment.status).toBe("DROPPED");
  });

  it("returns 404 when enrollment doesn't belong to student", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      callerId: "other-student",
      playbookId: "pb-1",
    });

    const req = new NextRequest("http://localhost:3000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });
    const res = await PATCH(req, makeParams({ id: "student-1", enrollmentId: "enr-1" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status", async () => {
    const req = new NextRequest("http://localhost:3000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INVALID" }),
    });
    const res = await PATCH(req, makeParams({ id: "student-1", enrollmentId: "enr-1" }));
    expect(res.status).toBe(400);
  });
});
