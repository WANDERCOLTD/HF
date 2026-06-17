/**
 * CallerRole helpers — pinned subsets derived from the Prisma enum.
 *
 * `CallerRole` is the entity-side role on a `Caller` row (LEARNER /
 * TEACHER / TUTOR / PARENT / MENTOR) — distinct from `UserRole`
 * (SUPERADMIN / ADMIN / ... in `lib/roles.ts`) which gates session-level
 * privileges.
 *
 * Use these subsets instead of hand-typed `["TEACHER", "TUTOR"]` literals
 * in API routes and DB queries. Schema additions land in one place.
 */

import { CallerRole } from "@prisma/client";

/**
 * Caller roles that represent active *teaching* (curriculum-owning,
 * cohort-supervising) responsibility. Used to find the teaching caller
 * inside a domain or cohort.
 *
 *   TEACHER  — owns cohort groups, sees pupil dashboards
 *   TUTOR    — 1-1 tutor, owns small groups or individual supervision
 *
 * Suitable for Prisma `where: { role: { in: TEACHING_CALLER_ROLES } }`.
 */
export const TEACHING_CALLER_ROLES: CallerRole[] = [
  CallerRole.TEACHER,
  CallerRole.TUTOR,
];

/** Predicate sibling of `TEACHING_CALLER_ROLES` for runtime equality checks. */
export function isTeachingCallerRole(
  role: CallerRole | string | null | undefined,
): boolean {
  return role === CallerRole.TEACHER || role === CallerRole.TUTOR;
}
