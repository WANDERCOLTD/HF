/**
 * Module-Visibility Gate (#1405)
 *
 * Controls whether module names surface in the AI's call-1 framing.
 * Read by `quickstart.ts` (this_session, discovery_guidance) and
 * `pedagogy.ts` (plan.newMaterial.module, plan.flow steps) to suppress
 * module-name mentions for brand-new learners in authored multi-module
 * courses.
 *
 * Triggered by operator feedback on "Big Five (OCEAN) Personality
 * Model" — brand-new learners hearing "today's focus is Foundations:
 * Why Five?" before they had any context for what the modules meant.
 *
 * Three modes (stored as `PlaybookConfig.firstCall.firstCallModuleVisibility`):
 *
 * - `mention_from_call_1` (default, also the absent-field behaviour) —
 *   module names appear in call-1 framing as today.
 * - `hide_until_call_2` — module names suppressed on call 1; revert to
 *   normal from call 2 regardless of learner action.
 * - `hide_until_learner_picks` — module names suppressed until the
 *   learner explicitly chose via Module Picker
 *   (`Caller.lastSelectedModuleId` is set / `lockedModule` resolves).
 *
 * Override rule: when the learner has explicitly picked a module
 * (lockedModule is set, i.e. `lastSelectedModuleId` resolved to a real
 * module), the gate ALWAYS returns false — the learner's choice is the
 * source of truth and wins over the operator's suppression preference.
 *
 * Scope of suppression: framing/orientation fields only
 * (`this_session`, `discovery_guidance`, `plan.newMaterial.module`,
 * flow steps that name modules). TEACHING CONTENT (vocab, assertions,
 * knowledge items) is untouched — the AI still needs the curriculum.
 *
 * @see app/x/courses/[courseId]/_components/PreviewLens.tsx — sidetray entry
 * @see components/course-design/ModuleVisibilitySettings.tsx — UI
 * @see docs/PROMPT-COMPOSITION.md §4 (transforms — quickstart.ts, pedagogy.ts)
 */

export type FirstCallModuleVisibility =
  | "mention_from_call_1"
  | "hide_until_call_2"
  | "hide_until_learner_picks";

export const FIRST_CALL_MODULE_VISIBILITY_VALUES: readonly FirstCallModuleVisibility[] = [
  "mention_from_call_1",
  "hide_until_call_2",
  "hide_until_learner_picks",
] as const;

export const DEFAULT_FIRST_CALL_MODULE_VISIBILITY: FirstCallModuleVisibility =
  "mention_from_call_1";

export function isFirstCallModuleVisibility(
  v: unknown,
): v is FirstCallModuleVisibility {
  return (
    typeof v === "string" &&
    (FIRST_CALL_MODULE_VISIBILITY_VALUES as readonly string[]).includes(v)
  );
}

export interface ShouldSuppressModuleNamesInput {
  /** The educator's chosen mode. Absent → default (no suppression). */
  firstCallModuleVisibility: FirstCallModuleVisibility | undefined;
  /** True when this is the learner's first call (`sharedState.isFirstCall`). */
  isFirstCall: boolean;
  /** 1-based call sequence (`sharedState.callNumber`). Unused for now but
   *  threaded through so the helper signature matches the contract in #1405
   *  and a future call-N gate can extend without breaking call sites. */
  callNumber: number;
  /**
   * Did the learner explicitly pick a module via the Module Picker? In the
   * composition pipeline this is `sharedState.lockedModule != null`, which
   * is derived from `requestedModuleId` (URL) → `Caller.lastSelectedModuleId`
   * → matched against the active curriculum.
   *
   * When set (truthy id OR a non-null module reference), the gate ALWAYS
   * returns `false` — the learner's choice wins.
   */
  lastSelectedModuleId: string | null | undefined;
}

/**
 * Returns `true` when module names should be suppressed in call-1 framing.
 *
 * Decision tree:
 *
 *   if educator chose `mention_from_call_1` (or field absent) → false
 *   if learner has picked a module (`lastSelectedModuleId` set)  → false
 *   if `hide_until_call_2` AND isFirstCall                       → true
 *   if `hide_until_call_2` AND !isFirstCall                      → false
 *   if `hide_until_learner_picks` (and no learner pick)          → true
 *   else                                                          → false
 */
export function shouldSuppressModuleNames(
  input: ShouldSuppressModuleNamesInput,
): boolean {
  const { firstCallModuleVisibility, isFirstCall, lastSelectedModuleId } = input;

  // Default / explicit "no suppression".
  if (
    !firstCallModuleVisibility ||
    firstCallModuleVisibility === "mention_from_call_1"
  ) {
    return false;
  }

  // Learner's explicit pick wins over the operator's suppression preference.
  if (lastSelectedModuleId) {
    return false;
  }

  if (firstCallModuleVisibility === "hide_until_call_2") {
    return isFirstCall;
  }

  if (firstCallModuleVisibility === "hide_until_learner_picks") {
    // Persists past call 2 — only the learner's explicit pick clears it.
    return true;
  }

  // Defensive default — unknown value falls back to no suppression so
  // adding a new enum variant elsewhere never silently changes behaviour
  // for existing courses.
  return false;
}

/** Generic replacement copy when `this_session` would have named a module.
 *  Sits in the same composition surface as the no-hardcoded-greeting rule;
 *  this string is a DIRECTIVE, not a greeting, so the rule is unaffected. */
export const SUPPRESSED_THIS_SESSION_COPY =
  "First session — explore the subject and establish your starting point";

/** Generic replacement copy used by `pedagogy.ts` when the plan would have
 *  put a module name into `plan.newMaterial.module`. The shape stays the
 *  same so downstream renderers don't branch. */
export const SUPPRESSED_NEW_MATERIAL_MODULE = "(subject overview)";

/** Replacement for `Introduce ${module.name}` flow step text. */
export const SUPPRESSED_INTRODUCE_STEP = "introduce the subject area";
