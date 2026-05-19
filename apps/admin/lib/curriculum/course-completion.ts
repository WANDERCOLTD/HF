/**
 * Course-level completion flags helper (#494 E2 Slice 2.3).
 *
 * Two flags live on `Playbook.config` (JSON):
 *
 *   - `strictPrerequisites` — picker behaviour when prerequisites are unmet.
 *     true  → hard-lock the tile; learner cannot enter the module.
 *     false → soft-warning modal; learner can override (default).
 *
 *   - `completionMode` — what counts as "course done":
 *     "terminal-only" → the terminal module is MASTERED (default — IELTS Mock)
 *     "all-modules"   → every authored module is MASTERED
 *     "any"           → at least one module MASTERED (open-ended courses)
 *
 * `strictPrerequisites` is wizard-settable via the `strictPrerequisites`
 * graph node. `completionMode` is author-only — the wizard validator does
 * NOT whitelist it; see `docs/WIZARD-DATA-BAG.md` §4.
 *
 * Defaults exposed as named constants so call-sites never inline string
 * literals — keeps `recommendNextModule` (Slice 2.5) and `isCourseComplete`
 * (Slice 2.7) consistent.
 */

import type { PlaybookConfig } from "@/lib/types/json-fields";

/** Default for `Playbook.config.strictPrerequisites`. */
export const DEFAULT_STRICT_PREREQUISITES = false;

/** Default for `Playbook.config.completionMode`. */
export const DEFAULT_COMPLETION_MODE = "terminal-only" as const;

/** Allowed values for `completionMode`. Used for defensive validation. */
export const COMPLETION_MODES = ["all-modules", "terminal-only", "any"] as const;

export type CompletionMode = (typeof COMPLETION_MODES)[number];

export interface CourseFlags {
  strictPrerequisites: boolean;
  completionMode: CompletionMode;
}

/**
 * Read course-level completion flags from a `Playbook.config` blob, applying
 * defaults for any missing or invalid value. Safe to call with `null` or
 * `undefined` — callers often receive `Playbook.config` as `Json?`.
 *
 * Defensive: an out-of-range `completionMode` (legacy data, hand-edited
 * row) falls back to the default rather than propagating an invalid enum
 * downstream.
 */
export function readCourseFlags(
  config: PlaybookConfig | null | undefined,
): CourseFlags {
  const strictPrerequisites =
    typeof config?.strictPrerequisites === "boolean"
      ? config.strictPrerequisites
      : DEFAULT_STRICT_PREREQUISITES;

  const rawMode = config?.completionMode;
  const completionMode: CompletionMode =
    rawMode !== undefined &&
    (COMPLETION_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as CompletionMode)
      : DEFAULT_COMPLETION_MODE;

  return { strictPrerequisites, completionMode };
}

/**
 * Default mastery threshold applied when neither the module nor the playbook
 * sets one. 0.7 matches IELTS-style "borderline secure" floor and is the
 * fallback used across the picker / completion checks.
 */
export const DEFAULT_MASTERY_THRESHOLD = 0.7;

/**
 * Resolved per-module progression flags. Always fully populated — defaults
 * applied for any missing or null field. Callers (recommend-module, picker,
 * isCourseComplete) read this rather than touching raw module rows.
 */
export interface ModuleFlags {
  prerequisites: string[];
  terminal: boolean;
  coversModules: string[];
  masteryThreshold: number;
}

/**
 * Shape accepted by `readModuleFlags` — narrow enough that both Prisma's
 * `CurriculumModule` row and the JSON `AuthoredModule` shape satisfy it
 * (after the right field aliases at the call site). All four inputs are
 * optional + nullable so the helper is safe against legacy data and
 * partially-populated JSON blobs.
 */
export interface ReadableModuleFlags {
  prerequisites?: string[] | null;
  terminal?: boolean | null;
  coversModules?: string[] | null;
  masteryThreshold?: number | null;
}

/**
 * Read per-module progression flags from a `CurriculumModule` row (or an
 * `AuthoredModule`-shaped JSON object), applying defaults for any missing
 * or null value.
 *
 *   - `prerequisites`     → `[]` when null/undefined
 *   - `terminal`          → `false` when null/undefined
 *   - `coversModules`     → `[]` when null/undefined
 *   - `masteryThreshold`  → `playbookDefaultThreshold` (default 0.7) when null
 *
 * `playbookDefaultThreshold` is the per-playbook fallback — callers that have
 * a playbook-level threshold available (e.g. from `Playbook.config`) should
 * pass it; otherwise the function-level default of 0.7 applies.
 *
 * Defensive only: this helper does NOT validate that prerequisite or
 * coversModules slugs exist on the playbook. That's the picker's job
 * (Slice 2.5).
 */
export function readModuleFlags(
  module: ReadableModuleFlags,
  playbookDefaultThreshold: number = DEFAULT_MASTERY_THRESHOLD,
): ModuleFlags {
  const prerequisites = Array.isArray(module.prerequisites)
    ? module.prerequisites
    : [];
  const terminal = typeof module.terminal === "boolean" ? module.terminal : false;
  const coversModules = Array.isArray(module.coversModules)
    ? module.coversModules
    : [];
  const masteryThreshold =
    typeof module.masteryThreshold === "number"
      ? module.masteryThreshold
      : playbookDefaultThreshold;

  return { prerequisites, terminal, coversModules, masteryThreshold };
}
