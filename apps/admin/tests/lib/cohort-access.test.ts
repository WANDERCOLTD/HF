/**
 * Tests for lib/cohort-access.ts
 *
 * requireCohortOwnership: Verifies ownership based on scope (ALL, DOMAIN, OWN)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Use vi.hoisted to avoid TDZ issues with vi.mock factory
const mockPrisma = vi.hoisted(() => ({
  cohortGroup: {
    findUnique: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import {
  requireCohortOwnership,
  isCohortOwnershipError,
} from "@/lib/cohort-access";

// Helper to build a mock session
function mockSession(
  userId: string,
  assignedDomainId?: string
) {
  return {
    user: {
      id: userId,
      email: "test@example.com",
      name: "Test",
      role: "ADMIN",
      image: null,
      assignedDomainId,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any;
}

const mockCohort = {
  id: "cohort-1",
  name: "Test Cohort",
  domainId: "domain-1",
  ownerId: "teacher-1",
  maxMembers: 50,
  isActive: true,
  owner: { id: "teacher-1", name: "Teacher A" },
  domain: { id: "domain-1", slug: "tutor", name: "Tutor" },
  _count: { members: 5 },
};

describe("cohort-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requireCohortOwnership", () => {
    it("should return cohort for ALL scope", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("any-user"),
        "ALL"
      );

      expect(isCohortOwnershipError(result)).toBe(false);
      if (!isCohortOwnershipError(result)) {
        expect(result.cohort.id).toBe("cohort-1");
      }
    });

    it("should return 404 if cohort not found", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(null);

      const result = await requireCohortOwnership(
        "missing",
        mockSession("any-user"),
        "ALL"
      );

      expect(isCohortOwnershipError(result)).toBe(true);
    });

    it("should allow DOMAIN scope when domains match", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("user-1", "domain-1"),
        "DOMAIN"
      );

      expect(isCohortOwnershipError(result)).toBe(false);
    });

    it("should deny DOMAIN scope when domains don't match", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("user-1", "other-domain"),
        "DOMAIN"
      );

      expect(isCohortOwnershipError(result)).toBe(true);
    });

    it("should allow OWN scope when user's caller is the owner", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "teacher-1", // matches cohort.ownerId
      });

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("user-linked-to-teacher"),
        "OWN"
      );

      expect(isCohortOwnershipError(result)).toBe(false);
    });

    it("should deny OWN scope when user's caller is not the owner", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "other-caller", // does NOT match cohort.ownerId
      });

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("some-user"),
        "OWN"
      );

      expect(isCohortOwnershipError(result)).toBe(true);
    });

    it("should deny OWN scope when user has no linked caller", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);
      mockPrisma.caller.findFirst.mockResolvedValue(null);

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("user-no-caller"),
        "OWN"
      );

      expect(isCohortOwnershipError(result)).toBe(true);
    });

    it("should deny NONE scope", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(mockCohort);

      const result = await requireCohortOwnership(
        "cohort-1",
        mockSession("any-user"),
        "NONE"
      );

      expect(isCohortOwnershipError(result)).toBe(true);
    });
  });
});
