import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/admin/masquerade/users
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin, masquerade
 * @query search - Optional name/email search filter
 * @query role - Optional role filter (e.g. EDUCATOR, STUDENT)
 * @description List users available to step in as (excludes current user, active only, max 50)
 * @response { users: Array<{ id, email, name, displayName, role, assignedDomainId, assignedDomain }> }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth("ADMIN", { skipMasquerade: true });
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const role = searchParams.get("role")?.trim() || "";

  const where: Record<string, unknown> = {
    id: { not: session.user.id }, // Exclude self
    isActive: true,
  };

  if (role) {
    where.role = role;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { displayName: { contains: search, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      displayName: true,
      role: true,
      assignedDomainId: true,
      assignedDomain: { select: { id: true, name: true } },
      institutionId: true,
      institution: { select: { id: true, name: true, primaryColor: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: 50,
  });

  return NextResponse.json({ users });
}
