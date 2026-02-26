import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { requireEducator, isEducatorAuthError } from "@/lib/educator-access";
import { randomUUID } from "crypto";
import { assignPlaybookToCohort } from "@/lib/enrollment";

/**
 * @api GET /api/educator/classrooms
 * @visibility internal
 * @scope educator:read
 * @auth bearer
 * @tags educator, classrooms
 * @query institutionId - Optional institution ID for ADMIN+ users to view all classrooms in an institution
 * @description List all classrooms (cohort groups) owned by the educator, including domain info, member counts, and last activity timestamps. ADMIN+ users can pass ?institutionId= to view all classrooms in an institution.
 * @response 200 { ok: true, classrooms: [{ id, name, description, domain, memberCount, maxMembers, isActive, joinToken, lastActivity, createdAt }] }
 */
export async function GET(request: NextRequest) {
  const institutionId = request.nextUrl.searchParams.get("institutionId");

  let cohortFilter: Record<string, unknown>;

  if (institutionId) {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;
    cohortFilter = { institutionId, isActive: true };
  } else {
    const auth = await requireEducator();
    if (isEducatorAuthError(auth)) return auth.error;
    cohortFilter = { ownerId: auth.callerId };
  }

  const classrooms = await prisma.cohortGroup.findMany({
    where: cohortFilter,
    include: {
      domain: { select: { id: true, name: true, slug: true } },
      group: { select: { id: true, name: true, groupType: true } },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get last call date for each classroom via join table
  const classroomIds = classrooms.map((c) => c.id);
  const membershipRows = await prisma.callerCohortMembership.findMany({
    where: { cohortGroupId: { in: classroomIds } },
    select: { callerId: true, cohortGroupId: true },
  });

  const memberCallerIds = membershipRows.map((m) => m.callerId);
  const lastCallByClassroom = memberCallerIds.length > 0
    ? await prisma.call.groupBy({
        by: ["callerId"],
        where: {
          callerId: { in: memberCallerIds },
        },
        _max: { createdAt: true },
      })
    : [];

  // Map caller IDs to classrooms for last activity
  const callerToClassroom = new Map(
    membershipRows.map((m) => [m.callerId, m.cohortGroupId])
  );

  const classroomLastActivity = new Map<string, Date>();
  for (const row of lastCallByClassroom) {
    if (!row.callerId) continue;
    const classroomId = callerToClassroom.get(row.callerId);
    if (classroomId && row._max?.createdAt) {
      const current = classroomLastActivity.get(classroomId);
      if (!current || row._max.createdAt > current) {
        classroomLastActivity.set(classroomId, row._max.createdAt);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      domain: c.domain,
      group: c.group || null,
      memberCount: c._count.members,
      maxMembers: c.maxMembers,
      isActive: c.isActive,
      joinToken: c.joinToken,
      lastActivity: classroomLastActivity.get(c.id) ?? null,
      createdAt: c.createdAt,
    })),
  });
}

/**
 * @api POST /api/educator/classrooms
 * @visibility internal
 * @scope educator:write
 * @auth bearer
 * @tags educator, classrooms
 * @description Create a new classroom (cohort group) for the educator. Generates a join token for magic invite links.
 * @body name string - Classroom name (required)
 * @body description string - Optional description
 * @body domainId string - Domain to associate (required)
 * @body playbookIds string[] - Optional list of playbook IDs to assign. If omitted, all published playbooks for the domain are assigned.
 * @response 200 { ok: true, classroom: { id, name, description, domain, memberCount, joinToken, createdAt } }
 * @response 400 { ok: false, error: "Classroom name is required" }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function POST(request: NextRequest) {
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  const body = await request.json();
  const { name, description, domainId, playbookIds, groupId } = body;

  if (!name?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Classroom name is required" },
      { status: 400 }
    );
  }

  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "Domain is required" },
      { status: 400 }
    );
  }

  // Verify domain exists
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true },
  });

  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "Domain not found" },
      { status: 404 }
    );
  }

  // Generate a join token for magic invite links
  const joinToken = randomUUID().replace(/-/g, "").slice(0, 12);

  const classroom = await prisma.cohortGroup.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      domainId,
      ownerId: auth.callerId,
      joinToken,
      institutionId: auth.institutionId,
      groupId: groupId || undefined,
    },
    include: {
      domain: { select: { id: true, name: true, slug: true } },
      _count: { select: { members: true } },
    },
  });

  // Assign playbooks: use provided list or fall back to all published
  if (Array.isArray(playbookIds) && playbookIds.length > 0) {
    for (const pbId of playbookIds) {
      await assignPlaybookToCohort(classroom.id, pbId, "classroom-creation", false);
    }
  } else {
    const publishedPlaybooks = await prisma.playbook.findMany({
      where: { domainId, status: "PUBLISHED" },
      select: { id: true },
    });
    for (const pb of publishedPlaybooks) {
      await assignPlaybookToCohort(classroom.id, pb.id, "classroom-creation", false);
    }
  }

  return NextResponse.json({
    ok: true,
    classroom: {
      id: classroom.id,
      name: classroom.name,
      description: classroom.description,
      domain: classroom.domain,
      memberCount: classroom._count.members,
      joinToken: classroom.joinToken,
      createdAt: classroom.createdAt,
    },
  });
}
