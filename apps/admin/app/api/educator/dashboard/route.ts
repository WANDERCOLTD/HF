import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError, ROLE_LEVEL } from "@/lib/permissions";
import { requireEducator, isEducatorAuthError } from "@/lib/educator-access";

/**
 * @api GET /api/educator/dashboard
 * @visibility internal
 * @scope educator:read
 * @auth bearer
 * @tags educator, dashboard
 * @query institutionId - Optional institution ID for ADMIN+ users to view a specific school
 * @description Educator dashboard overview with classroom list, aggregate stats (total students, active this week), recent calls, and students needing attention (no calls in 7+ days). ADMIN+ users can pass ?institutionId= to view any school.
 * @response 200 { ok: true, classrooms: [...], stats: { classroomCount, totalStudents, activeThisWeek }, recentCalls: [...], needsAttention: [...] }
 */
export async function GET(request: NextRequest) {
  const institutionId = request.nextUrl.searchParams.get("institutionId");

  // ADMIN+ with institutionId: view any school's dashboard (all cohorts in that institution)
  if (institutionId) {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;
    return buildDashboardForInstitution(institutionId);
  }

  // Educator path: scoped to own cohorts (or institution for ADMIN+)
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  // ADMIN+ with educator profile: show all cohorts in their institution
  const role = auth.session.user.role;
  if (ROLE_LEVEL[role] >= ROLE_LEVEL.ADMIN && auth.institutionId) {
    return buildDashboardForInstitution(auth.institutionId);
  }

  return buildDashboardForEducator(auth.callerId);
}

// ── Shared dashboard builder ────────────────────────────────────

function buildCohortFilter(mode: { educatorCallerId: string } | { institutionId: string }) {
  if ("educatorCallerId" in mode) {
    return { ownerId: mode.educatorCallerId, isActive: true };
  }
  return { institutionId: mode.institutionId, isActive: true };
}

async function buildDashboard(cohortWhere: ReturnType<typeof buildCohortFilter>) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [classrooms, totalStudents, activeStudents, recentCalls, needsAttention] =
    await Promise.all([
      prisma.cohortGroup.findMany({
        where: cohortWhere,
        include: {
          domain: { select: { id: true, name: true, slug: true } },
          owner: { select: { id: true, name: true } },
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: "desc" },
      }),

      prisma.caller.count({
        where: {
          cohortGroup: cohortWhere,
          role: "LEARNER",
        },
      }),

      prisma.caller.count({
        where: {
          cohortGroup: cohortWhere,
          role: "LEARNER",
          calls: { some: { createdAt: { gte: sevenDaysAgo } } },
        },
      }),

      prisma.call.findMany({
        where: {
          caller: {
            cohortGroup: cohortWhere,
            role: "LEARNER",
          },
        },
        include: {
          caller: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),

      prisma.caller.findMany({
        where: {
          cohortGroup: cohortWhere,
          role: "LEARNER",
          OR: [
            { calls: { none: {} } },
            { calls: { every: { createdAt: { lt: sevenDaysAgo } } } },
          ],
        },
        include: {
          cohortGroup: { select: { name: true } },
        },
        take: 10,
      }),
    ]);

  return NextResponse.json({
    ok: true,
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      owner: c.owner,
      memberCount: c._count.members,
      createdAt: c.createdAt,
    })),
    stats: {
      classroomCount: classrooms.length,
      totalStudents,
      activeThisWeek: activeStudents,
    },
    recentCalls: recentCalls.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      studentName: c.caller?.name ?? "Unknown",
      studentId: c.caller?.id,
    })),
    needsAttention: needsAttention.map((s) => ({
      id: s.id,
      name: s.name ?? "Unknown",
      classroom: s.cohortGroup?.name ?? "Unknown",
    })),
  });
}

async function buildDashboardForEducator(callerId: string) {
  return buildDashboard({ ownerId: callerId, isActive: true });
}

async function buildDashboardForInstitution(institutionId: string) {
  return buildDashboard({ institutionId, isActive: true });
}
