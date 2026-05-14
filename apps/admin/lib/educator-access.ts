/**
 * Educator-Scoped Access Helpers
 *
 * Provides helpers for educator routes to verify ownership of cohorts
 * and access to students within their owned cohorts.
 *
 * An educator's "scope" is: their linked Caller (TEACHER role) →
 * ownedCohorts → members of those cohorts.
 */

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError, ROLE_LEVEL } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";

type EducatorAuthSuccess = {
  session: Session;
  callerId: string; // The educator's Caller.id (TEACHER role)
  institutionId: string | null; // The educator's institution (for branding/scoping)
};

type EducatorAuthFailure = {
  error: NextResponse;
};

export type EducatorAuthResult = EducatorAuthSuccess | EducatorAuthFailure;

/**
 * Type guard: any educator-access result variant (auth, cohort-ownership, or
 * student-access) is a failure when it carries an `error` NextResponse.
 * Accepts the broader union returned by helpers like
 * `requireEducatorCohortOwnership` / `requireEducatorStudentAccess`.
 */
export function isEducatorAuthError(
  result: unknown
): result is { error: NextResponse } {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    (result as { error?: unknown }).error !== undefined
  );
}

/**
 * Require authenticated educator with a linked TEACHER Caller.
 * Returns { session, callerId } on success.
 */
export async function requireEducator(): Promise<EducatorAuthResult> {
  const authResult = await requireAuth("EDUCATOR");
  if (isAuthError(authResult)) return { error: authResult.error };

  const { session } = authResult;

  // Find the educator's linked Caller record (TEACHER role) + institution
  const caller = await prisma.caller.findFirst({
    where: {
      userId: session.user.id,
      role: "TEACHER",
    },
    select: {
      id: true,
      user: { select: { institutionId: true } },
    },
  });

  if (!caller) {
    return {
      error: NextResponse.json(
        { ok: false, error: "No educator profile found. Please complete setup." },
        { status: 403 }
      ),
    };
  }

  return {
    session,
    callerId: caller.id,
    institutionId: caller.user?.institutionId ?? null,
  };
}

/**
 * Like requireEducator() but also allows ADMIN+ users with an explicit institutionId param.
 * - EDUCATOR: resolves own linked TEACHER caller (same as requireEducator)
 * - ADMIN+: reads institutionId from query param, verifies it exists
 *   Returns callerId as null since admin isn't a teacher entity.
 */
export async function requireEducatorOrAdmin(
  request: NextRequest
): Promise<EducatorAuthResult> {
  const authResult = await requireAuth("EDUCATOR");
  if (isAuthError(authResult)) return { error: authResult.error };

  const { session } = authResult;
  const role = session.user.role;

  // Path A: Actual EDUCATOR — resolve their TEACHER caller
  if (role === "EDUCATOR") {
    const caller = await prisma.caller.findFirst({
      where: { userId: session.user.id, role: "TEACHER" },
      select: {
        id: true,
        user: { select: { institutionId: true } },
      },
    });

    if (!caller) {
      return {
        error: NextResponse.json(
          { ok: false, error: "No educator profile found. Please complete setup." },
          { status: 403 }
        ),
      };
    }

    return {
      session,
      callerId: caller.id,
      institutionId: caller.user?.institutionId ?? null,
    };
  }

  // Path B: ADMIN+ — require explicit institutionId query param
  if (ROLE_LEVEL[role] >= ROLE_LEVEL.ADMIN) {
    const institutionId = request.nextUrl.searchParams.get("institutionId");

    if (!institutionId) {
      return {
        error: NextResponse.json(
          { ok: false, error: "institutionId query parameter required for admin access" },
          { status: 400 }
        ),
      };
    }

    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      return {
        error: NextResponse.json(
          { ok: false, error: "Institution not found" },
          { status: 404 }
        ),
      };
    }

    return {
      session,
      callerId: "", // Admin isn't a teacher entity
      institutionId: institution.id,
    };
  }

  return {
    error: NextResponse.json(
      { ok: false, error: "Educator or admin access required" },
      { status: 403 }
    ),
  };
}

/**
 * Verify that a cohort is owned by the educator's Caller.
 */
export async function requireEducatorCohortOwnership(
  cohortId: string,
  educatorCallerId: string
) {
  const cohort = await prisma.cohortGroup.findUnique({
    where: { id: cohortId },
    include: {
      owner: { select: { id: true, name: true } },
      domain: { select: { id: true, slug: true, name: true } },
      _count: { select: { members: true } },
    },
  });

  if (!cohort) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Cohort not found" },
        { status: 404 }
      ),
    };
  }

  if (cohort.ownerId !== educatorCallerId) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      ),
    };
  }

  return { cohort };
}

/**
 * Verify that a student (Caller) is a member of one of the educator's cohorts.
 * Uses CallerCohortMembership join table for multi-cohort support,
 * with fallback to legacy Caller.cohortGroupId.
 */
export async function requireEducatorStudentAccess(
  studentCallerId: string,
  educatorCallerId: string
) {
  const student = await prisma.caller.findUnique({
    where: { id: studentCallerId },
    include: {
      // Legacy single-cohort relation (kept during migration)
      cohortGroup: {
        select: { id: true, name: true, ownerId: true },
      },
      // Multi-cohort memberships (preferred)
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

  if (!student) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Learner not found" },
        { status: 404 }
      ),
    };
  }

  // Check multi-cohort memberships first
  if (student.cohortMemberships && student.cohortMemberships.length > 0) {
    const ownedMembership = student.cohortMemberships.find(
      (m) => m.cohortGroup.ownerId === educatorCallerId
    );
    if (ownedMembership) {
      // Return student with cohortGroup pointing to the educator's owned cohort
      return {
        student: {
          ...student,
          cohortGroup: ownedMembership.cohortGroup,
        },
      };
    }
  }

  // Fallback to legacy single-cohort
  if (student.cohortGroup && student.cohortGroup.ownerId === educatorCallerId) {
    return { student };
  }

  return {
    error: NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 }
    ),
  };
}
