// Helper extracted from /api/join/[token]/route.ts so multiple intake
// routes (join, intake/v2/start, future enrol paths) can share the
// "is this request already carrying an OPERATOR+ session cookie?"
// check. Used to decide whether to call mintAndSetSessionCookie with
// `{ skipCookie: true }` — preserving the admin's session when an
// admin accidentally walks through a learner-creation flow.

import { decode } from "next-auth/jwt";
import { ROLE_LEVEL } from "@/lib/roles";
import type { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";

export const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

/**
 * True when the incoming request already has a session cookie that
 * decodes to a role strictly above STUDENT. Returns false when:
 *   - no secret is configured (defensive — never claim "yes" in this case)
 *   - no recognised session cookie is present
 *   - all session cookies fail to decode (forged / expired / wrong-secret)
 *   - the decoded role is STUDENT or below
 *
 * Callers pass the result through to `mintAndSetSessionCookie(response,
 * user, { skipCookie })` so the existing admin session is preserved.
 */
export async function hasHigherRoleSession(
  request: NextRequest | Request,
): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return false;
  const cookies = (request as NextRequest).cookies ?? null;
  if (!cookies) return false;
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = cookies.get(name);
    if (!cookie) continue;
    try {
      const token = await decode({ token: cookie.value, secret, salt: name });
      const role = token?.role as UserRole | undefined;
      if (role && ROLE_LEVEL[role] > ROLE_LEVEL.STUDENT) return true;
    } catch {
      /* invalid token — try next cookie name */
    }
  }
  return false;
}
