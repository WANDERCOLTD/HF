/**
 * deriveFocusArea — #1955 (Boaz/Eldar pre-voice gap analysis, Unit 4.1 / 4.2).
 *
 * Pure helper. Given the learner's CallerTarget rows + a module slug,
 * picks the IELTS skill criterion the learner is weakest on (lowest
 * `currentScore`) and returns the picked parameter id + the human-
 * readable label rendered into the prompt directive and the on-screen
 * pinned-card banner.
 *
 * Selection policy:
 *   - Consider ONLY the 4 IELTS skill parameter ids (see
 *     `IELTS_COMPLETION_PARAM_IDS` in `validate-ielts-completion.ts`).
 *   - Of those, only rows where `currentScore` is a finite number (i.e.
 *     the learner has at least one demonstrated score on the criterion).
 *   - Return the minimum-`currentScore` row.
 *   - Returns `null` when no qualifying rows exist (first-ever session,
 *     or the 4 params haven't been scored yet). The composer then emits
 *     nothing, no directive renders, no banner shows.
 *
 * The `moduleSlug` argument is reserved for future per-module scoping
 * (the story body anticipates "scoped to the module"). Today, CallerTarget
 * rows are caller-wide rather than per-module — the four IELTS skill
 * params are a single learner-level cascade. The slug is accepted so
 * the call site doesn't have to change when per-module scoring lands;
 * for now it's used only to gate the helper to Part-3-shaped modules
 * (the consumer transform passes through its own gate).
 *
 * Read site: `lib/prompt/composition/transforms/part3-focus.ts` (compose
 * transform) + `lib/voice/select-pinned-card.ts` siblings (pinned-card
 * write at session-start).
 *
 * Related: #1955 — this story
 *          #1953 — sibling sharing the IELTS_COMPLETION_PARAM_IDS constant
 *          #1700 — IELTS pre-voice epic
 *          docs/draft-issues/ielts-pre-voice-gap-analysis-response-2026-06-18.md
 */

import { IELTS_COMPLETION_PARAM_IDS } from "./validate-ielts-completion";

const IELTS_SKILL_PARAM_IDS = new Set<string>(
  Object.values(IELTS_COMPLETION_PARAM_IDS),
);

/** Human-readable label rendered into the directive + banner. Authored
 *  here so the prompt text and the on-screen pin agree byte-for-byte. */
export const IELTS_SKILL_LABELS: Readonly<Record<string, string>> = {
  skill_fluency_and_coherence_fc: "Fluency and Coherence",
  skill_pronunciation_p: "Pronunciation",
  skill_lexical_resource_lr: "Lexical Resource",
  skill_grammatical_range_and_accuracy_gra: "Grammatical Range and Accuracy",
};

/** Slug form used in the helper's return value — short, lower-snake,
 *  suitable for compose-time keys and the focusArea payload. Sibling to
 *  the human label. */
export const IELTS_SKILL_SLUGS: Readonly<Record<string, string>> = {
  skill_fluency_and_coherence_fc: "fluency_and_coherence",
  skill_pronunciation_p: "pronunciation",
  skill_lexical_resource_lr: "lexical_resource",
  skill_grammatical_range_and_accuracy_gra: "grammatical_range_and_accuracy",
};

/** Minimal CallerTarget shape this helper needs. Compatible with both
 *  the Prisma row and the composer's `CallerTargetData`. */
export interface CallerTargetForFocus {
  parameterId: string;
  currentScore?: number | null;
}

export interface FocusAreaResult {
  /** Canonical parameterId (e.g. "skill_lexical_resource_lr"). */
  parameterId: string;
  /** Short slug form (e.g. "lexical_resource") for compose-time keys. */
  paramSlug: string;
  /** Human-readable label (e.g. "Lexical Resource"). */
  label: string;
  /** The score at the time of selection. */
  score: number;
  /**
   * The module slug the focus applies to. Reserved for future per-module
   * scoping; today it's a pass-through of the input argument.
   */
  moduleSlug: string;
  /**
   * LO ref placeholder — the story signature names it but Part-3 LO
   * tagging to skill params is per-LO-from-CallerTarget today (i.e. no
   * per-LO score). Null until pedagogy ships the per-LO tagging.
   */
  loRef: string | null;
}

/**
 * Returns the lowest-scored IELTS skill parameter for the learner.
 * Returns null when no CallerTarget rows for the 4 params carry a
 * finite `currentScore` (first-ever session — the directive simply
 * doesn't render).
 */
export function deriveFocusArea(
  callerTargets: ReadonlyArray<CallerTargetForFocus>,
  moduleSlug: string,
): FocusAreaResult | null {
  if (!Array.isArray(callerTargets) || callerTargets.length === 0) {
    return null;
  }
  if (typeof moduleSlug !== "string" || moduleSlug.length === 0) {
    return null;
  }

  let best: { row: CallerTargetForFocus; score: number } | null = null;
  for (const row of callerTargets) {
    if (!row || typeof row.parameterId !== "string") continue;
    if (!IELTS_SKILL_PARAM_IDS.has(row.parameterId)) continue;
    const score = row.currentScore;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (best === null || score < best.score) {
      best = { row, score };
    }
  }

  if (best === null) return null;

  const pid = best.row.parameterId;
  return {
    parameterId: pid,
    paramSlug: IELTS_SKILL_SLUGS[pid] ?? pid,
    label: IELTS_SKILL_LABELS[pid] ?? pid,
    score: best.score,
    moduleSlug,
    loRef: null,
  };
}
