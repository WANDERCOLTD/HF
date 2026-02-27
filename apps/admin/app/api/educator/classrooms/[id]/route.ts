import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireEducator,
  isEducatorAuthError,
  requireEducatorCohortOwnership,
} from "@/lib/educator-access";

/**
 * @api GET /api/educator/classrooms/[id]
 * @visibility internal
 * @scope educator:read
 * @auth bearer
 * @tags educator, classrooms
 * @description Get classroom detail with member roster and basic stats. Requires educator ownership of the cohort.
 * @response 200 { ok: true, classroom: { id, name, description, domain, memberCount, maxMembers, isActive, joinToken, createdAt }, members: [{ id, name, email, totalCalls, lastCallAt, joinedAt }] }
 * @response 403 { ok: false, error: "Not authorized" }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  const { id } = await params;
  const ownership = await requireEducatorCohortOwnership(id, auth.callerId);
  if ("error" in ownership) return ownership.error;

  const { cohort } = ownership;

  // Get members via join table with call stats
  const memberships = await prisma.callerCohortMembership.findMany({
    where: { cohortGroupId: id },
    include: {
      caller: {
        include: {
          _count: { select: { calls: true } },
          calls: {
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const members = memberships
    .map((m) => m.caller)
    .filter((c) => c.role === "LEARNER")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return NextResponse.json({
    ok: true,
    classroom: {
      id: cohort.id,
      name: cohort.name,
      description: (cohort as any).description ?? null,
      domain: cohort.domain,
      memberCount: cohort._count.members,
      maxMembers: (cohort as any).maxMembers ?? 50,
      isActive: (cohort as any).isActive ?? true,
      joinToken: (cohort as any).joinToken ?? null,
      createdAt: (cohort as any).createdAt,
    },
    members: members.map((m) => ({
      id: m.id,
      name: m.name ?? "Unknown",
      email: m.email,
      totalCalls: m._count.calls,
      lastCallAt: m.calls[0]?.createdAt ?? null,
      joinedAt: m.createdAt,
    })),
  });
}

/**
 * @api DELETE /api/educator/classrooms/[id]
 * @visibility internal
 * @scope educator:write
 * @auth bearer
 * @tags educator, classrooms
 * @description Soft-delete a classroom by setting isActive to false. Requires educator ownership of the cohort.
 * @response 200 { ok: true }
 * @response 403 { ok: false, error: "Not authorized" }
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  const { id } = await params;
  const ownership = await requireEducatorCohortOwnership(id, auth.callerId);
  if ("error" in ownership) return ownership.error;

  await prisma.cohortGroup.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}

/**
 * @api PATCH /api/educator/classrooms/[id]
 * @visibility internal
 * @scope educator:write
 * @auth bearer
 * @tags educator, classrooms
 * @description Update classroom settings (name, description, isActive). Requires educator ownership of the cohort.
 * @body name? string - New classroom name
 * @body description? string - New description
 * @body isActive? boolean - Active status toggle
 * @body maxMembers? number - Maximum members allowed (1-500)
 * @response 200 { ok: true, classroom: { id, name, description, domain, memberCount, isActive } }
 * @response 400 { ok: false, error: "No updates provided" }
 * @response 403 { ok: false, error: "Not authorized" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  const { id } = await params;
  const ownership = await requireEducatorCohortOwnership(id, auth.callerId);
  if ("error" in ownership) return ownership.error;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Name cannot be empty" },
        { status: 400 }
      );
    }
    updates.name = body.name.trim();
  }

  if (body.description !== undefined) {
    updates.description = body.description?.trim() || null;
  }

  if (body.isActive !== undefined) {
    updates.isActive = Boolean(body.isActive);
  }

  if (body.maxMembers !== undefined) {
    const max = Number(body.maxMembers);
    if (!Number.isFinite(max) || max < 1 || max > 500) {
      return NextResponse.json(
        { ok: false, error: "maxMembers must be between 1 and 500" },
        { status: 400 }
      );
    }
    updates.maxMembers = max;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No updates provided" },
      { status: 400 }
    );
  }

  const updated = await prisma.cohortGroup.update({
    where: { id },
    data: updates,
    include: {
      domain: { select: { id: true, name: true, slug: true } },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    classroom: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      domain: updated.domain,
      memberCount: updated._count.members,
      isActive: updated.isActive,
    },
  });
}
