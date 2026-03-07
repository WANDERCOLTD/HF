import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api GET /api/institution/context
 * @auth VIEWER (any authenticated user)
 * @description Returns the current user's institution and primary domain IDs.
 *   Used by the Institution Settings hub to resolve which domain to configure.
 *   Prioritises activeInstitution (masquerade) over assigned institution.
 */
export async function GET() {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { session } = auth;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      assignedDomainId: true,
      activeInstitutionId: true,
      institutionId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  const institutionId = user.activeInstitutionId || user.institutionId;

  if (!institutionId) {
    return NextResponse.json({ ok: false, error: "No institution assigned" }, { status: 404 });
  }

  // Get institution with its domains
  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      welcomeMessage: true,
      terminology: true,
      type: { select: { id: true, slug: true, name: true } },
      domains: {
        where: { isActive: true },
        select: { id: true, name: true, isDefault: true },
        orderBy: { isDefault: "desc" },
        take: 5,
      },
    },
  });

  if (!institution) {
    return NextResponse.json({ ok: false, error: "Institution not found" }, { status: 404 });
  }

  // Resolve primary domain: user's assigned domain > institution's default > first active
  const domainId =
    user.assignedDomainId ||
    institution.domains.find((d) => d.isDefault)?.id ||
    institution.domains[0]?.id ||
    null;

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
      typeName: institution.type?.name ?? null,
    },
    domainId,
    domains: institution.domains,
  });
}
