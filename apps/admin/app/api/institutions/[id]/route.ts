import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api GET /api/institutions/[id]
 * @auth SUPERADMIN
 * @description Get a single institution by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;

  const institution = await prisma.institution.findUnique({
    where: { id },
    include: {
      type: { select: { id: true, slug: true, name: true } },
      _count: { select: { users: true, cohortGroups: true } },
    },
  });

  if (!institution) {
    return NextResponse.json(
      { ok: false, error: "Institution not found" },
      { status: 404 }
    );
  }

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
      terminology: institution.terminology,
      isActive: institution.isActive,
      type: institution.type,
      userCount: institution._count.users,
      cohortCount: institution._count.cohortGroups,
      createdAt: institution.createdAt.toISOString(),
    },
  });
}

/**
 * @api PATCH /api/institutions/[id]
 * @auth ADMIN
 * @description Update institution fields (name, branding, type, active status).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { name, logoUrl, primaryColor, secondaryColor, welcomeMessage, isActive, terminology, typeId } = body;

  // Build update object from provided fields only
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (logoUrl !== undefined) updates.logoUrl = logoUrl?.trim() || null;
  if (primaryColor !== undefined) updates.primaryColor = primaryColor?.trim() || null;
  if (secondaryColor !== undefined) updates.secondaryColor = secondaryColor?.trim() || null;
  if (welcomeMessage !== undefined) updates.welcomeMessage = welcomeMessage?.trim() || null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (terminology !== undefined) {
    if (terminology === null) {
      updates.terminology = null;
    } else if (terminology?.preset && typeof terminology.preset === "string") {
      updates.terminology = terminology;
    }
  }
  if (typeId !== undefined) updates.typeId = typeId || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const institution = await prisma.institution.update({
      where: { id },
      data: updates,
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
        terminology: institution.terminology,
        isActive: institution.isActive,
      },
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json(
        { ok: false, error: "Institution not found" },
        { status: 404 }
      );
    }
    console.error("[PATCH /api/institutions/[id]]", e);
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/institutions/[id]
 * @auth SUPERADMIN
 * @description Soft-delete an institution (sets isActive = false).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;

  try {
    await prisma.institution.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ ok: true, message: "Institution deactivated" });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json(
        { ok: false, error: "Institution not found" },
        { status: 404 }
      );
    }
    console.error("[DELETE /api/institutions/[id]]", e);
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
