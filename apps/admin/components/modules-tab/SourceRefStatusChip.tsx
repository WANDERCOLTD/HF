"use client";

/**
 * SourceRefStatusChip — at-a-glance source-ref resolution status for a
 * single AuthoredModule's settings (S12 of `handoff_lattice_all_settings_to_ui_2026_06_21.md`).
 *
 * The wizard's `lib/wizard/resolve-module-source-refs.ts` inlines four
 * `source:<slug>` settings fields at projection time (`cueCardPool`,
 * `scaffoldPool`, `topicPool`, `profileFieldsToCapture`). When the
 * `## Content Sources` index can't satisfy a ref, the resolver leaves
 * the field UNTOUCHED + emits a `MODULE_SOURCE_REF_UNRESOLVED` warning.
 * The runtime then silently returns null at the consumer (e.g.
 * `selectPinnedCardForModule`) and the learner experiences an empty
 * cue-card shell with no operator-visible signal.
 *
 * This chip closes the operator-visibility loop for the PERSISTED
 * `Playbook.config.modules[i].settings` shape:
 *   - resolved fields land as populated arrays/objects → ok
 *   - unresolved fields are either absent OR still carry a raw
 *     `source:<slug>` string → warn
 *
 * Layered alongside:
 *   - PR-time gate: `tests/lib/wizard/source-ref-coverage.test.ts` (#2166)
 *   - CI/deploy-time SQL: `scripts/check-fk-consistency.ts` Query 14
 *   - Runtime AppLog (deferred S3 of #2166): `source_ref.unresolved`
 *
 * Catalogued in `.claude/rules/source-ref-coverage.md` "Existing
 * enforcement" table as the operator-facing surface (this PR).
 *
 * Returns null when the module declares no source-refs at all (no
 * resolvable settings keys present) — keeps the chip row honest about
 * what's actually under management.
 */

import type { AuthoredModuleSettings } from "@/lib/types/json-fields";

/**
 * Mirrors `RESOLVABLE_FIELDS` in
 * `apps/admin/lib/wizard/resolve-module-source-refs.ts:156` — that
 * module imports `node:fs` so we can't share the const here.
 * Coverage-pillar discipline: when a field is added there, add it
 * here too (paired by convention; the source-ref-coverage rule pairs
 * the resolver matrix to its test matrix already, so this is a
 * mechanical third site).
 */
const RESOLVABLE_FIELDS = [
  "cueCardPool",
  "scaffoldPool",
  "topicPool",
  "profileFieldsToCapture",
] as const satisfies ReadonlyArray<keyof AuthoredModuleSettings>;

type ResolvableField = (typeof RESOLVABLE_FIELDS)[number];

interface SourceRefStatusChipProps {
  /** The selected AuthoredModule's `settings` sub-object. */
  settings: Partial<AuthoredModuleSettings> | null | undefined;
  /** Optional id suffix for the chip's data-testid. */
  moduleId?: string;
}

/**
 * Per-field state. `absent` is the canonical post-projection signal of
 * an unresolved source-ref (the resolver leaves the field untouched on
 * miss). `raw-source-ref` covers the pre-projection edge case where the
 * raw `source:<slug>` string survives into DB.
 */
type FieldState = "resolved" | "absent" | "raw-source-ref" | "empty";

interface FieldRow {
  field: ResolvableField;
  state: FieldState;
}

function classify(value: unknown): FieldState {
  if (value === undefined || value === null) return "absent";
  if (typeof value === "string") {
    return value.startsWith("source:") ? "raw-source-ref" : "resolved";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "empty" : "resolved";
  }
  return "resolved";
}

function isUnresolved(state: FieldState): boolean {
  // `empty` is intentionally NOT unresolved — an operator may legitimately
  // ship a module with no cue cards yet. The narrow signal is "the parser
  // saw a source-ref the resolver couldn't satisfy" → absent / raw.
  return state === "raw-source-ref" || state === "absent";
}

export function SourceRefStatusChip({
  settings,
  moduleId,
}: SourceRefStatusChipProps): React.ReactElement | null {
  // Build per-field rows. Honest empty when no ref-bearing settings key is
  // even POTENTIALLY in scope — render nothing rather than fake an "OK"
  // signal for a module that isn't on this surface.
  const rows: FieldRow[] = RESOLVABLE_FIELDS.map((field) => ({
    field,
    state: classify(settings?.[field]),
  }));

  // If every cell is `absent`, the operator hasn't declared a ref-bearing
  // setting on this module at all — suppress the chip.
  const everyAbsent = rows.every((r) => r.state === "absent");
  if (everyAbsent) return null;

  const unresolved = rows.filter((r) => isUnresolved(r.state));
  const testIdSuffix = moduleId ? `-${moduleId}` : "";

  if (unresolved.length === 0) {
    return (
      <span
        className="hf-module-editor-chip"
        role="listitem"
        title="All declared content source references resolved at projection time."
        data-testid={`hf-source-ref-status-chip-ok${testIdSuffix}`}
      >
        <span className="hf-module-editor-chip-label">Sources</span>
        <span className="hf-module-editor-chip-value">{"✓ OK"}</span>
      </span>
    );
  }

  const tooltip = [
    `${unresolved.length} content source reference${unresolved.length === 1 ? "" : "s"} did not resolve at projection time:`,
    ...unresolved.map((r) => ` • ${r.field}`),
    "",
    "The runtime resolver silently returns null on miss — the learner sees an empty shell. Check the course-ref's ## Content Sources block, then re-project the course.",
  ].join("\n");

  return (
    <span
      className="hf-module-editor-chip hf-module-editor-chip-warn"
      role="listitem"
      title={tooltip}
      data-testid={`hf-source-ref-status-chip-warn${testIdSuffix}`}
    >
      <span className="hf-module-editor-chip-label">Sources</span>
      <span className="hf-module-editor-chip-value">
        {"⚠ "}
        {unresolved.length} unresolved
      </span>
    </span>
  );
}
