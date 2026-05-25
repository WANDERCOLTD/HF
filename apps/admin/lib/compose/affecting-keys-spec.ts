/**
 * COMPOSE-affecting AnalysisSpec fields — #829 (Story 5 of EPIC #832).
 *
 * Top-level fields on the `AnalysisSpec` row that flow into prompt
 * composition. A write that changes any of these MUST trigger a
 * scope-appropriate timestamp bump (see
 * `lib/analysis-spec/update-analysis-spec-config.ts`):
 *
 *   - `scope = SYSTEM` → bump `SystemSetting "compose_inputs_updated_at"`
 *     (marks every caller stale on next call)
 *   - `scope = DOMAIN` → bump `Domain.composeInputsUpdatedAt` for the
 *     spec's owning domain (marks every caller in every playbook in that
 *     domain stale on next call)
 *   - `scope = CALLER` → no-op (CALLER-scope specs are auto-generated and
 *     never mutated via admin tools)
 *
 * Compose-affecting field rationale:
 *   - `config`       — parameters, identity overlay rules, thresholds,
 *                      sourceAuthority — directly read by transforms
 *   - `promptTemplate` — the spec's rendered prompt text fragment
 *   - `isActive`     — deactivating removes the spec from composition
 *   - `scope`        — changes which playbook/caller load this spec
 *   - `specRole`     — routes the spec into a different composer section
 *   - `extendsAgent` — identity-inheritance chain (overlay base)
 *
 * Keys NOT in this list (name, description, slug, priority, version,
 * compiledAt, isDirty, dirtyReason, sourceFeatureSetId, isLocked,
 * lockedAt, lockedReason, usageCount, isDeletable, isArchetype,
 * promptSlugId) are metadata or compilation/locking state. They do not
 * change the composed prompt text.
 */
export const COMPOSE_AFFECTING_SPEC_FIELDS = [
  "config",
  "promptTemplate",
  "isActive",
  "scope",
  "specRole",
  "extendsAgent",
] as const;

export type ComposeAffectingSpecField =
  (typeof COMPOSE_AFFECTING_SPEC_FIELDS)[number];

/**
 * Returns true when any of the listed AnalysisSpec fields differ between
 * `prev` and `next` by deep equality (JSON.stringify).
 */
export function composeAffectingSpecChanged(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const key of COMPOSE_AFFECTING_SPEC_FIELDS) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      return true;
    }
  }
  return false;
}
