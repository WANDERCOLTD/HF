/**
 * Tests for Educator Students API:
 *   GET /api/educator/students     — List all students across cohorts
 *   GET /api/educator/students/[id] — Student detail
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Students must belong to educator's owned cohorts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  call: {
    findMany: vi.fn(),
  },
  goal: {
    findMany: vi.fn(),
  },
  callerPersonalityProfile: {
    findUnique: vi.fn(),
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
    error: { status: 403 },
  }),
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

// =====================================================
// HELPERS
// =====================================================

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

// =====================================================
// LIST STUDENTS
// =====================================================

describe("GET /api/educator/students", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/students/route");
    GET = mod.GET;
  });

  it("returns all students across owned cohorts", async () => {
    mockPrisma.caller.findMany.mockResolvedValue([
      {
        id: "s1",
        name: "Alice",
        email: "alice@test.com",
        createdAt: new Date(),
        cohortGroup: { id: "c1", name: "Year 10" },
        _count: { calls: 5 },
        calls: [{ createdAt: new Date() }],
      },
      {
        id: "s2",
        name: "Bob",
        email: "bob@test.com",
        createdAt: new Date(),
        cohortGroup: { id: "c1", name: "Year 10" },
        _count: { calls: 0 },
        calls: [],
      },
    ]);

    const res = await GET(
      new NextRequest(new URL("http://localhost:3000/api/educator/students"), { method: "GET" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.students).toHaveLength(2);
    expect(body.students[0].name).toBe("Alice");
    expect(body.students[0].totalCalls).toBe(5);
    expect(body.students[1].lastCallAt).toBeNull();
  });
});

// =====================================================
// STUDENT DETAIL
// =====================================================

describe("GET /api/educator/students/[id]", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/students/[id]/route");
    GET = mod.GET;
  });

  it("returns student detail with calls and goals", async () => {
    mockPrisma.call.findMany.mockResolvedValue([
      { id: "call-1", createdAt: new Date() },
    ]);

    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        name: "Master Fractions",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0.4,
      },
    ]);

    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);

    const res = await GET(
      new NextRequest(new URL("http://localhost:3000"), { method: "GET" }),
      makeParams({ id: "student-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.student.name).toBe("Alice Smith");
    expect(body.calls).toHaveLength(1);
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0].name).toBe("Master Fractions");
  });

  it("returns 404 when student not found", async () => {
    const { requireEducatorStudentAccess } = await import(
      "@/lib/educator-access"
    );
    const mockAccess = vi.mocked(requireEducatorStudentAccess);
    const { NextResponse } = await import("next/server");

    mockAccess.mockResolvedValueOnce({
      error: NextResponse.json(
        { ok: false, error: "Student not found" },
        { status: 404 }
      ),
    });

    const res = await GET(
      new NextRequest(new URL("http://localhost:3000"), { method: "GET" }),
      makeParams({ id: "nonexistent" })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});
