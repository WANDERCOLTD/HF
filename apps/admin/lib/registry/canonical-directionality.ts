/**
 * Canonical `Parameter.directionality` taxonomy (#2031 S5).
 *
 * The DB has NO `CHECK` constraint on `Parameter.directionality` — it's
 * a free-form `String`. Surveyed values from the active write surface:
 *
 *   - `seed-from-specs.ts`, `seed-prosody-parameters.ts`,
 *     `seed-tolerance-parameters.ts`,
 *     `app/api/lab/features/[id]/activate/route.ts` → `"positive"`
 *   - `app/api/admin/sync-parameters/route.ts` → `"bidirectional"`
 *   - Archived seeds carry `"neutral"`, `"negative"` (lowercase) and
 *     SCREAMING_SNAKE variants (`"POSITIVE" | "NEUTRAL" | "ADAPTIVE"
 *     | "NEGATIVE"`)
 *
 * Epic #2031 names the canonical lowercase tuple:
 * `"positive" | "negative" | "bidirectional"`. We include `"neutral"`
 * for backward compatibility with rows the canonical seed paths already
 * write — refusing it would surface as a regression. SCREAMING_SNAKE
 * variants are NOT included; they're archived-seed-only and should be
 * normalised at the seed boundary, not the runtime boundary.
 *
 * Sibling helper to
 * [`canonical-domain-group.ts`](./canonical-domain-group.ts) — same
 * shape (Set + resolver). Sync routes, lab-feature activation, and any
 * future bulk-write surface MUST go through
 * `resolveCanonicalDirectionality()` and refuse the write if it
 * returns null.
 *
 * Audit trail:
 *  - #2029 / #2030 closed the sibling `domainGroup` silent-fallback
 *    sites (`|| "general"`, `|| "lab"`, `|| "teaching"`)
 *  - #2031 S5 closes the matched `|| "positive"` fallback in
 *    `lab/features/[id]/activate/route.ts:221`
 *
 * Cross-pin: `CANONICAL_DIRECTIONALITIES.size === 4` is asserted by
 * every import-site's test so the canonical set can't drift without
 * the per-route tests firing.
 */

export const CANONICAL_DIRECTIONALITIES = new Set([
  "positive",
  "negative",
  "bidirectional",
  "neutral",
] as const);

/**
 * Resolve a canonical directionality from spec/param data, or return null.
 * Callers MUST refuse the write when this returns null — silent
 * fallback to a non-canonical value is the bug class this helper
 * exists to prevent.
 *
 * Resolution order:
 *  1. `paramData.directionality` (the canonical field)
 *  2. null (caller must skip / error)
 */
export function resolveCanonicalDirectionality(
  paramData: { directionality?: unknown } | null,
): string | null {
  if (!paramData) return null;
  const candidate = paramData.directionality;
  if (
    typeof candidate === "string" &&
    CANONICAL_DIRECTIONALITIES.has(candidate as never)
  ) {
    return candidate;
  }
  return null;
}
