import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TEACHING_CALLER_ROLES } from "@/lib/caller-roles";

/**
 * @api POST /api/courses/:courseId/learners/ensure-cohort
 * @visibility internal
 * @auth OPERATOR
 * @tags courses, cohorts, learners
 * @description Idempotently find-or-create a default cohort for a course.
 *   Returns the existing cohort if one is already linked via CohortPlaybook,
 *   otherwise creates a new CohortGroup + CohortPlaybook in a transaction.
 * @pathParam courseId string - Playbook (course) ID
 * @response 200 { ok: true, cohortId: string, joinToken: string }
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    // 1. Load the playbook (course)
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, domainId: true },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 }
      );
    }

    // 2. Find existing default cohort linked to this course
    const existing = await prisma.cohortGroup.findFirst({
      where: { playbooks: { some: { playbookId: courseId } } },
      include: { playbooks: true },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        cohortId: existing.id,
        joinToken: existing.joinToken,
      });
    }

    // 3. Find-or-create a teacher caller for the admin (required as cohort owner)
    const session = auth.session;
    let ownerCaller = await prisma.caller.findFirst({
      where: { userId: session.user.id, domainId: playbook.domainId, role: { in: TEACHING_CALLER_ROLES } },
      select: { id: true },
    });
    if (!ownerCaller) {
      ownerCaller = await prisma.caller.create({
        data: {
          name: session.user.name || "Admin",
          email: session.user.email || undefined,
          role: "TEACHER",
          userId: session.user.id,
          domainId: playbook.domainId,
          externalId: `teacher-${session.user.id}-${playbook.domainId}`,
        },
        select: { id: true },
      });
    }

    // 4. Create cohort + link in a transaction
    const joinToken = crypto.randomUUID().slice(0, 12);

    const newCohort = await prisma.$transaction(async (tx) => {
      const cohort = await tx.cohortGroup.create({
        data: {
          name: `${playbook.name} — Learners`,
          domainId: playbook.domainId,
          ownerId: ownerCaller.id,
          joinToken,
          isActive: true,
        },
      });

      await tx.cohortPlaybook.create({
        data: {
          cohortGroupId: cohort.id,
          playbookId: courseId,
          assignedBy: "course-learners-tab",
        },
      });

      return cohort;
    });

    return NextResponse.json({
      ok: true,
      cohortId: newCohort.id,
      joinToken: newCohort.joinToken,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to ensure cohort";
    console.error("Error ensuring cohort:", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
