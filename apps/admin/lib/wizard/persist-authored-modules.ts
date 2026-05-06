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

import type { PlaybookConfig } from "@/lib/types/json-fields";
import type { DetectedAuthoredModules } from "./detect-authored-modules";

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

  const next: PlaybookConfig = {
    ...existing,
    modulesAuthored: true,
    moduleSource: "authored",
    modules: parsed.modules,
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
