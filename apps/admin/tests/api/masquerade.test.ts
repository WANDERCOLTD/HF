/**
 * Tests for /api/admin/masquerade endpoint
 *
 * POST: Start masquerading as another user
 * GET: Get current masquerade state
 * DELETE: Stop masquerading
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockAuditLog = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: mockAuditLog,
  AuditAction: {
    MASQUERADE_START: "masquerade_start",
    MASQUERADE_STOP: "masquerade_stop",
  },
}));

// Mock cookies
const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));

// Mock masquerade helpers
const mockGetMasqueradeState = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/masquerade", () => ({
  MASQUERADE_COOKIE: "hf.masquerade",
  MASQUERADE_MAX_AGE: 28800,
  getMasqueradeState: (...args: any[]) => mockGetMasqueradeState(...args),
  canMasquerade: (role: string) => role === "ADMIN" || role === "SUPERADMIN",
  isRoleEscalation: (realRole: string, targetRole: string) => {
    const levels: Record<string, number> = {
      SUPERADMIN: 5, ADMIN: 4, OPERATOR: 3, EDUCATOR: 3,
      SUPER_TESTER: 2, TESTER: 1, DEMO: 0, VIEWER: 1,
    };
    return (levels[targetRole] ?? 0) > (levels[realRole] ?? 0);
  },
}));

// Mock requireAuth — must use skipMasquerade for these routes
const mockRequireAuth = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

// =====================================================
// HELPERS
// =====================================================

const adminSession = {
  session: {
    user: { id: "admin-1", email: "admin@test.com", name: "Admin", role: "ADMIN", image: null },
    expires: new Date(Date.now() + 86400000).toISOString(),
  },
};

const operatorSession = {
  session: {
    user: { id: "op-1", email: "op@test.com", name: "Operator", role: "OPERATOR", image: null },
    expires: new Date(Date.now() + 86400000).toISOString(),
  },
};

const targetUser = {
  id: "edu-1",
  email: "teacher@school.com",
  name: "Jane Teacher",
  role: "EDUCATOR",
  isActive: true,
  assignedDomainId: "domain-1",
};

// =====================================================
// TESTS
// =====================================================

describe("/api/admin/masquerade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(adminSession);
    mockCookieStore.get.mockReturnValue(undefined);
  });

  describe("GET", () => {
    it("should return null when not masquerading", async () => {
      mockGetMasqueradeState.mockResolvedValue(null);

      const { GET } = await import("@/app/api/admin/masquerade/route");
      const res = await GET();
      const data = await res.json();

      expect(data.masquerade).toBeNull();
      expect(mockRequireAuth).toHaveBeenCalledWith("ADMIN", { skipMasquerade: true });
    });

    it("should return masquerade state when active", async () => {
      const state = {
        userId: "edu-1",
        email: "teacher@school.com",
        name: "Jane Teacher",
        role: "EDUCATOR",
        assignedDomainId: "domain-1",
        startedAt: "2026-02-15T10:00:00Z",
        startedBy: "admin-1",
      };
      mockGetMasqueradeState.mockResolvedValue(state);

      const { GET } = await import("@/app/api/admin/masquerade/route");
      const res = await GET();
      const data = await res.json();

      expect(data.masquerade).toEqual(state);
    });

    it("should reject non-ADMIN users with 403", async () => {
      const { NextResponse } = await import("next/server");
      mockRequireAuth.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });

      const { GET } = await import("@/app/api/admin/masquerade/route");
      const res = await GET();

      expect(res.status).toBe(403);
    });
  });

  describe("POST", () => {
    it("should start masquerade for valid user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(targetUser);

      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({ userId: "edu-1" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.masquerade.userId).toBe("edu-1");
      expect(data.masquerade.role).toBe("EDUCATOR");
      expect(mockCookieStore.set).toHaveBeenCalled();
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "masquerade_start",
          entityId: "edu-1",
        }),
      );
    });

    it("should reject self-masquerade", async () => {
      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({ userId: "admin-1" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("yourself");
    });

    it("should reject non-existent user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({ userId: "nonexistent" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    it("should reject inactive user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...targetUser, isActive: false });

      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({ userId: "edu-1" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    it("should reject role escalation (ADMIN → SUPERADMIN)", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...targetUser,
        id: "super-1",
        role: "SUPERADMIN",
      });

      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({ userId: "super-1" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("higher role");
    });

    it("should reject missing userId", async () => {
      const { POST } = await import("@/app/api/admin/masquerade/route");
      const req = new Request("http://localhost/api/admin/masquerade", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("should clear masquerade cookie", async () => {
      mockGetMasqueradeState.mockResolvedValue({
        userId: "edu-1",
        email: "teacher@school.com",
        role: "EDUCATOR",
      });

      const { DELETE } = await import("@/app/api/admin/masquerade/route");
      const res = await DELETE();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockCookieStore.delete).toHaveBeenCalledWith("hf.masquerade");
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "masquerade_stop",
          entityId: "edu-1",
        }),
      );
    });
  });
});

describe("/api/admin/masquerade/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(adminSession);
  });

  it("should return users excluding self", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "edu-1", email: "teacher@school.com", name: "Jane", displayName: null, role: "EDUCATOR", assignedDomainId: null, assignedDomain: null },
      { id: "op-1", email: "op@test.com", name: "Operator", displayName: null, role: "OPERATOR", assignedDomainId: null, assignedDomain: null },
    ]);

    const { GET } = await import("@/app/api/admin/masquerade/users/route");
    const req = new Request("http://localhost/api/admin/masquerade/users");
    const res = await GET(req as any);
    const data = await res.json();

    expect(data.users).toHaveLength(2);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "admin-1" },
          isActive: true,
        }),
      }),
    );
  });

  it("should support search filter", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/admin/masquerade/users/route");
    const req = new Request("http://localhost/api/admin/masquerade/users?search=jane");
    const res = await GET(req as any);
    const data = await res.json();

    expect(data.users).toEqual([]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { contains: "jane", mode: "insensitive" } }),
          ]),
        }),
      }),
    );
  });
});
