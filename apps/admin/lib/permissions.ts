/**
 * Role-Based Access Control
 *
 * Provides requireAuth() helper for API route handlers.
 * Role hierarchy: SUPERADMIN > ADMIN > OPERATOR > SUPER_TESTER > TESTER > DEMO
 *
 * Usage:
 *   const authResult = await requireAuth("OPERATOR");
 *   if (isAuthError(authResult)) return authResult.error;
 *   const { session } = authResult;
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";
import { getMasqueradeState, canMasquerade, isRoleEscalation } from "@/lib/masquerade";

// Re-export from client-safe module so existing server imports still work
export { ROLE_LEVEL } from "@/lib/roles";

type AuthSuccess = { session: Session };
type AuthFailure = { error: NextResponse };
type AuthResult = AuthSuccess | AuthFailure;

interface RequireAuthOptions {
  /** Skip masquerade override — use the real JWT identity. Required for masquerade management routes. */
  skipMasquerade?: boolean;
}

/**
 * Require authentication with minimum role.
 * Returns session on success, or a NextResponse error on failure.
 *
 * When a masquerade cookie is present and the real user is ADMIN+,
 * the returned session.user is overridden with the masqueraded identity.
 * The real admin's user ID is preserved in session.masqueradedBy.
 *
 * Pass `{ skipMasquerade: true }` for routes that need the real admin identity
 * (e.g., the masquerade management API itself).
 */
export async function requireAuth(
  minRole: UserRole = "VIEWER",
  options?: RequireAuthOptions,
): Promise<AuthResult> {
  let session;
  try {
    session = await auth();
  } catch (e) {
    console.error("[requireAuth] auth() threw:", (e as Error).message);
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // ── Masquerade override ──
  // If cookie exists and real user is ADMIN+, swap session identity.
  // Role escalation is blocked (can't masquerade as higher role).
  // Skipped when { skipMasquerade: true } (used by masquerade management routes).
  if (!options?.skipMasquerade) {
    const masquerade = await getMasqueradeState();
    if (masquerade && canMasquerade(session.user.role)) {
      if (!isRoleEscalation(session.user.role, masquerade.role)) {
        const realUserId = session.user.id;
        session.user = {
          ...session.user,
          id: masquerade.userId,
          email: masquerade.email,
          name: masquerade.name,
          role: masquerade.role,
          assignedDomainId: masquerade.assignedDomainId,
          institutionId: masquerade.institutionId,
        };
        (session as any).masqueradedBy = realUserId;
      }
    }
  }

  const userLevel = ROLE_LEVEL[session.user.role] ?? 0;
  const requiredLevel = ROLE_LEVEL[minRole] ?? 0;

  if (userLevel < requiredLevel) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session };
}

/**
 * Type guard: check if result is an auth error response.
 */
export function isAuthError(result: AuthResult): result is AuthFailure {
  return "error" in result;
}

/**
 * Page-level auth guard for server components.
 * Checks session and minimum role, redirects to /x if insufficient.
 * Returns the session on success.
 *
 * Usage in server component pages:
 *   const session = await requirePageAuth("OPERATOR");
 */
export async function requirePageAuth(minRole: UserRole = "VIEWER") {
  // Dynamic import to avoid pulling next/navigation into API route bundles
  const { redirect } = await import("next/navigation");

  const session = await auth();
  if (!session?.user) {
    return redirect("/login") as never;
  }

  const userLevel = ROLE_LEVEL[session.user.role] ?? 0;
  const requiredLevel = ROLE_LEVEL[minRole] ?? 0;

  if (userLevel < requiredLevel) {
    redirect("/x");
  }

  return session;
}
