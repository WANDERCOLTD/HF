/**
 * Canonical `Parameter.domainGroup` taxonomy v1.0 (#1948).
 *
 * The DB has NO `CHECK` constraint on `Parameter.domainGroup`. The
 * canonical set is pinned by
 * `tests/lib/registry/parameter-domain-group-taxonomy.test.ts` — but
 * that fires AT CI TIME, not at admin runtime. A route that writes
 * `domainGroup: "general" | "lab" | "imported" | "teaching"` can land
 * silently in DB, then break the next CI run that touches the
 * registry.
 *
 * This module is the single source of truth for runtime callers. Sync
 * routes, lab-feature activation, and any future bulk-write surface
 * MUST go through `resolveCanonicalDomainGroup()` and refuse the write
 * if it returns null.
 *
 * Audit trail:
 *  - sync-parameters/route.ts hit the fallback bug class (PR #2029)
 *  - lab/features/[id]/activate/route.ts hit the same bug class
 *    twice (this PR's fix)
 *  - LastParms audit 2026-06-19 identified 4 unguarded silent-fallback
 *    sites total
 *
 * Cross-pin: `CANONICAL_DOMAIN_GROUPS.size === 12` is asserted by every
 * import-site's test so if `parameter-domain-group-taxonomy.test.ts`
 * extends the tuple, the per-route tests fire too.
 */

export const CANONICAL_DOMAIN_GROUPS = new Set([
  "behavior-core",
  "learning-adaptation",
  "curriculum-adaptation",
  "personality-adaptation",
  "supervision",
  "companion",
  "engagement",
  "reinforcement",
  "onboarding",
  "voice-delivery",
  "learner-model",
  "affect-motivation",
] as const);

/**
 * Resolve a canonical domainGroup from spec/param data, or return null.
 * Callers MUST refuse the write when this returns null — silent
 * fallback to a non-canonical value is the bug class this helper
 * exists to prevent.
 *
 * Resolution order:
 *  1. `paramData.domainGroup` (the canonical field)
 *  2. `paramData.section` (legacy field name in some specs)
 *  3. null (caller must error)
 */
export function resolveCanonicalDomainGroup(
  paramData: { domainGroup?: unknown; section?: unknown } | null,
): string | null {
  if (!paramData) return null;
  for (const candidate of [paramData.domainGroup, paramData.section]) {
    if (
      typeof candidate === "string" &&
      CANONICAL_DOMAIN_GROUPS.has(candidate as never)
    ) {
      return candidate;
    }
  }
  return null;
}
