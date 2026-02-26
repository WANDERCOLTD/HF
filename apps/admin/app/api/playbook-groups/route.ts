import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import slugify from "slugify";

/**
 * @api GET /api/playbook-groups
 * @visibility internal
 * @scope groups:read
 * @auth bearer
 * @tags groups, departments
 * @query domainId - Required domain ID to list groups for
 * @query groupType - Optional filter by group type (DEPARTMENT, YEAR_GROUP, DIVISION, TRACK, CUSTOM)
 * @query includeInactive - Optional include archived groups (default: false)
 * @description List all playbook groups for a domain with playbook and cohort counts.
 * @response 200 { ok: true, groups: [...] }
 * @response 400 { ok: false, error: "domainId is required" }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const domainId = request.nextUrl.searchParams.get("domainId");
  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "domainId is required" },
      { status: 400 }
    );
  }

  const groupType = request.nextUrl.searchParams.get("groupType");
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true";

  const where: Record<string, unknown> = { domainId };
  if (groupType) where.groupType = groupType;
  if (!includeInactive) where.isActive = true;

  const groups = await prisma.playbookGroup.findMany({
    where,
    include: {
      _count: {
        select: {
          playbooks: true,
          cohortGroups: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    groups: groups.map((g) => ({
      id: g.id,
      domainId: g.domainId,
      name: g.name,
      slug: g.slug,
      description: g.description,
      groupType: g.groupType,
      identityOverride: g.identityOverride,
      sortOrder: g.sortOrder,
      isActive: g.isActive,
      playbookCount: g._count.playbooks,
      cohortCount: g._count.cohortGroups,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
}

/**
 * @api POST /api/playbook-groups
 * @visibility internal
 * @scope groups:write
 * @auth bearer
 * @tags groups, departments
 * @body domainId string - Domain to create group in
 * @body name string - Group name
 * @body description string? - Optional description
 * @body groupType string? - Group type (default: DEPARTMENT)
 * @body identityOverride object? - Tone override { toneSliders, styleNotes }
 * @body sortOrder number? - Sort order (default: 0)
 * @body bulk array? - Array of { name, description?, groupType?, identityOverride?, sortOrder? } for bulk creation
 * @description Create one or more playbook groups. Use `bulk` for batch creation from templates/AI.
 * @response 200 { ok: true, group: {...} } or { ok: true, groups: [...], count: N }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const body = await request.json();
  const { domainId, bulk } = body;

  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "domainId is required" },
      { status: 400 }
    );
  }

  // Verify domain exists
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true },
  });
  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "Domain not found" },
      { status: 404 }
    );
  }

  // Bulk creation
  if (Array.isArray(bulk) && bulk.length > 0) {
    const groups = await prisma.$transaction(
      bulk.map(
        (
          item: {
            name: string;
            description?: string;
            groupType?: string;
            identityOverride?: Record<string, unknown>;
            sortOrder?: number;
          },
          index: number
        ) =>
          prisma.playbookGroup.create({
            data: {
              domainId,
              name: item.name,
              slug: slugify(item.name, { lower: true, strict: true }),
              description: item.description || null,
              groupType: (item.groupType as any) || "DEPARTMENT",
              identityOverride: item.identityOverride || null,
              sortOrder: item.sortOrder ?? index,
            },
          })
      )
    );

    return NextResponse.json({
      ok: true,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        groupType: g.groupType,
        sortOrder: g.sortOrder,
      })),
      count: groups.length,
    });
  }

  // Single creation
  const { name, description, groupType, identityOverride, sortOrder } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "name is required" },
      { status: 400 }
    );
  }

  const slug = slugify(name.trim(), { lower: true, strict: true });

  // Check for duplicate slug in domain
  const existing = await prisma.playbookGroup.findUnique({
    where: { domainId_slug: { domainId, slug } },
  });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: `A group with slug "${slug}" already exists in this domain` },
      { status: 409 }
    );
  }

  const group = await prisma.playbookGroup.create({
    data: {
      domainId,
      name: name.trim(),
      slug,
      description: description || null,
      groupType: groupType || "DEPARTMENT",
      identityOverride: identityOverride || null,
      sortOrder: sortOrder ?? 0,
    },
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
      createdAt: group.createdAt,
    },
  });
}
