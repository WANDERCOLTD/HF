/**
 * Tests for /api/cohorts endpoint
 *
 * GET: List cohorts with pagination and filters
 * POST: Create a new cohort group
 * GET /api/cohorts/:cohortId: Get cohort detail with members
 * PATCH /api/cohorts/:cohortId: Update cohort
 * DELETE /api/cohorts/:cohortId: Delete cohort
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  cohortGroup: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  domain: {
    findUnique: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: "test-user",
        email: "test@example.com",
        name: "Test User",
        role: "ADMIN",
        image: null,
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    scope: "ALL",
  }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
  buildScopeFilter: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/cohort-access", () => ({
  requireCohortOwnership: vi.fn().mockResolvedValue({
    cohort: {
      id: "cohort-1",
      name: "Test Cohort",
      domainId: "domain-1",
      ownerId: "teacher-1",
      maxMembers: 50,
      isActive: true,
      owner: { id: "teacher-1", name: "Teacher A" },
      domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
      _count: { members: 2 },
    },
  }),
  isCohortOwnershipError: vi.fn().mockReturnValue(false),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/cohorts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // GET /api/cohorts
  // ===================================================
  describe("GET", () => {
    it("should return paginated cohorts", async () => {
      const mockCohorts = [
        {
          id: "cohort-1",
          name: "Year 10 Class",
          description: "GCSE Maths",
          domainId: "domain-1",
          ownerId: "teacher-1",
          maxMembers: 30,
          isActive: true,
          createdAt: new Date("2026-02-01"),
          owner: { id: "teacher-1", name: "Ms Smith", email: "smith@school.com" },
          domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
          _count: { members: 15 },
        },
      ];

      mockPrisma.cohortGroup.findMany.mockResolvedValue(mockCohorts);
      mockPrisma.cohortGroup.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/cohorts/route");
      const request = new Request("http://localhost/api/cohorts?limit=10");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.cohorts).toHaveLength(1);
      expect(data.cohorts[0].name).toBe("Year 10 Class");
      expect(data.cohorts[0]._count.members).toBe(15);
      expect(data.total).toBe(1);
    });

    it("should filter by domainId", async () => {
      mockPrisma.cohortGroup.findMany.mockResolvedValue([]);
      mockPrisma.cohortGroup.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/cohorts/route");
      const request = new Request(
        "http://localhost/api/cohorts?domainId=domain-1"
      );
      await GET(request);

      expect(mockPrisma.cohortGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ domainId: "domain-1" }),
        })
      );
    });
  });

  // ===================================================
  // POST /api/cohorts
  // ===================================================
  describe("POST", () => {
    it("should create a cohort with valid data", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
      });
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "teacher-1",
        role: "TEACHER",
      });
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "teacher-1",
        role: "TEACHER",
      });
      mockPrisma.cohortGroup.create.mockResolvedValue({
        id: "new-cohort",
        name: "My Class",
        description: null,
        domainId: "domain-1",
        ownerId: "teacher-1",
        maxMembers: 50,
        isActive: true,
        owner: { id: "teacher-1", name: "Teacher", email: "t@school.com" },
        domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
        _count: { members: 0 },
      });

      const { POST } = await import("../../app/api/cohorts/route");
      const request = new Request("http://localhost/api/cohorts", {
        method: "POST",
        body: JSON.stringify({
          name: "My Class",
          domainId: "domain-1",
          ownerId: "teacher-1",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.cohort.name).toBe("My Class");
    });

    it("should return 400 if name is missing", async () => {
      const { POST } = await import("../../app/api/cohorts/route");
      const request = new Request("http://localhost/api/cohorts", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Name is required");
    });

    it("should return 400 if owner is not TEACHER or TUTOR", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ id: "domain-1" });
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "learner-1",
        role: "LEARNER",
      });

      const { POST } = await import("../../app/api/cohorts/route");
      const request = new Request("http://localhost/api/cohorts", {
        method: "POST",
        body: JSON.stringify({
          name: "My Class",
          domainId: "domain-1",
          ownerId: "learner-1",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Owner must have TEACHER or TUTOR role");
    });
  });

  // ===================================================
  // GET /api/cohorts/:cohortId
  // ===================================================
  describe("GET /api/cohorts/:cohortId", () => {
    it("should return cohort detail with members", async () => {
      mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
        {
          callerId: "pupil-1",
          cohortGroupId: "cohort-1",
          caller: {
            id: "pupil-1",
            name: "Alice",
            email: "alice@school.com",
            phone: null,
            role: "LEARNER",
            archivedAt: null,
            createdAt: new Date("2026-01-15"),
            _count: { calls: 5, goals: 3, memories: 12 },
          },
        },
      ]);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/route"
      );
      const request = new Request("http://localhost/api/cohorts/cohort-1");
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.cohort.name).toBe("Test Cohort");
      expect(data.members).toHaveLength(1);
      expect(data.members[0].name).toBe("Alice");
      expect(data.members[0]._count.calls).toBe(5);
    });
  });

  // ===================================================
  // PATCH /api/cohorts/:cohortId
  // ===================================================
  describe("PATCH /api/cohorts/:cohortId", () => {
    it("should update cohort name", async () => {
      mockPrisma.cohortGroup.update.mockResolvedValue({
        id: "cohort-1",
        name: "Updated Name",
        description: null,
        domainId: "domain-1",
        ownerId: "teacher-1",
        maxMembers: 50,
        isActive: true,
        owner: { id: "teacher-1", name: "Teacher A", email: "t@school.com" },
        domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
        _count: { members: 2 },
      });

      const { PATCH } = await import(
        "../../app/api/cohorts/[cohortId]/route"
      );
      const request = new Request("http://localhost/api/cohorts/cohort-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Name" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.cohort.name).toBe("Updated Name");
    });
  });

  // ===================================================
  // DELETE /api/cohorts/:cohortId
  // ===================================================
  describe("DELETE /api/cohorts/:cohortId", () => {
    it("should delete cohort and unassign members", async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          caller: { updateMany: vi.fn() },
          cohortGroup: { delete: vi.fn() },
        });
      });

      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/route"
      );
      const request = new Request("http://localhost/api/cohorts/cohort-1", {
        method: "DELETE",
      });
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toBe("Cohort deleted");
    });
  });
});
