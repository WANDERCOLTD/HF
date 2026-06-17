/**
 * Role hierarchy constants — safe for both server and client components.
 *
 * Extracted from permissions.ts so client components can import role levels
 * without pulling in server-only dependencies (next/headers via masquerade.ts).
 */

import type { UserRole } from "@prisma/client";

/** Higher number = more access */
export const ROLE_LEVEL: Record<UserRole, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  EDUCATOR: 3, // Same level as OPERATOR — scoped to own cohorts + students
  SUPER_TESTER: 2,
  TESTER: 1,
  STUDENT: 1, // Same level as TESTER — scoped to own data via student-access.ts
  DEMO: 0,
  VIEWER: 1, // @deprecated — alias for TESTER level
};

/**
 * Runtime check: does the role have at-or-above the given minimum level?
 *
 * Use this instead of hand-rolling `["SUPERADMIN", "ADMIN", ...].includes(role)`.
 * Adding a new role at the same level works automatically.
 *
 *   isRoleAtOrAbove("EDUCATOR", "OPERATOR") // true  (both level 3)
 *   isRoleAtOrAbove("TESTER",   "OPERATOR") // false (level 1 vs 3)
 */
export function isRoleAtOrAbove(
  role: UserRole | string | null | undefined,
  minRole: UserRole,
): boolean {
  if (!role) return false;
  const userLevel = ROLE_LEVEL[role as UserRole] ?? 0;
  const minLevel = ROLE_LEVEL[minRole] ?? 0;
  return userLevel >= minLevel;
}

/**
 * "Operator-track admin" — SUPERADMIN, ADMIN, OPERATOR.
 *
 * NOTE: This deliberately excludes EDUCATOR even though EDUCATOR is at
 * level 3 (same as OPERATOR per `ROLE_LEVEL`). EDUCATOR is a separate
 * track with its own portal under `app/educator/` and does not see the
 * OPERATOR-track dashboard. This is a track distinction, not a level one.
 *
 * For pure level checks that should include EDUCATOR, use
 * `isRoleAtOrAbove(role, "OPERATOR")` instead.
 */
export function isOperatorTrackAdmin(
  role: UserRole | string | null | undefined,
): boolean {
  return role === "SUPERADMIN" || role === "ADMIN" || role === "OPERATOR";
}

/**
 * List the UserRole members at-or-above the given minimum level.
 *
 * Use this in Prisma `where: { role: { in: rolesAtOrAbove("OPERATOR") } }`
 * — the result is suitable for any consumer that needs a literal enum-value
 * array (Prisma queries cannot filter on a computed level).
 *
 *   rolesAtOrAbove("ADMIN")    // ["SUPERADMIN", "ADMIN"]
 *   rolesAtOrAbove("OPERATOR") // ["SUPERADMIN", "ADMIN", "OPERATOR", "EDUCATOR"]
 */
export function rolesAtOrAbove(minRole: UserRole): UserRole[] {
  const minLevel = ROLE_LEVEL[minRole] ?? 0;
  return (Object.keys(ROLE_LEVEL) as UserRole[]).filter(
    (r) => ROLE_LEVEL[r] >= minLevel && r !== "VIEWER", // exclude deprecated alias
  );
}
