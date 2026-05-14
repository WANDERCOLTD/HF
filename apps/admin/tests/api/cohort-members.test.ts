/**
 * Tests for /api/cohorts/:cohortId/members endpoint
 *
 * POST: Add callers to a cohort
 * DELETE: Remove callers from a cohort
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  cohortGroup: {
    findUnique: vi.fn(),
  },
  callerCohortMembership: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
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

vi.mock("@/lib/enrollment", () => ({
  enrollCallerInCohortPlaybooks: vi.fn().mockResolvedValue(undefined),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/cohorts/:cohortId/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // POST — Add members
  // ===================================================
  describe("POST", () => {
    it("should add callers to cohort", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([
        { id: "pupil-1", domainId: "domain-1", role: "LEARNER", cohortGroupId: null },
        { id: "pupil-2", domainId: "domain-1", role: "LEARNER", cohortGroupId: null },
      ]);
      mockPrisma.callerCohortMembership.upsert.mockResolvedValue({});
      mockPrisma.caller.update.mockResolvedValue({});

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "POST",
          body: JSON.stringify({ callerIds: ["pupil-1", "pupil-2"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.added).toBe(2);
      expect(mockPrisma.callerCohortMembership.upsert).toHaveBeenCalledTimes(2);
    });

    it("should return 400 if callerIds is empty", async () => {
      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "POST",
          body: JSON.stringify({ callerIds: [] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("callerIds array is required");
    });

    it("should return 404 if some callers not found", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([
        { id: "pupil-1", domainId: "domain-1", role: "LEARNER", cohortGroupId: null },
      ]);

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "POST",
          body: JSON.stringify({ callerIds: ["pupil-1", "missing-1"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("missing-1");
    });

    it("should return 400 if callers are in wrong domain", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([
        { id: "pupil-1", domainId: "other-domain", role: "LEARNER", cohortGroupId: null },
      ]);

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "POST",
          body: JSON.stringify({ callerIds: ["pupil-1"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("must belong to domain");
    });

    it("should return 400 if would exceed max members", async () => {
      // Mock cohort with 49 members and max 50
      const { requireCohortOwnership } = await import("@/lib/cohort-access");
      (requireCohortOwnership as any).mockResolvedValue({
        cohort: {
          id: "cohort-1",
          name: "Full Cohort",
          domainId: "domain-1",
          ownerId: "teacher-1",
          maxMembers: 50,
          isActive: true,
          owner: { id: "teacher-1", name: "Teacher A" },
          domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
          _count: { members: 49 },
        },
      });

      // These won't be reached since max member check fails before validation
      mockPrisma.caller.findMany.mockResolvedValue([
        { id: "pupil-1", domainId: "domain-1", role: "LEARNER", cohortGroupId: null },
        { id: "pupil-2", domainId: "domain-1", role: "LEARNER", cohortGroupId: null },
      ]);

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "POST",
          body: JSON.stringify({ callerIds: ["pupil-1", "pupil-2"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("exceed max members");
    });
  });

  // ===================================================
  // DELETE — Remove members
  // ===================================================
  describe("DELETE", () => {
    it("should remove callers from cohort", async () => {
      mockPrisma.callerCohortMembership.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.caller.updateMany.mockResolvedValue({ count: 1 });

      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "DELETE",
          body: JSON.stringify({ callerIds: ["pupil-1"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.removed).toBe(1);
      expect(mockPrisma.callerCohortMembership.deleteMany).toHaveBeenCalledWith({
        where: {
          callerId: { in: ["pupil-1"] },
          cohortGroupId: "cohort-1",
        },
      });
    });

    it("should return 400 if callerIds missing", async () => {
      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/members/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/members",
        {
          method: "DELETE",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
    });
  });
});
