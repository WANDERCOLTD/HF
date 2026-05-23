/**
 * #610 — Code-side defaults for `criticalRules` content, separated from the
 * transforms that consume them.
 *
 * Configuration-over-Code (CLAUDE.md tenet): behavioural content lives in
 * spec config, transforms hold mechanics. When COMP-001 spec config doesn't
 * provide an override, transforms read from this file. The directory split
 * is what the `hardcodedRulesRemainingInTransforms` audit counter measures
 * — keeping content out of `transforms/` is the structural marker that
 * separates mechanics from policy.
 *
 * If you add a new default here, also expose an override path in COMP-001
 * spec config (`prompt_preamble.config.criticalRules.*`) so operators can
 * tune without a code deploy.
 *
 * See: gh issue view 610
 *      gh issue view 604 (the pattern this file implements)
 *      docs/PROMPT-COMPOSITION.md §9 landmines L8/L9
 *      apps/admin/scripts/audit-epic-100.ts (`hardcodedRulesRemainingInTransforms`)
 */
import type { TeachingMode } from "@/lib/content-trust/resolve-config";

/**
 * #604 — RETURNING_CALLER rule keyed by playbook teachingMode.
 *
 * Pre-#604 the with-curriculum branch hardcoded the recall-archetype rule
 * ("ALWAYS review before new material") for every playbook, regardless of
 * its teachingMode. For `practice` archetypes (IELTS Prep Lab, IELTS
 * Listening, anything coaching/skills-based) the right opening is a
 * warm-up attempt — the attempt itself diagnoses retention without front-
 * loading a recall check the learner usually fails. This map is the
 * code-side default; COMP-001 spec config can override per-mode via
 * `criticalRules.returningCallerByMode[mode]`.
 *
 * `Record<TeachingMode, string>` forces an update here whenever a new
 * TeachingMode is added to `lib/content-trust/resolve-config.ts` — without
 * this exhaustiveness check a new mode would silently inherit `recall`
 * behaviour and re-introduce the same RC5 bug under a different label.
 */
export const RETURNING_CALLER_BY_MODE: Record<TeachingMode, string> = {
  recall:
    "If RETURNING_CALLER: ALWAYS review before new material",
  comprehension:
    "If RETURNING_CALLER: ALWAYS review before new material",
  syllabus:
    "If RETURNING_CALLER: ALWAYS review before new material",
  practice:
    "RETURNING_CALLER: Begin with a warm-up attempt, not a recall check. The attempt IS the diagnostic.",
};
