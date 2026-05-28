import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/user/wizard-context
 * @visibility internal
 * @scope user:read
 * @auth bearer (OPERATOR+)
 * @tags user, wizard
 * @description Resolve the logged-in user's home institution + domain for the
 * V5 wizard. Mirrors the server-side derivation in
 * `app/x/get-started-v5/page.tsx` so the wizard can re-fetch a clean context
 * after Start Over without replaying stale client-side `initialContext`.
 *
 * Preference order:
 *   1. session.user.institutionId (JWT-stamped — the user's true home)
 *   2. session.user.assignedDomainId picks within the institution's domains
 *   3. First active domain on the institution (orderBy createdAt asc)
 *
 * Returns `null` fields when the user has no institution / no active domain
 * (SUPERADMIN typical case) — callers must handle that branch.
 *
 * @response { ok: true, context: { institutionId, institutionName, domainId, domainKind, typeSlug } | null }
 */
export async function GET() {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const institutionId = session.user.institutionId;
  if (!institutionId) {
    return NextResponse.json({ ok: true, context: null });
  }

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId, isActive: true },
    select: {
      id: true,
      name: true,
      type: { select: { slug: true } },
      domains: {
        where: { isActive: true },
        select: { id: true, kind: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      },
    },
  });

  if (!institution || institution.domains.length === 0) {
    return NextResponse.json({ ok: true, context: null });
  }

  let domainId = institution.domains[0].id;
  let domainKind: "INSTITUTION" | "COMMUNITY" = institution.domains[0].kind as "INSTITUTION" | "COMMUNITY";

  if (session.user.assignedDomainId) {
    const match = institution.domains.find((d) => d.id === session.user.assignedDomainId);
    if (match) {
      domainId = match.id;
      domainKind = match.kind as "INSTITUTION" | "COMMUNITY";
    }
  }

  return NextResponse.json({
    ok: true,
    context: {
      institutionId: institution.id,
      institutionName: institution.name,
      domainId,
      domainKind,
      typeSlug: institution.type?.slug ?? null,
    },
  });
}
