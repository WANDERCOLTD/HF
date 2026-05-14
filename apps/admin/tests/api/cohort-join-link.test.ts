/**
 * Tests for /api/cohorts/:cohortId/join-link endpoint
 *
 * GET: Get or generate join link token
 * POST: Regenerate join link token
 * DELETE: Revoke join link
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  cohortGroup: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
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

// crypto is not mocked — real randomUUID is used

// =====================================================
// TESTS
// =====================================================

describe("/api/cohorts/:cohortId/join-link", () => {
  beforeEach(async () => {
    vi.resetModules();

    // Restore default mock implementations after clearAllMocks
    const { requireEntityAccess, isEntityAuthError } = await import(
      "@/lib/access-control"
    );
    (isEntityAuthError as any).mockReturnValue(false);
    (requireEntityAccess as any).mockResolvedValue({
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
    });

    const { requireCohortOwnership, isCohortOwnershipError } = await import(
      "@/lib/cohort-access"
    );
    (isCohortOwnershipError as any).mockReturnValue(false);
    (requireCohortOwnership as any).mockResolvedValue({
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
    });

    // Reset prisma mocks
    Object.values(mockPrisma).forEach((model) => {
      Object.values(model).forEach((fn) => (fn as any).mockReset());
    });
  });

  // ===================================================
  // GET — Get or generate join link
  // ===================================================
  describe("GET", () => {
    it("should return existing join token", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        joinToken: "abc123",
      });

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.joinToken).toBe("abc123");
      expect(mockPrisma.cohortGroup.update).not.toHaveBeenCalled();
    });

    it("should generate token if none exists", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        joinToken: null,
      });
      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.joinToken).toBeTruthy();
      expect(typeof data.joinToken).toBe("string");
      expect(mockPrisma.cohortGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cohort-1" },
          data: { joinToken: expect.any(String), joinTokenExp: expect.any(Date) },
        })
      );
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
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });

      expect(response.status).toBe(401);
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
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/missing/join-link"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "missing" }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===================================================
  // POST — Regenerate join link
  // ===================================================
  describe("POST", () => {
    it("should regenerate join token", async () => {
      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link",
        { method: "POST" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.joinToken).toBeTruthy();
      expect(typeof data.joinToken).toBe("string");
      expect(mockPrisma.cohortGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cohort-1" },
          data: expect.objectContaining({ joinToken: expect.any(String) }),
        })
      );
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

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link",
        { method: "POST" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });

      expect(response.status).toBe(401);
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

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/missing/join-link",
        { method: "POST" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "missing" }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===================================================
  // DELETE — Revoke join link
  // ===================================================
  describe("DELETE", () => {
    it("should revoke join link", async () => {
      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link",
        { method: "DELETE" }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toBe("Join link revoked");
      expect(mockPrisma.cohortGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cohort-1" },
          data: { joinToken: null, joinTokenExp: null },
        })
      );
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

      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/join-link",
        { method: "DELETE" }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });

      expect(response.status).toBe(401);
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

      const { DELETE } = await import(
        "../../app/api/cohorts/[cohortId]/join-link/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/missing/join-link",
        { method: "DELETE" }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ cohortId: "missing" }),
      });

      expect(response.status).toBe(404);
    });
  });
});
