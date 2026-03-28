import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEFAULT_BRANDING } from "@/lib/branding";

/**
 * @api GET /api/institution/branding
 * @auth VIEWER (any authenticated user)
 * @description Get branding for the current user's institution.
 *   Returns default branding if user has no institution.
 */
export async function GET() {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { session } = auth;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      activeInstitutionId: true,
      institutionId: true,
      activeInstitution: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          welcomeMessage: true,
          type: { select: { name: true } },
        },
      },
      institution: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          welcomeMessage: true,
          type: { select: { name: true } },
        },
      },
    },
  });

  // Prioritize activeInstitution (user's current selection) over institution (default assignment)
  const branding = user?.activeInstitution || user?.institution;

  if (!branding) {
    return NextResponse.json({ ok: true, branding: DEFAULT_BRANDING });
  }

  return NextResponse.json({
    ok: true,
    branding: {
      name: branding.name,
      typeName: branding.type?.name ?? null,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      welcomeMessage: branding.welcomeMessage,
    },
  });
}

/**
 * @api PATCH /api/institution/branding
 * @auth ADMIN
 * @description Update branding for the current user's institution.
 * @body { logoUrl?: string, primaryColor?: string, secondaryColor?: string, welcomeMessage?: string }
 */
export async function PATCH(req: Request) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { session } = auth;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { activeInstitutionId: true, institutionId: true },
  });

  const institutionId = user?.activeInstitutionId || user?.institutionId;
  if (!institutionId) {
    return NextResponse.json({ ok: false, error: "No institution assigned" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, string | null> = {};
  if ("logoUrl" in body) data.logoUrl = body.logoUrl || null;
  if ("primaryColor" in body) data.primaryColor = body.primaryColor || null;
  if ("secondaryColor" in body) data.secondaryColor = body.secondaryColor || null;
  if ("welcomeMessage" in body) data.welcomeMessage = body.welcomeMessage || null;

  await prisma.institution.update({
    where: { id: institutionId },
    data,
  });

  return NextResponse.json({ ok: true });
}
