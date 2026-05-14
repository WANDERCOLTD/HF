/**
 * Tests for /api/cohorts/:cohortId/activity endpoint
 *
 * GET: Recent activity feed for a cohort (calls, scores, memories)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
  },
  call: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  cohortGroup: {
    findUnique: vi.fn(),
  },
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

describe("/api/cohorts/:cohortId/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // GET — Activity feed
  // ===================================================
  describe("GET", () => {
    it("should return activity for cohort members", async () => {
      mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
        { callerId: "pupil-1" },
        { callerId: "pupil-2" },
      ]);

      const mockCalls = [
        {
          id: "call-1",
          createdAt: new Date("2026-02-10"),
          source: "sim",
          callerId: "pupil-1",
          caller: { id: "pupil-1", name: "Alice" },
          _count: { scores: 3, extractedMemories: 2 },
        },
        {
          id: "call-2",
          createdAt: new Date("2026-02-09"),
          source: "vapi",
          callerId: "pupil-2",
          caller: { id: "pupil-2", name: "Bob" },
          _count: { scores: 1, extractedMemories: 4 },
        },
      ];

      mockPrisma.call.findMany.mockResolvedValue(mockCalls);
      mockPrisma.call.count.mockResolvedValue(2);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/activity"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.activity).toHaveLength(2);
      expect(data.activity[0].type).toBe("call");
      expect(data.activity[0].callerName).toBe("Alice");
      expect(data.activity[0].scoreCount).toBe(3);
      expect(data.activity[0].memoryCount).toBe(2);
      expect(data.total).toBe(2);
    });

    it("should return empty activity when cohort has no members", async () => {
      mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/activity"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.activity).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    it("should respect limit and offset query parameters", async () => {
      mockPrisma.callerCohortMembership.findMany.mockResolvedValue([{ callerId: "pupil-1" }]);
      mockPrisma.call.findMany.mockResolvedValue([]);
      mockPrisma.call.count.mockResolvedValue(0);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/activity?limit=10&offset=5"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.limit).toBe(10);
      expect(data.offset).toBe(5);
      expect(mockPrisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 })
      );
    });

    it("should cap limit at 200", async () => {
      mockPrisma.callerCohortMembership.findMany.mockResolvedValue([{ callerId: "pupil-1" }]);
      mockPrisma.call.findMany.mockResolvedValue([]);
      mockPrisma.call.count.mockResolvedValue(0);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/activity?limit=500"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.limit).toBe(200);
    });

    it("should return 404 when cohort not found", async () => {
      const { requireCohortOwnership, isCohortOwnershipError } = await import(
        "@/lib/cohort-access"
      );
      (isCohortOwnershipError as any).mockReturnValue(true);
      (requireCohortOwnership as any).mockResolvedValue({
        error: new Response(
          JSON.stringify({ ok: false, error: "Cohort not found" }),
          { status: 404, headers: { "content-type": "application/json" } }
        ),
      });

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/missing-cohort/activity"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "missing-cohort" }),
      });

      expect(response.status).toBe(404);
    });

    it("should reject unauthenticated requests", async () => {
      const { requireEntityAccess, isEntityAuthError } = await import(
        "@/lib/access-control"
      );
      (isEntityAuthError as any).mockReturnValue(true);
      (requireEntityAccess as any).mockResolvedValue({
        error: new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "content-type": "application/json" } }
        ),
      });

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/activity/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/activity"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });

      expect(response.status).toBe(401);
    });
  });
});
