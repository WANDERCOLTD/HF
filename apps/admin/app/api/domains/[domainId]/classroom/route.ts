import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { randomUUID } from "crypto";
import { assignPlaybookToCohort } from "@/lib/enrollment";
import { TEACHING_CALLER_ROLES } from "@/lib/caller-roles";

/**
 * @api POST /api/domains/:domainId/classroom
 * @visibility internal
 * @auth OPERATOR
 * @tags domains, cohorts
 * @description Auto-create a classroom (cohort + join link) for a domain.
 *   Creates a TEACHER caller for the authenticated user if needed.
 *   Idempotent: returns existing cohort if one already exists for this owner+domain.
 * @pathParam domainId string - Domain ID
 * @body name string - Classroom name (optional, defaults to "{domain.name} Classroom")
 * @response 200 { ok: true, cohort: CohortGroup, joinToken: string }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const { domainId } = await params;
    const body = await req.json().catch(() => ({}));
    const classroomName = body.name;

    // 1. Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, slug: true, name: true },
    });
    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // 2. Find or create TEACHER caller for this user in this domain
    let teacherCaller = await prisma.caller.findFirst({
      where: {
        userId: session.user.id,
        domainId,
        role: { in: TEACHING_CALLER_ROLES },
      },
      select: { id: true },
    });

    if (!teacherCaller) {
      teacherCaller = await prisma.caller.create({
        data: {
          name: session.user.name || "Teacher",
          email: session.user.email || undefined,
          role: "TEACHER",
          userId: session.user.id,
          domainId,
          externalId: `teacher-${session.user.id}-${domainId}`,
        },
        select: { id: true },
      });
    }

    // 3. Find or create CohortGroup for this owner + domain
    const cohortInclude = {
      owner: { select: { id: true, name: true, email: true } },
      domain: { select: { id: true, slug: true, name: true } },
      _count: { select: { members: true } },
    };

    let cohort = await prisma.cohortGroup.findFirst({
      where: { domainId, ownerId: teacherCaller.id },
      include: cohortInclude,
    });

    if (!cohort) {
      cohort = await prisma.cohortGroup.create({
        data: {
          name: classroomName || `${domain.name} Classroom`,
          domainId,
          ownerId: teacherCaller.id,
          maxMembers: 50,
        },
        include: cohortInclude,
      });
    }

    // 4. Ensure join token exists
    let joinToken = cohort.joinToken;
    if (!joinToken) {
      joinToken = randomUUID().replace(/-/g, "").slice(0, 12);
      await prisma.cohortGroup.update({
        where: { id: cohort.id },
        data: { joinToken },
      });
    }

    // 5. Auto-assign domain's published playbooks to this cohort
    const publishedPlaybooks = await prisma.playbook.findMany({
      where: { domainId, status: "PUBLISHED" },
      select: { id: true },
    });
    for (const pb of publishedPlaybooks) {
      await assignPlaybookToCohort(cohort.id, pb.id, "classroom-creation", false);
    }

    return NextResponse.json({ ok: true, cohort, joinToken });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create classroom";
    console.error("Error creating classroom:", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
