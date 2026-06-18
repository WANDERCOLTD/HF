/**
 * persist-authored-modules.ts
 *
 * Pure helper that merges a parsed authored-modules result into an existing
 * PlaybookConfig. Used by the POST /api/courses/[courseId]/import-modules
 * route (PR2) and reused by the Module Catalogue editor (PR3).
 *
 * Per-field-defaults-with-warnings policy:
 *   - Warnings are persisted alongside the modules so the publish gate
 *     (separate concern, PR4) can read them.
 *   - Errors are also persisted but the route reports them prominently;
 *     the editor can decide whether to surface them as blockers.
 *
 * Contract for the merge:
 *   - When `modulesAuthored === true` and the parse produced modules:
 *       sets moduleSource='authored', stores modules + moduleDefaults +
 *       validationWarnings, optionally records moduleSourceRef.
 *   - When `modulesAuthored === false` (explicit "No"):
 *       sets moduleSource='derived', clears modules + moduleDefaults,
 *       preserves the explicit `false` so the wizard knows the author
 *       has decided.
 *   - When `modulesAuthored === null` (no signal at all):
 *       leaves the config untouched. This is a no-op import.
 *
 * Issue #236.
 */

import type {
  AuthoredModule,
  AuthoredModuleSettings,
  PlaybookConfig,
} from "@/lib/types/json-fields";
import type { DetectedAuthoredModules } from "./detect-authored-modules";

/**
 * Manual-edit-wins merge of per-module settings on re-projection (#1850).
 *
 * Given the prior config's modules (each potentially carrying manual
 * Inspector edits in `settings`) and the freshly-parsed modules from the
 * course-ref doc (each potentially carrying YAML-block-derived settings),
 * preserve any setting that was already manually set per (moduleId, key).
 *
 * This is the same shape as the backfill-script merge — the persist path
 * runs every time the doc is re-imported, so the YAML never clobbers a
 * deliberate manual override.
 */
function preserveManualEdits(
  existing: AuthoredModule[] | undefined,
  parsed: AuthoredModule[],
): AuthoredModule[] {
  if (!existing || existing.length === 0) return parsed;
  const existingById = new Map(existing.map((m) => [m.id, m] as const));
  return parsed.map((freshMod) => {
    const prior = existingById.get(freshMod.id);
    if (!prior?.settings) return freshMod;
    if (!freshMod.settings) {
      // The parse produced no YAML settings for this module — keep the
      // prior manual settings entirely.
      return { ...freshMod, settings: prior.settings };
    }
    // Per-key: prior wins over freshly-parsed YAML.
    const merged: AuthoredModuleSettings = {
      ...freshMod.settings,
      ...prior.settings,
    };
    return { ...freshMod, settings: merged };
  });
}

export interface PersistOptions {
  /** Optional pointer to the source document — recorded on the Playbook for audit. */
  sourceRef?: { docId: string; version: string };
}

export interface PersistResult {
  /** New config to write to the Playbook. */
  config: PlaybookConfig;
  /** True when the merge changed anything. False is a no-op short-circuit. */
  changed: boolean;
}

export function applyAuthoredModules(
  existing: PlaybookConfig,
  parsed: DetectedAuthoredModules,
  options: PersistOptions = {},
): PersistResult {
  // No signal at all → no-op. Existing derived path runs unchanged.
  if (parsed.modulesAuthored === null) {
    return { config: existing, changed: false };
  }

  // Explicit "No" → record the decision, clear any prior authored data.
  if (parsed.modulesAuthored === false) {
    const next: PlaybookConfig = {
      ...existing,
      modulesAuthored: false,
      moduleSource: "derived",
      // Clear authored-only fields. Prisma's JSON column accepts undefined
      // as "remove key" for our merge convention; leave existing fields
      // alone if they were never set by us.
      modules: undefined,
      moduleDefaults: undefined,
      pickerLayout: undefined,
      validationWarnings: undefined,
      moduleSourceRef: undefined,
    };
    return { config: next, changed: true };
  }

  // Authored = true. Merge in.
  // #258: outcome statements are merged from the parse so they survive a
  // re-import that drops a previously-declared OUT-NN heading. If the parse
  // produced no outcomes, the existing map is preserved unchanged — keeps
  // backward-compat for courses imported before #258 landed.
  const mergedOutcomes = Object.keys(parsed.outcomes ?? {}).length > 0
    ? { ...(existing.outcomes ?? {}), ...parsed.outcomes }
    : existing.outcomes;

  const mergedModules = preserveManualEdits(existing.modules, parsed.modules);

  const next: PlaybookConfig = {
    ...existing,
    modulesAuthored: true,
    moduleSource: "authored",
    modules: mergedModules,
    moduleDefaults: { ...(existing.moduleDefaults ?? {}), ...parsed.moduleDefaults },
    ...(mergedOutcomes ? { outcomes: mergedOutcomes } : {}),
    validationWarnings: parsed.validationWarnings,
    ...(options.sourceRef ? { moduleSourceRef: options.sourceRef } : {}),
  };

  return { config: next, changed: true };
}

/**
 * True when the parse result contains any error-severity warnings.
 * Used by callers (route, editor) to decide whether to surface blockers
 * even though the data itself was persisted. Errors do NOT prevent
 * persistence — the publish gate handles promotion to production.
 */
export function hasBlockingErrors(parsed: DetectedAuthoredModules): boolean {
  return parsed.validationWarnings.some((w) => w.severity === "error");
}
