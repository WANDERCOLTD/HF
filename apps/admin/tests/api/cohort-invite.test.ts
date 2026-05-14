/**
 * Tests for /api/cohorts/:cohortId/invite endpoint
 *
 * GET: List pending invites for a cohort
 * POST: Send email invites to pupils
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  invite: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
  cohortGroup: {
    findUnique: vi.fn(),
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

vi.mock("@/lib/email", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/cohorts/:cohortId/invite", () => {
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
  // GET — List invites
  // ===================================================
  describe("GET", () => {
    it("should return pending invites", async () => {
      const mockInvites = [
        {
          id: "inv-1",
          email: "alice@test.com",
          firstName: "Alice",
          lastName: "Smith",
          createdAt: new Date("2026-02-10"),
          expiresAt: new Date("2026-03-10"),
          sentAt: new Date("2026-02-10"),
        },
        {
          id: "inv-2",
          email: "bob@test.com",
          firstName: null,
          lastName: null,
          createdAt: new Date("2026-02-11"),
          expiresAt: new Date("2026-03-11"),
          sentAt: null,
        },
      ];
      mockPrisma.invite.findMany.mockResolvedValue(mockInvites);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.invites).toHaveLength(2);
      expect(data.invites[0].email).toBe("alice@test.com");
      expect(data.invites[1].email).toBe("bob@test.com");
    });

    it("should return empty array when no pending invites", async () => {
      mockPrisma.invite.findMany.mockResolvedValue([]);

      const { GET } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.invites).toHaveLength(0);
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
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite"
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
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/missing/invite"
      );
      const response = await GET(request, {
        params: Promise.resolve({ cohortId: "missing" }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===================================================
  // POST — Create invites
  // ===================================================
  describe("POST", () => {
    it("should create invites for new emails", async () => {
      mockPrisma.invite.findMany
        .mockResolvedValueOnce([]) // no existing invites
        .mockResolvedValueOnce([
          // created invites with tokens
          { email: "new@test.com", token: "tok-123" },
        ]);
      mockPrisma.invite.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.invite.updateMany.mockResolvedValue({ count: 1 });

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({ emails: ["new@test.com"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.created).toBe(1);
      expect(data.skipped).toBe(0);
    });

    it("should skip emails with existing invites", async () => {
      mockPrisma.invite.findMany.mockResolvedValueOnce([
        { email: "existing@test.com" },
      ]);

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({ emails: ["existing@test.com"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.created).toBe(0);
      expect(data.skipped).toBe(1);
    });

    it("should handle mix of new and existing emails", async () => {
      mockPrisma.invite.findMany
        .mockResolvedValueOnce([{ email: "existing@test.com" }])
        .mockResolvedValueOnce([
          { email: "new@test.com", token: "tok-1" },
        ]);
      mockPrisma.invite.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.invite.updateMany.mockResolvedValue({ count: 1 });

      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({
            emails: ["existing@test.com", "new@test.com"],
          }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.created).toBe(1);
      expect(data.skipped).toBe(1);
    });

    it("should return 400 for empty emails", async () => {
      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({ emails: [] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("At least one email is required");
    });

    it("should return 400 for invalid emails", async () => {
      const { POST } = await import(
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({ emails: ["notanemail", "also-bad"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No valid email addresses provided");
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
        "../../app/api/cohorts/[cohortId]/invite/route"
      );
      const request = new Request(
        "http://localhost/api/cohorts/cohort-1/invite",
        {
          method: "POST",
          body: JSON.stringify({ emails: ["test@example.com"] }),
          headers: { "Content-Type": "application/json" },
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ cohortId: "cohort-1" }),
      });

      expect(response.status).toBe(401);
    });
  });
});
