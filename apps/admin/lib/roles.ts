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
