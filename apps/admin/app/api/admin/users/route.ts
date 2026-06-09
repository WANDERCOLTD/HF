import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/admin/users
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin
 * @description List all admin users with basic profile information (ADMIN role required)
 * @response 200 { users: User[] }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" }
 */
export async function GET() {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      displayName: true,
      role: true,
      isActive: true,
      createdAt: true,
      assignedDomainId: true,
      assignedDomain: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

/**
 * @api PATCH /api/admin/users
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin
 * @description Update a user's role or active status (ADMIN role required, cannot deactivate self)
 * @body id string - User ID to update
 * @body role string - New role value
 * @body isActive boolean - Whether user is active
 * @response 200 { user: User }
 * @response 400 { error: "User ID required" }
 * @response 400 { error: "Cannot deactivate your own account" }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" }
 */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const body = await req.json();
  const { id, role, isActive, name, displayName } = body;

  if (!id) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  // Prevent deactivating yourself
  if (id === session.user.id && isActive === false) {
    return NextResponse.json(
      { error: "Cannot deactivate your own account" },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (name !== undefined) updateData.name = name;
  if (displayName !== undefined) updateData.displayName = displayName;
  if (body.assignedDomainId !== undefined) updateData.assignedDomainId = body.assignedDomainId || null;

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      displayName: true,
      role: true,
      isActive: true,
      assignedDomainId: true,
      assignedDomain: { select: { id: true, name: true, slug: true } },
    },
  });

  return NextResponse.json({ user });
}

/**
 * @api DELETE /api/admin/users
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin
 * @description Delete a user and all related records (ADMIN role required, cannot delete self)
 * @query id string - User ID to delete
 * @response 200 { ok: true }
 * @response 400 { error: "User ID required" }
 * @response 400 { error: "Cannot delete your own account" }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" }
 */
export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  // Delete related records first, then the user.
  // #1341 — `Session` was renamed to `AuthSession` to make room for the
  // canonical learner-Session parent; this is NextAuth's session table.
  await prisma.$transaction([
    prisma.account.deleteMany({ where: { userId: id } }),
    prisma.authSession.deleteMany({ where: { userId: id } }),
    prisma.userTask.deleteMany({ where: { userId: id } }),
    prisma.user.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
