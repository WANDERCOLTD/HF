import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { TECHNICAL_TERMS } from "@/lib/terminology";

/**
 * @api GET /api/admin/terminology
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin
 * @description Returns all institution types with their terminology presets,
 *   plus the technical terms baseline. Used by the access-control page terminology tab.
 * @response 200 { ok: true, technicalTerms: TermMap }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const types = await prisma.institutionType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      terminology: true,
      _count: { select: { institutions: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    technicalTerms: TECHNICAL_TERMS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    types: types.map((t: any) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      terminology: t.terminology,
      institutionCount: t._count.institutions,
    })),
  });
}
