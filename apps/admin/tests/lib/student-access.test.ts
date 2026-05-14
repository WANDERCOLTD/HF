/**
 * Tests for lib/student-access.ts
 *
 * requireStudent: Authenticates a student and resolves their LEARNER Caller.
 * isStudentAuthError: Type-guard for failure results.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  caller: {
    findFirst: vi.fn(),
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
vi.unmock("@/lib/student-access");

// ---------------------------------------------------------------------------
// Import unit under test AFTER mocks are wired
// ---------------------------------------------------------------------------

import {
  requireStudent,
  isStudentAuthError,
  type StudentAuthResult,
} from "@/lib/student-access";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(userId = "user-1", role = "STUDENT") {
  return {
    user: {
      id: userId,
      email: "student@example.com",
      name: "Test Student",
      role,
      image: null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any;
}

function makeAuthSuccess(userId = "user-1", role = "STUDENT") {
  return { session: mockSession(userId, role) };
}

function makeAuthFailure() {
  return {
    error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("student-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // isStudentAuthError
  // -------------------------------------------------------------------------

  describe("isStudentAuthError", () => {
    it("should return true when result contains an error", () => {
      const failure: StudentAuthResult = {
        error: NextResponse.json({ ok: false }, { status: 403 }),
      };
      expect(isStudentAuthError(failure)).toBe(true);
    });

    it("should return false when result contains session and callerId", () => {
      const success: StudentAuthResult = {
        session: mockSession(),
        callerId: "caller-1",
        cohortGroupId: "cohort-1",
        cohortGroupIds: ["cohort-1"],
        institutionId: null,
      };
      expect(isStudentAuthError(success)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // requireStudent
  // -------------------------------------------------------------------------

  describe("requireStudent", () => {
    it("should return error when requireAuth fails", async () => {
      const authFailure = makeAuthFailure();
      mockRequireAuth.mockResolvedValue(authFailure);
      mockIsAuthError.mockReturnValue(true);

      const result = await requireStudent();

      expect(isStudentAuthError(result)).toBe(true);
      expect(mockRequireAuth).toHaveBeenCalledWith("STUDENT");
      expect(mockPrisma.caller.findFirst).not.toHaveBeenCalled();
    });

    it("should return 403 for non-STUDENT roles (e.g. EDUCATOR)", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1", "EDUCATOR"));
      mockIsAuthError.mockReturnValue(false);

      const result = await requireStudent();

      expect(isStudentAuthError(result)).toBe(true);
      if (isStudentAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toBe("Student access only");
        expect(result.error.status).toBe(403);
      }
      expect(mockPrisma.caller.findFirst).not.toHaveBeenCalled();
    });

    it("should return 403 when no LEARNER caller linked to user", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue(null);

      const result = await requireStudent();

      expect(isStudentAuthError(result)).toBe(true);
      if (isStudentAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toContain("No student profile found");
        expect(result.error.status).toBe(403);
      }
    });

    it("should return 403 when caller has no cohortGroupId", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "caller-1",
        cohortGroupId: null,
        cohortMemberships: [],
        user: { institutionId: null },
      });

      const result = await requireStudent();

      expect(isStudentAuthError(result)).toBe(true);
      if (isStudentAuthError(result)) {
        const body = await result.error.json();
        expect(body.error).toContain("join a classroom");
        expect(result.error.status).toBe(403);
      }
    });

    it("should return session, callerId, cohortGroupId and cohortGroupIds on success", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "learner-caller-1",
        cohortGroupId: "cohort-1",
        cohortMemberships: [{ cohortGroupId: "cohort-1" }],
        user: { institutionId: "inst-1" },
      });

      const result = await requireStudent();

      expect(isStudentAuthError(result)).toBe(false);
      if (!isStudentAuthError(result)) {
        expect(result.session.user.id).toBe("user-1");
        expect(result.callerId).toBe("learner-caller-1");
        expect(result.cohortGroupId).toBe("cohort-1");
        expect(result.cohortGroupIds).toEqual(["cohort-1"]);
        expect(result.institutionId).toBe("inst-1");
      }
    });

    it("should pass correct query to prisma", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthSuccess("user-1"));
      mockIsAuthError.mockReturnValue(false);
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "learner-caller-1",
        cohortGroupId: "cohort-1",
        cohortMemberships: [{ cohortGroupId: "cohort-1" }],
        user: { institutionId: null },
      });

      await requireStudent();

      expect(mockPrisma.caller.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", role: "LEARNER" },
        select: {
          id: true,
          cohortGroupId: true,
          cohortMemberships: {
            select: { cohortGroupId: true },
            orderBy: { joinedAt: "asc" },
          },
          user: { select: { institutionId: true } },
        },
      });
    });
  });
});
