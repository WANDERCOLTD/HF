import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import slugify from "slugify";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * @api GET /api/playbook-groups/:id
 * @visibility internal
 * @scope groups:read
 * @auth bearer
 * @tags groups, departments
 * @description Get a single playbook group with playbook and cohort counts.
 * @response 200 { ok: true, group: {...} }
 * @response 404 { ok: false, error: "Group not found" }
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await context.params;

  const group = await prisma.playbookGroup.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          playbooks: true,
          cohortGroups: true,
        },
      },
      playbooks: {
        select: { id: true, name: true, status: true },
        orderBy: { sortOrder: "asc" },
      },
      cohortGroups: {
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!group) {
    return NextResponse.json(
      { ok: false, error: "Group not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    group: {
      id: group.id,
      domainId: group.domainId,
      name: group.name,
      slug: group.slug,
      description: group.description,
      groupType: group.groupType,
      identityOverride: group.identityOverride,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      playbookCount: group._count.playbooks,
      cohortCount: group._count.cohortGroups,
      playbooks: group.playbooks,
      cohortGroups: group.cohortGroups,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    },
  });
}

/**
 * @api PATCH /api/playbook-groups/:id
 * @visibility internal
 * @scope groups:write
 * @auth bearer
 * @tags groups, departments
 * @body name string? - Updated name (also updates slug)
 * @body description string? - Updated description
 * @body groupType string? - Updated group type
 * @body identityOverride object? - Updated tone override
 * @body sortOrder number? - Updated sort order
 * @body isActive boolean? - Archive/unarchive
 * @description Update a playbook group's properties.
 * @response 200 { ok: true, group: {...} }
 * @response 404 { ok: false, error: "Group not found" }
 * @response 409 { ok: false, error: "Slug conflict" }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await context.params;
  const body = await request.json();

  const existing = await prisma.playbookGroup.findUnique({
    where: { id },
    select: { id: true, domainId: true },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Group not found" },
      { status: 404 }
    );
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    data.name = body.name.trim();
    data.slug = slugify(body.name.trim(), { lower: true, strict: true });

    // Check slug uniqueness
    const conflict = await prisma.playbookGroup.findUnique({
      where: {
        domainId_slug: {
          domainId: existing.domainId,
          slug: data.slug as string,
        },
      },
    });
    if (conflict && conflict.id !== id) {
      return NextResponse.json(
        { ok: false, error: `A group with slug "${data.slug}" already exists` },
        { status: 409 }
      );
    }
  }

  if (body.description !== undefined) data.description = body.description;
  if (body.groupType !== undefined) data.groupType = body.groupType;
  if (body.identityOverride !== undefined)
    data.identityOverride = body.identityOverride;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) data.isActive = body.isActive;

  const group = await prisma.playbookGroup.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ok: true,
    group: {
      id: group.id,
      domainId: group.domainId,
      name: group.name,
      slug: group.slug,
      description: group.description,
      groupType: group.groupType,
      identityOverride: group.identityOverride,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      updatedAt: group.updatedAt,
    },
  });
}

/**
 * @api DELETE /api/playbook-groups/:id
 * @visibility internal
 * @scope groups:write
 * @auth bearer
 * @tags groups, departments
 * @description Soft-delete (archive) a playbook group. Sets isActive=false and nulls groupId on child playbooks/cohorts.
 * @response 200 { ok: true, archived: true }
 * @response 404 { ok: false, error: "Group not found" }
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await context.params;

  const existing = await prisma.playbookGroup.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Group not found" },
      { status: 404 }
    );
  }

  // Soft delete: archive the group and unlink children
  await prisma.$transaction([
    prisma.playbook.updateMany({
      where: { groupId: id },
      data: { groupId: null },
    }),
    prisma.cohortGroup.updateMany({
      where: { groupId: id },
      data: { groupId: null },
    }),
    prisma.playbookGroup.update({
      where: { id },
      data: { isActive: false },
    }),
  ]);

  return NextResponse.json({ ok: true, archived: true });
}
