/**
 * Tests for lib/educator-access.ts
 *
 * requireEducator: Authenticates an educator and resolves their TEACHER Caller.
 * requireEducatorCohortOwnership: Verifies a cohort is owned by the educator.
 * requireEducatorStudentAccess: Verifies a student belongs to one of the educator's cohorts.
 * isEducatorAuthError: Type-guard for failure results.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock factories reference them
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  caller: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  cohortGroup: {
    findUnique: vi.fn(),
  },
}));

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockIsAuthError = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

// Undo the global mock from setup.ts — we want to test the real implementation
vi.unmock("@/lib/educator-access");

// ---------------------------------------------------------------------------
// Import unit under test AFTER mocks are wired
// ---------------------------------------------------------------------------

import {
  requireEducator,
  requireEducatorCohortOwnership,
  requireEducatorStudentAccess,
  isEducatorAuthError,
  type EducatorAuthResult,
} from "@/lib/educator-access";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(userId = "user-1") {
  return {
    user: {
      id: userId,
      email: "educator@example.com",
      name: "Test Educator",
      role: "EDUCATOR",
      image: null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any;
}

function makeAuthSuccess(userId = "user-1") {
  return { session: mockSession(userId) };
}

function makeAuthFailure() {
  return {
    error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("educator-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // isEducatorAuthError
  // -------------------------------------------------------------------------

  describe("isEducatorAuthError", () => {
    it("should return true when result contains an error", () => {
      const failure: EducatorAuthResult = {
        error: NextResponse.json({ ok: false }, { status: 403 }),
      };
      expect(isEducatorAuthError(failure)).toBe(true);
    });

    it("should return false when result contains session and callerId", () => {
      const success: EducatorAuthResult = {
        session: mockSession(),
        callerId: "caller-1",
        institutionId: null,
      };
      expect(isEducatorAuthError(success)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // requireEducator
  // -------------------------------------------------------------------------

  describe("requireEducator", () => {
    it("should return error when requireAuth fails", async () => {
      const authFailure = makeAuthFailure();
      mockRequireAuth.mockResolvedValue(authFailure);
      mockIsAuthError.mockReturnValue(true);

      const result = await requireEducator();

      expect(isEducatorAuthError(result)).toBe(true);
      expect(mockRequireAuth).toHaveBeenCalledWith("EDUCATOR");
      // Should not try to look up the caller
      expect(mockPrisma.caller.findFirst).not.toHaveBeenCalled();
    });

    it("should return error when no TEACHER caller linked to user", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue(null);

      const result = await requireEducator();

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toContain("No educator profile found");
        expect(result.error.status).toBe(403);
      }
      expect(mockPrisma.caller.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", role: "TEACHER" },
        select: { id: true, user: { select: { institutionId: true } } },
      });
    });

    it("should return session and callerId on success", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue({ id: "teacher-caller-1", user: { institutionId: "inst-1" } });

      const result = await requireEducator();

      expect(isEducatorAuthError(result)).toBe(false);
      if (!isEducatorAuthError(result)) {
        expect(result.session.user.id).toBe("user-1");
        expect(result.callerId).toBe("teacher-caller-1");
        expect(result.institutionId).toBe("inst-1");
      }
    });
  });

  // -------------------------------------------------------------------------
  // requireEducatorCohortOwnership
  // -------------------------------------------------------------------------

  describe("requireEducatorCohortOwnership", () => {
    const baseCohort = {
      id: "cohort-1",
      name: "Year 9 Maths",
      domainId: "domain-1",
      ownerId: "teacher-caller-1",
      maxMembers: 30,
      isActive: true,
      owner: { id: "teacher-caller-1", name: "Ms Smith" },
      domain: { id: "domain-1", slug: "maths", name: "Maths" },
      _count: { members: 12 },
    };

    it("should return 404 when cohort does not exist", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(null);

      const result = await requireEducatorCohortOwnership("missing-id", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Cohort not found");
        expect(result.error.status).toBe(404);
      }
    });

    it("should return 403 when educator does not own the cohort", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(baseCohort);

      const result = await requireEducatorCohortOwnership("cohort-1", "other-teacher");

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Forbidden");
        expect(result.error.status).toBe(403);
      }
    });

    it("should return the cohort when educator owns it", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(baseCohort);

      const result = await requireEducatorCohortOwnership("cohort-1", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(false);
      if (!isEducatorAuthError(result)) {
        expect(result.cohort.id).toBe("cohort-1");
        expect(result.cohort.ownerId).toBe("teacher-caller-1");
        expect(result.cohort._count.members).toBe(12);
      }
    });

    it("should pass correct query to prisma", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(baseCohort);

      await requireEducatorCohortOwnership("cohort-1", "teacher-caller-1");

      expect(mockPrisma.cohortGroup.findUnique).toHaveBeenCalledWith({
        where: { id: "cohort-1" },
        include: {
          owner: { select: { id: true, name: true } },
          domain: { select: { id: true, slug: true, name: true } },
          _count: { select: { members: true } },
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // requireEducatorStudentAccess
  // -------------------------------------------------------------------------

  describe("requireEducatorStudentAccess", () => {
    const baseStudent = {
      id: "student-1",
      name: "Student A",
      cohortGroupId: "cohort-1",
      cohortGroup: {
        id: "cohort-1",
        name: "Year 9 Maths",
        ownerId: "teacher-caller-1",
      },
      cohortMemberships: [
        {
          cohortGroup: {
            id: "cohort-1",
            name: "Year 9 Maths",
            ownerId: "teacher-caller-1",
          },
        },
      ],
      domain: { id: "domain-1", slug: "maths", name: "Maths" },
    };

    it("should return 404 when student does not exist", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const result = await requireEducatorStudentAccess("missing-id", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Learner not found");
        expect(result.error.status).toBe(404);
      }
    });

    it("should return 403 when student has no cohortGroup", async () => {
      const studentNoCohort = {
        ...baseStudent,
        cohortGroup: null,
        cohortGroupId: null,
        cohortMemberships: [],
      };
      mockPrisma.caller.findUnique.mockResolvedValue(studentNoCohort);

      const result = await requireEducatorStudentAccess("student-1", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Forbidden");
        expect(result.error.status).toBe(403);
      }
    });

    it("should return 403 when student's cohort is owned by a different educator", async () => {
      const studentOtherTeacher = {
        ...baseStudent,
        cohortGroup: {
          id: "cohort-1",
          name: "Year 9 Maths",
          ownerId: "other-teacher",
        },
        cohortMemberships: [
          {
            cohortGroup: {
              id: "cohort-1",
              name: "Year 9 Maths",
              ownerId: "other-teacher",
            },
          },
        ],
      };
      mockPrisma.caller.findUnique.mockResolvedValue(studentOtherTeacher);

      const result = await requireEducatorStudentAccess("student-1", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(true);
      if (isEducatorAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Forbidden");
        expect(result.error.status).toBe(403);
      }
    });

    it("should return the student when educator owns the cohort", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(baseStudent);

      const result = await requireEducatorStudentAccess("student-1", "teacher-caller-1");

      expect(isEducatorAuthError(result)).toBe(false);
      if (!isEducatorAuthError(result)) {
        expect(result.student.id).toBe("student-1");
        expect(result.student.cohortGroup?.ownerId).toBe("teacher-caller-1");
      }
    });

    it("should pass correct query to prisma", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(baseStudent);

      await requireEducatorStudentAccess("student-1", "teacher-caller-1");

      expect(mockPrisma.caller.findUnique).toHaveBeenCalledWith({
        where: { id: "student-1" },
        include: {
          cohortGroup: {
            select: { id: true, name: true, ownerId: true },
          },
          cohortMemberships: {
            include: {
              cohortGroup: {
                select: { id: true, name: true, ownerId: true },
              },
            },
          },
          domain: { select: { id: true, slug: true, name: true } },
        },
      });
    });
  });
});
