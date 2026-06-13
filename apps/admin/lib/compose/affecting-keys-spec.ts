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
 * For each compose-affecting AnalysisSpec field, the `ComposeSection` whose
 * hash it should bump when changed — #1556 (Story 1 of EPIC #1555).
 *
 * Honest disclaimer: AnalysisSpec fields are degenerate-by-design for
 * section attribution. A spec's `config` JSON can carry data for any
 * section; `specRole` routes the spec into different sections by role;
 * `isActive` toggles the whole spec on/off. Mapping all six fields to a
 * single section is coarse — we pick `modePolicy` as a catch-all
 * representing "system-level policy change" and accept the over-marking.
 *
 * Story 2's section hash work can introduce finer attribution if spec
 * writes prove to noise-mark unrelated sections — the place to refine is
 * at the AnalysisSpec update site (`lib/analysis-spec/update-analysis-spec-config.ts`),
 * not here.
 */
export const COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS = {
  config: "modePolicy",
  promptTemplate: "modePolicy",
  isActive: "modePolicy",
  scope: "modePolicy",
  specRole: "modePolicy",
  extendsAgent: "modePolicy",
} as const satisfies Record<
  ComposeAffectingSpecField,
  import("./section").ComposeSectionKey
>;

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
