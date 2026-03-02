import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/user/institutions
 * @visibility internal
 * @scope user:read
 * @auth bearer
 * @tags user, institutions
 * @description Get institutions the current user can access
 * - SUPERADMIN: all active institutions
 * - ADMIN/OPERATOR: their assigned institution only
 * - EDUCATOR/TESTER: their assigned institution
 * - Others: their assigned institution
 * @response { institutions: Array<{ id, name, slug, logoUrl, primaryColor, typeSlug, domainId }> }
 */
export async function GET() {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const roleLevel: Record<string, number> = {
    SUPERADMIN: 5,
    ADMIN: 4,
    OPERATOR: 3,
  };

  const isSuperAdmin = (roleLevel[session.user.role] ?? 0) >= 5;

  const select = {
    id: true,
    name: true,
    slug: true,
    logoUrl: true,
    primaryColor: true,
    type: { select: { slug: true, defaultDomainKind: true } },
    domains: { select: { id: true }, take: 1 },
  } as const;

  let raw;

  if (isSuperAdmin) {
    raw = await prisma.institution.findMany({
      where: { isActive: true },
      select,
      orderBy: { name: "asc" },
    });
  } else {
    if (!session.user.institutionId) {
      return NextResponse.json({ ok: true, institutions: [] });
    }

    raw = await prisma.institution.findMany({
      where: { id: session.user.institutionId, isActive: true },
      select,
    });
  }

  const institutions = raw.map((i) => ({
    id: i.id,
    name: i.name,
    slug: i.slug,
    logoUrl: i.logoUrl,
    primaryColor: i.primaryColor,
    typeSlug: i.type?.slug ?? null,
    defaultDomainKind: i.type?.defaultDomainKind ?? null,
    domainId: i.domains[0]?.id ?? null,
  }));

  return NextResponse.json({ ok: true, institutions });
}
