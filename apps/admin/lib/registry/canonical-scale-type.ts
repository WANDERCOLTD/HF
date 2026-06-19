/**
 * Canonical `Parameter.scaleType` taxonomy (#2031 S5).
 *
 * The DB has NO `CHECK` constraint on `Parameter.scaleType` — it's a
 * free-form `String`. The set of in-use values today is small + stable
 * and surveyed from the active write sites:
 *
 *   - `seed-from-specs.ts`, `seed-prosody-parameters.ts`,
 *     `seed-tolerance-parameters.ts` → `"0-1"`
 *   - `app/api/admin/sync-parameters/route.ts` → `"continuous"`
 *   - Archived seed scripts → `"0-1" | "-1-1" | "delta" | "binary"
 *     | "ratio"`
 *
 * Epic #2031 names the canonical tuple: `"0-1" | "-1-1" | "categorical"`.
 * We include the SUPERSET that actually appears in the live write
 * surface so existing admin paths don't start refusing valid rows
 * (`"continuous"` is the sibling of `"0-1"`; `"delta" | "binary" |
 * "ratio"` survive from archived seeds; `"categorical"` is reserved
 * for future enum-shaped parameters per #2031).
 *
 * Sibling helper to
 * [`canonical-domain-group.ts`](./canonical-domain-group.ts) — same
 * shape (Set + resolver). Sync routes, lab-feature activation, and any
 * future bulk-write surface MUST go through `resolveCanonicalScaleType()`
 * and refuse the write if it returns null.
 *
 * Audit trail:
 *  - #2029 / #2030 closed the sibling `domainGroup` silent-fallback
 *    sites (`|| "general"`, `|| "lab"`, `|| "teaching"`)
 *  - #2031 S5 closes the matched `|| "0-1"` fallback in
 *    `lab/features/[id]/activate/route.ts:220`
 *
 * Cross-pin: `CANONICAL_SCALE_TYPES.size === 6` is asserted by every
 * import-site's test so the canonical set can't drift without the
 * per-route tests firing.
 */

export const CANONICAL_SCALE_TYPES = new Set([
  "0-1",
  "-1-1",
  "categorical",
  "continuous",
  "delta",
  "binary",
] as const);

/**
 * Resolve a canonical scaleType from spec/param data, or return null.
 * Callers MUST refuse the write when this returns null — silent
 * fallback to a non-canonical value is the bug class this helper
 * exists to prevent.
 *
 * Resolution order:
 *  1. `paramData.scaleType` (the canonical field)
 *  2. null (caller must skip / error)
 */
export function resolveCanonicalScaleType(
  paramData: { scaleType?: unknown } | null,
): string | null {
  if (!paramData) return null;
  const candidate = paramData.scaleType;
  if (
    typeof candidate === "string" &&
    CANONICAL_SCALE_TYPES.has(candidate as never)
  ) {
    return candidate;
  }
  return null;
}
