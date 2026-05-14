/**
 * Tests for /api/domains/:domainId/classroom endpoint
 *
 * POST: Auto-create classroom (cohort + join link) for a domain
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
  cohortGroup: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  playbook: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/enrollment", () => ({
  assignPlaybookToCohort: vi.fn().mockResolvedValue(undefined),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/domains/:domainId/classroom", () => {
  const mockSession = {
    user: {
      id: "user-1",
      email: "admin@example.com",
      name: "Admin User",
      role: "ADMIN",
      image: null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  beforeEach(async () => {
    vi.resetModules();

    const { requireAuth, isAuthError } = await import("@/lib/permissions");
    (isAuthError as any).mockReturnValue(false);
    (requireAuth as any).mockResolvedValue({ session: mockSession });

    // Reset all mocks
    mockPrisma.domain.findUnique.mockReset();
    mockPrisma.caller.findFirst.mockReset();
    mockPrisma.caller.create.mockReset();
    mockPrisma.cohortGroup.findFirst.mockReset();
    mockPrisma.cohortGroup.create.mockReset();
    mockPrisma.cohortGroup.update.mockReset();
  });

  async function callPOST(domainId: string, body: Record<string, unknown> = {}) {
    const { POST } = await import(
      "../../app/api/domains/[domainId]/classroom/route"
    );
    const request = new Request(
      `http://localhost/api/domains/${domainId}/classroom`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }
    );
    return POST(request, { params: Promise.resolve({ domainId }) });
  }

  // ===================================================
  // POST — Create Classroom
  // ===================================================
  describe("POST", () => {
    it("should create classroom with new teacher caller and cohort", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "french-tutor",
        name: "French Tutor",
      });

      // No existing teacher
      mockPrisma.caller.findFirst.mockResolvedValue(null);

      // Create teacher
      mockPrisma.caller.create.mockResolvedValue({
        id: "teacher-caller-1",
      });

      // No existing cohort
      mockPrisma.cohortGroup.findFirst.mockResolvedValue(null);

      // Create cohort
      mockPrisma.cohortGroup.create.mockResolvedValue({
        id: "cohort-1",
        name: "French Tutor Classroom",
        domainId: "domain-1",
        ownerId: "teacher-caller-1",
        joinToken: null,
        owner: { id: "teacher-caller-1", name: "Admin User", email: "admin@example.com" },
        domain: { id: "domain-1", slug: "french-tutor", name: "French Tutor" },
        _count: { members: 0 },
      });

      // Token update
      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const response = await callPOST("domain-1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.cohort.id).toBe("cohort-1");
      expect(data.joinToken).toBeDefined();
      expect(typeof data.joinToken).toBe("string");

      // Verify teacher was created
      expect(mockPrisma.caller.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: "TEACHER",
            userId: "user-1",
            domainId: "domain-1",
          }),
        })
      );
    });

    it("should reuse existing teacher caller", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "french-tutor",
        name: "French Tutor",
      });

      // Existing teacher
      mockPrisma.caller.findFirst.mockResolvedValue({ id: "existing-teacher" });

      // No existing cohort
      mockPrisma.cohortGroup.findFirst.mockResolvedValue(null);

      mockPrisma.cohortGroup.create.mockResolvedValue({
        id: "cohort-2",
        name: "French Tutor Classroom",
        domainId: "domain-1",
        ownerId: "existing-teacher",
        joinToken: null,
        owner: { id: "existing-teacher", name: "Admin User", email: "admin@example.com" },
        domain: { id: "domain-1", slug: "french-tutor", name: "French Tutor" },
        _count: { members: 0 },
      });

      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const response = await callPOST("domain-1");
      const data = await response.json();

      expect(data.ok).toBe(true);
      // Should NOT create a new caller
      expect(mockPrisma.caller.create).not.toHaveBeenCalled();
    });

    it("should be idempotent — return existing cohort", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "french-tutor",
        name: "French Tutor",
      });

      mockPrisma.caller.findFirst.mockResolvedValue({ id: "existing-teacher" });

      // Existing cohort WITH token
      mockPrisma.cohortGroup.findFirst.mockResolvedValue({
        id: "existing-cohort",
        name: "French Tutor Classroom",
        domainId: "domain-1",
        ownerId: "existing-teacher",
        joinToken: "abc123def456",
        owner: { id: "existing-teacher", name: "Admin User", email: "admin@example.com" },
        domain: { id: "domain-1", slug: "french-tutor", name: "French Tutor" },
        _count: { members: 3 },
      });

      const response = await callPOST("domain-1");
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.cohort.id).toBe("existing-cohort");
      expect(data.joinToken).toBe("abc123def456");
      // Should NOT create cohort
      expect(mockPrisma.cohortGroup.create).not.toHaveBeenCalled();
      // Should NOT update token (already exists)
      expect(mockPrisma.cohortGroup.update).not.toHaveBeenCalled();
    });

    it("should return 404 for missing domain", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const response = await callPOST("nonexistent");
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Domain not found");
    });

    it("should use custom classroom name when provided", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "domain-1",
        slug: "french-tutor",
        name: "French Tutor",
      });

      mockPrisma.caller.findFirst.mockResolvedValue({ id: "teacher-1" });
      mockPrisma.cohortGroup.findFirst.mockResolvedValue(null);

      mockPrisma.cohortGroup.create.mockResolvedValue({
        id: "cohort-3",
        name: "Period 2 French",
        domainId: "domain-1",
        ownerId: "teacher-1",
        joinToken: null,
        owner: { id: "teacher-1", name: "Admin User", email: "admin@example.com" },
        domain: { id: "domain-1", slug: "french-tutor", name: "French Tutor" },
        _count: { members: 0 },
      });

      mockPrisma.cohortGroup.update.mockResolvedValue({});

      const response = await callPOST("domain-1", { name: "Period 2 French" });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.cohortGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Period 2 French",
          }),
        })
      );
    });
  });
});
