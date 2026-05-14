/**
 * Tests for Educator Classrooms API:
 *   GET  /api/educator/classrooms     — List owned classrooms
 *   POST /api/educator/classrooms     — Create classroom
 *   GET  /api/educator/classrooms/[id] — Classroom detail + roster
 *   PATCH /api/educator/classrooms/[id] — Update classroom settings
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Educators can only see/modify their own classrooms
 *   - Classroom name is required
 *   - Domain must exist to create a classroom
 *   - joinToken is auto-generated on create
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  cohortGroup: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  caller: {
    findMany: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
  },
  call: {
    groupBy: vi.fn(),
  },
  domain: {
    findUnique: vi.fn(),
  },
  playbook: {
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

vi.mock("@/lib/enrollment", () => ({
  assignPlaybookToCohort: vi.fn().mockResolvedValue(undefined),
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

function createGetRequest(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000"), { method: "GET" });
}

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("http://localhost:3000"), {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

// =====================================================
// LIST CLASSROOMS
// =====================================================

describe("GET /api/educator/classrooms", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/classrooms/route");
    GET = mod.GET;
  });

  it("returns list of owned classrooms", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([
      {
        id: "c1",
        name: "Year 10",
        description: null,
        domain: { id: "d1", name: "English", slug: "english" },
        _count: { members: 5 },
        maxMembers: 50,
        isActive: true,
        joinToken: "abc123",
        createdAt: new Date(),
      },
    ]);

    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);
    mockPrisma.call.groupBy.mockResolvedValue([]);

    const res = await GET(createGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.classrooms).toHaveLength(1);
    expect(body.classrooms[0].name).toBe("Year 10");
  });
});

// =====================================================
// CREATE CLASSROOM
// =====================================================

describe("POST /api/educator/classrooms", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/classrooms/route");
    POST = mod.POST;
  });

  it("creates a classroom with valid input", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: "d1",
      name: "English",
    });

    mockPrisma.playbook.findMany.mockResolvedValue([]);

    mockPrisma.cohortGroup.create.mockResolvedValue({
      id: "new-c1",
      name: "Year 10 English",
      description: null,
      domain: { id: "d1", name: "English", slug: "english" },
      _count: { members: 0 },
      joinToken: "xyz789",
      createdAt: new Date(),
    });

    const res = await POST(
      createPostRequest({
        name: "Year 10 English",
        domainId: "d1",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.classroom.name).toBe("Year 10 English");
    expect(body.classroom.joinToken).toBe("xyz789");
  });

  it("returns 400 when name is empty", async () => {
    const res = await POST(
      createPostRequest({ name: "", domainId: "d1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/name/i);
  });

  it("returns 400 when domainId is missing", async () => {
    const res = await POST(
      createPostRequest({ name: "Test Class" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/domain/i);
  });

  it("returns 404 when domain does not exist", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);

    const res = await POST(
      createPostRequest({ name: "Test Class", domainId: "nonexistent" })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

// =====================================================
// CLASSROOM DETAIL
// =====================================================

describe("GET /api/educator/classrooms/[id]", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/classrooms/[id]/route");
    GET = mod.GET;
  });

  it("returns classroom detail with roster", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      {
        caller: {
          id: "s1",
          name: "Alice",
          email: "alice@test.com",
          role: "LEARNER",
          _count: { calls: 3 },
          calls: [{ createdAt: new Date() }],
          createdAt: new Date(),
        },
      },
    ]);

    const res = await GET(createGetRequest(), makeParams({ id: "cohort-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.classroom).toBeDefined();
    expect(body.members).toHaveLength(1);
    expect(body.members[0].name).toBe("Alice");
  });
});

// =====================================================
// UPDATE CLASSROOM
// =====================================================

describe("PATCH /api/educator/classrooms/[id]", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PATCH: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/classrooms/[id]/route");
    PATCH = mod.PATCH;
  });

  it("updates classroom name", async () => {
    mockPrisma.cohortGroup.update.mockResolvedValue({
      id: "cohort-1",
      name: "Year 11 English",
      description: null,
      domain: { id: "d1", name: "English", slug: "english" },
      _count: { members: 3 },
      isActive: true,
    });

    const res = await PATCH(
      createPatchRequest({ name: "Year 11 English" }),
      makeParams({ id: "cohort-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.classroom.name).toBe("Year 11 English");
  });

  it("returns 400 with empty name", async () => {
    const res = await PATCH(
      createPatchRequest({ name: "" }),
      makeParams({ id: "cohort-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 when no updates provided", async () => {
    const res = await PATCH(
      createPatchRequest({}),
      makeParams({ id: "cohort-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no updates/i);
  });
});
