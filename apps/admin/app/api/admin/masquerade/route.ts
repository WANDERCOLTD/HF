import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { auditLog, AuditAction } from "@/lib/audit";
import {
  MASQUERADE_COOKIE,
  MASQUERADE_MAX_AGE,
  getMasqueradeState,
  isRoleEscalation,
  type MasqueradeState,
} from "@/lib/masquerade";

/**
 * @api GET /api/admin/masquerade
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin, masquerade
 * @description Get current masquerade state (or null if not masquerading)
 * @response { masquerade: MasqueradeState | null }
 */
export async function GET() {
  const authResult = await requireAuth("ADMIN", { skipMasquerade: true });
  if (isAuthError(authResult)) return authResult.error;

  const state = await getMasqueradeState();
  return NextResponse.json({ masquerade: state });
}

/**
 * @api POST /api/admin/masquerade
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin, masquerade
 * @body { userId: string }
 * @description Start stepping in as another user. Validates target exists, is active, and role is not escalated.
 * @response { ok: true, masquerade: MasqueradeState }
 */
export async function POST(request: Request) {
  const authResult = await requireAuth("ADMIN", { skipMasquerade: true });
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Prevent self-masquerade
  if (userId === session.user.id) {
    return NextResponse.json({ error: "Cannot masquerade as yourself" }, { status: 400 });
  }

  // Validate target user exists and is active
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      assignedDomainId: true,
      institutionId: true,
      institution: { select: { name: true } },
    },
  });

  if (!targetUser || !targetUser.isActive) {
    return NextResponse.json({ error: "User not found or inactive" }, { status: 404 });
  }

  // Prevent role escalation
  if (isRoleEscalation(session.user.role, targetUser.role)) {
    return NextResponse.json(
      { error: "Cannot masquerade as a user with higher role" },
      { status: 403 },
    );
  }

  // Build masquerade state
  const state: MasqueradeState = {
    userId: targetUser.id,
    email: targetUser.email,
    name: targetUser.name,
    role: targetUser.role,
    assignedDomainId: targetUser.assignedDomainId,
    institutionId: targetUser.institutionId,
    institutionName: targetUser.institution?.name ?? null,
    startedAt: new Date().toISOString(),
    startedBy: session.user.id,
  };

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(MASQUERADE_COOKIE, JSON.stringify(state), {
    path: "/",
    maxAge: MASQUERADE_MAX_AGE,
    sameSite: "strict",
    httpOnly: false,
  });

  // Audit log
  await auditLog({
    userId: session.user.id,
    userEmail: session.user.email,
    action: AuditAction.MASQUERADE_START,
    entityType: "User",
    entityId: targetUser.id,
    metadata: {
      targetEmail: targetUser.email,
      targetRole: targetUser.role,
    },
  });

  return NextResponse.json({ ok: true, masquerade: state });
}

/**
 * @api DELETE /api/admin/masquerade
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin, masquerade
 * @description Stop stepping in — clears masquerade cookie and audit-logs the exit.
 * @response { ok: true }
 */
export async function DELETE() {
  const authResult = await requireAuth("ADMIN", { skipMasquerade: true });
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  // Read current state for audit log
  const state = await getMasqueradeState();

  // Clear cookie
  const cookieStore = await cookies();
  cookieStore.delete(MASQUERADE_COOKIE);

  // Audit log
  await auditLog({
    userId: session.user.id,
    userEmail: session.user.email,
    action: AuditAction.MASQUERADE_STOP,
    entityType: "User",
    entityId: state?.userId,
    metadata: state
      ? { targetEmail: state.email, targetRole: state.role }
      : undefined,
  });

  return NextResponse.json({ ok: true });
}
