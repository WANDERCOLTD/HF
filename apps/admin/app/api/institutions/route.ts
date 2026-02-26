import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api GET /api/institutions
 * @auth ADMIN
 * @description List all institutions with user/cohort counts.
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const institutions = await prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { users: true, cohortGroups: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    institutions: institutions.map((i) => ({
      id: i.id,
      name: i.name,
      slug: i.slug,
      logoUrl: i.logoUrl,
      primaryColor: i.primaryColor,
      secondaryColor: i.secondaryColor,
      welcomeMessage: i.welcomeMessage,
      isActive: i.isActive,
      userCount: i._count.users,
      cohortCount: i._count.cohortGroups,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

/**
 * @api POST /api/institutions
 * @auth OPERATOR
 * @description Create a new institution.
 * @body name string (required)
 * @body slug string (required) — lowercase alphanumeric + hyphens
 * @body logoUrl string (optional)
 * @body primaryColor string (optional) — hex color
 * @body secondaryColor string (optional) — hex color
 * @body welcomeMessage string (optional)
 * @body typeId string (optional) — InstitutionType ID to link this institution to
 * @body typeSlug string (optional) — InstitutionType slug (resolved to typeId if typeId not provided)
 * @body terminologyOverrides object (optional) — per-institution terminology overrides (partial TermMap)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await request.json();
  const { name, slug, logoUrl, primaryColor, secondaryColor, welcomeMessage, typeId, typeSlug, terminologyOverrides } = body;

  if (!name?.trim() || !slug?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Name and slug are required" },
      { status: 400 }
    );
  }

  if (!/^[a-z0-9-]+$/.test(slug.trim())) {
    return NextResponse.json(
      { ok: false, error: "Slug must be lowercase alphanumeric with hyphens only" },
      { status: 400 }
    );
  }

  const existing = await prisma.institution.findUnique({
    where: { slug: slug.trim() },
  });

  if (existing) {
    return NextResponse.json(
      { ok: false, error: "An institution with this slug already exists" },
      { status: 409 }
    );
  }

  // Resolve institution type: explicit typeId, or look up by slug
  let resolvedTypeId = typeId || null;
  if (!resolvedTypeId && typeSlug) {
    const instType = await prisma.institutionType.findUnique({
      where: { slug: typeSlug },
      select: { id: true, terminology: true },
    });
    resolvedTypeId = instType?.id || null;
  }

  // Merge type terminology with any wizard overrides (overrides win)
  let resolvedTerminology: Record<string, string> | null = null;
  if (terminologyOverrides && typeof terminologyOverrides === "object") {
    if (resolvedTypeId) {
      const instType = await prisma.institutionType.findUnique({
        where: { id: resolvedTypeId },
        select: { terminology: true },
      });
      const base = (instType?.terminology as Record<string, string> | null) ?? {};
      resolvedTerminology = { ...base, ...terminologyOverrides };
    } else {
      resolvedTerminology = terminologyOverrides as Record<string, string>;
    }
  }

  const institution = await prisma.institution.create({
    data: {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      logoUrl: logoUrl?.trim() || null,
      primaryColor: primaryColor?.trim() || null,
      secondaryColor: secondaryColor?.trim() || null,
      welcomeMessage: welcomeMessage?.trim() || null,
      typeId: resolvedTypeId,
      ...(resolvedTerminology ? { terminology: resolvedTerminology } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    institution: {
      id: institution.id,
      name: institution.name,
      slug: institution.slug,
      logoUrl: institution.logoUrl,
      primaryColor: institution.primaryColor,
      secondaryColor: institution.secondaryColor,
      welcomeMessage: institution.welcomeMessage,
      isActive: institution.isActive,
    },
  });
}
