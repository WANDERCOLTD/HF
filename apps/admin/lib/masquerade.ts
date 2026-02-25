/**
 * Masquerade — Server-side helpers for user impersonation.
 *
 * Allows ADMIN/SUPERADMIN users to temporarily adopt another user's
 * identity (role, domain scoping) for testing and support.
 *
 * Cookie `hf.masquerade` stores the masqueraded user's identity.
 * Read by `requireAuth()` in permissions.ts to transparently override
 * the session user on every authenticated request.
 */

import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { ROLE_LEVEL } from "@/lib/roles";

export const MASQUERADE_COOKIE = "hf.masquerade";
export const MASQUERADE_MAX_AGE = 8 * 60 * 60; // 8 hours
export interface MasqueradeState {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
  assignedDomainId: string | null;
  institutionId: string | null;
  institutionName: string | null;
  startedAt: string;
  startedBy: string;
}

/**
 * Read masquerade state from cookie. Returns null if not masquerading or invalid.
 */
export async function getMasqueradeState(): Promise<MasqueradeState | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(MASQUERADE_COOKIE)?.value;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    // Validate required fields
    if (!parsed.userId || !parsed.role || !parsed.startedBy) return null;
    return parsed as MasqueradeState;
  } catch {
    return null;
  }
}

/**
 * Check if a user role is ADMIN+ (allowed to masquerade).
 */
export function canMasquerade(role: string): boolean {
  return (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL.ADMIN;
}

/**
 * Check that a masqueraded role doesn't exceed the real user's role (prevent escalation).
 */
export function isRoleEscalation(realRole: string, masqueradeRole: string): boolean {
  return (ROLE_LEVEL[masqueradeRole] ?? 0) > (ROLE_LEVEL[realRole] ?? 0);
}

/**
 * Build audit metadata for actions performed during masquerade.
 * Returns undefined when not masquerading (no extra metadata needed).
 */
export async function getMasqueradeAuditMeta(): Promise<Record<string, string> | undefined> {
  const state = await getMasqueradeState();
  if (!state) return undefined;
  return {
    masqueradeUserId: state.userId,
    masqueradeUserEmail: state.email,
    masqueradedBy: state.startedBy,
  };
}
