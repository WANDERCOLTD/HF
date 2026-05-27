/**
 * buildLoMasteryMap — shared CallerAttribute -> loMasteryMap builder
 *
 * Extracted from the three COMPOSE-stage transforms that previously each
 * inlined a near-identical body:
 *   - transforms/modules.ts
 *   - transforms/retrieval-practice.ts
 *   - transforms/progress-narrative.ts
 *
 * Behaviour contract (#928):
 *   - Scope: only rows whose key starts with
 *     `curriculum:<currentSpecSlug>:lo_mastery:` are admitted. This prevents
 *     cross-course bleed when a learner is enrolled in multiple playbooks
 *     and the loader has fetched all CURRICULUM-scope rows for the caller.
 *   - Empty/undefined `currentSpecSlug` returns an empty map (graceful degrade).
 *   - `attr.scope` must equal `'CURRICULUM'`.
 *   - `attr.numberValue` must be non-null.
 *
 * #611/#614 GRACE WINDOW:
 *   - The post-prefix `split(':lo_mastery:')[1]` suffix split stays tolerant.
 *     Legacy name-form rows
 *     (`curriculum:<spec>:lo_mastery:Part 1: Familiar Topics:OUT-01`) share
 *     the same `curriculum:<spec>:lo_mastery:` prefix as canonical slug-form
 *     rows and remain captured. Reader-tightening of the suffix is gated on
 *     the `callerAttributeOldKeyFormCount` audit counter
 *     (`scripts/audit-epic-100.ts`) reading 0 across all environments.
 *
 * Output key shape: `<moduleSlugOrName>:<loRef>` — opaque to this helper,
 * preserved exactly as it appears in the DB row.
 */

export interface LoMasteryAttrLike {
  key: string;
  scope: string;
  numberValue: number | null;
}

export function buildLoMasteryMap(
  attrs: readonly LoMasteryAttrLike[] | null | undefined,
  currentSpecSlug: string | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!currentSpecSlug) return out;
  const prefix = `curriculum:${currentSpecSlug}:lo_mastery:`;
  for (const attr of attrs ?? []) {
    if (
      attr.key.startsWith(prefix) &&
      attr.scope === "CURRICULUM" &&
      attr.numberValue != null
    ) {
      const suffix = attr.key.split(":lo_mastery:")[1];
      if (suffix && suffix.length > 0) {
        out[suffix] = attr.numberValue;
      }
    }
  }
  return out;
}
