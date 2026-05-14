/**
 * Tests for /api/account endpoint
 *
 * GET: Returns the authenticated user's own profile
 * PATCH: Updates displayName and name only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP — vi.hoisted ensures these are available to vi.mock factories
// =====================================================

const { mockPrisma, mockRequireAuth } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRequireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "test-user", email: "test@example.com", name: "Test User", role: "ADMIN", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: vi.fn().mockReturnValue(false),
}));

import { GET, PATCH } from "@/app/api/account/route";

const mockUser = {
  id: "test-user",
  email: "test@example.com",
  name: "Test User",
  displayName: "Testy",
  image: null,
  role: "ADMIN",
  isActive: true,
  createdAt: new Date("2025-01-01"),
  assignedDomainId: null,
  assignedDomain: null,
};

// =====================================================
// TESTS
// =====================================================

describe("/api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);
    mockRequireAuth.mockResolvedValue({
      session: {
        user: { id: "test-user", email: "test@example.com", name: "Test User", role: "ADMIN", image: null },
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    });
  });

  describe("GET", () => {
    it("returns user profile", async () => {
      const res = await GET();
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.user.email).toBe("test@example.com");
      expect(body.user.displayName).toBe("Testy");
    });

    it("uses skipMasquerade", async () => {
      await GET();

      expect(mockRequireAuth).toHaveBeenCalledWith("VIEWER", { skipMasquerade: true });
    });

    it("returns 404 if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  describe("PATCH", () => {
    it("updates displayName and name", async () => {
      const updated = { ...mockUser, displayName: "New Name", name: "Full Name" };
      mockPrisma.user.update.mockResolvedValue(updated);

      const req = new Request("http://localhost/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "New Name", name: "Full Name" }),
      });

      const res = await PATCH(req);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "test-user" },
        data: { displayName: "New Name", name: "Full Name" },
        select: expect.any(Object),
      });
    });

    it("ignores role and email fields", async () => {
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const req = new Request("http://localhost/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "SUPERADMIN", email: "hacked@evil.com", displayName: "OK" }),
      });

      await PATCH(req);

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("role");
      expect(updateCall.data).not.toHaveProperty("email");
      expect(updateCall.data).toHaveProperty("displayName", "OK");
    });

    it("uses skipMasquerade", async () => {
      const req = new Request("http://localhost/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "test" }),
      });

      await PATCH(req);

      expect(mockRequireAuth).toHaveBeenCalledWith("VIEWER", { skipMasquerade: true });
    });
  });
});
