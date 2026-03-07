/**
 * Tests for /api/sim/setup endpoint
 *
 * POST: Creates a Caller record linked to the authenticated user in the specified domain.
 *       Returns existing caller if one already exists for this user.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  domain: {
    findUnique: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx: unknown) => tx ?? mockPrisma,
}));

const mockResolveAndEnrollSingle = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/enrollment", () => ({
  resolveAndEnrollSingle: (...args: unknown[]) => mockResolveAndEnrollSingle(...args),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/sim/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("POST", () => {
    it("should create a new caller for first-time sim user", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "qm-tutor",
        name: "QM Tutor",
      });
      mockPrisma.caller.findFirst.mockResolvedValue(null); // no existing caller
      mockPrisma.caller.create.mockResolvedValue({
        id: "caller-new",
        name: "Test User",
        domainId: "domain-1",
        userId: "test-user",
        email: "test@example.com",
        externalId: "sim-test-user",
      });

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.id).toBe("caller-new");
      expect(data.caller.name).toBe("Test User");
      expect(data.caller.domainId).toBe("domain-1");
      // Should have called resolveAndEnrollSingle
      expect(mockResolveAndEnrollSingle).toHaveBeenCalledWith("caller-new", "domain-1", "sim-setup", undefined);
    });

    it("should return existing caller if user already has one", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "qm-tutor",
        name: "QM Tutor",
      });
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "caller-existing",
        name: "Existing User",
        domainId: "domain-1",
        userId: "test-user",
      });

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.id).toBe("caller-existing");
      expect(data.caller.name).toBe("Existing User");
      // Should NOT have called create
      expect(mockPrisma.caller.create).not.toHaveBeenCalled();
    });

    it("should return 400 when domainId is missing", async () => {
      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Domain ID is required");
    });

    it("should return 400 when domain does not exist", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "nonexistent" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Invalid domain");
    });

    it("should use session user data for caller creation", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "qm-tutor",
        name: "QM Tutor",
      });
      mockPrisma.caller.findFirst.mockResolvedValue(null);
      mockPrisma.caller.create.mockResolvedValue({
        id: "caller-new",
        name: "Test User",
        domainId: "domain-1",
      });

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      await POST(request as any);

      // Verify create was called with session user's data
      expect(mockPrisma.caller.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "test-user",
          email: "test@example.com",
          name: "Test User",
          domainId: "domain-1",
          externalId: "sim-test-user",
        }),
      });
    });

    it("should look up existing caller by userId", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "qm-tutor",
        name: "QM Tutor",
      });
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "caller-existing",
        name: "Alice",
        domainId: "domain-1",
      });

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      await POST(request as any);

      // Verify findFirst searches by userId from session
      expect(mockPrisma.caller.findFirst).toHaveBeenCalledWith({
        where: { userId: "test-user" },
      });
    });

    it("should return caller shape with id, name, and domainId", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "qm-tutor",
        name: "QM Tutor",
      });
      mockPrisma.caller.findFirst.mockResolvedValue(null);
      mockPrisma.caller.create.mockResolvedValue({
        id: "caller-1",
        name: "Test User",
        domainId: "domain-1",
        email: "test@example.com",
        externalId: "sim-test-user",
        userId: "test-user",
        // Extra fields that should not be in response
        phone: null,
        createdAt: new Date(),
      });

      const { POST } = await import("../../app/api/sim/setup/route");
      const request = new Request("http://localhost/api/sim/setup", {
        method: "POST",
        body: JSON.stringify({ domainId: "domain-1" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any);
      const data = await response.json();

      // Response should include id, name, domainId, playbookId
      expect(data.caller).toEqual({
        id: "caller-1",
        name: "Test User",
        domainId: "domain-1",
        playbookId: null,
      });
    });
  });
});
