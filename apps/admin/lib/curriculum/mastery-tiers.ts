/**
 * Mastery tier vocabulary — #1081 Slice 1.
 *
 * The course-ref/learner-outcomes vocabulary uses four named tiers:
 *   FOUNDATION < DEVELOPING < PRACTITIONER < DISTINCTION
 *
 * Existing storage for mastery is NUMERIC (`CallerAttribute.numberValue` in
 * [0, 1]; `CallerModuleProgress.mastery` as Float). We therefore keep the
 * string tier as the *configuration vocabulary* (admin writes
 * `Playbook.config.maxMasteryTier: "DEVELOPING"`) and map to/from a numeric
 * ceiling at the write site. The mapping mirrors the bands already in use
 * elsewhere in the codebase (see `lib/assessment/generate-mcqs.ts` distractor
 * tiering).
 *
 * Numeric ceilings (inclusive upper bound of each band):
 *   FOUNDATION   = 0.25
 *   DEVELOPING   = 0.50
 *   PRACTITIONER = 0.75
 *   DISTINCTION  = 1.00
 *
 * `clampTier` is intentionally pure and value-shape-agnostic: callers convert
 * to the form they need via `numberCeilingForTier`.
 */

export const MASTERY_TIERS = [
  "FOUNDATION",
  "DEVELOPING",
  "PRACTITIONER",
  "DISTINCTION",
] as const;

export type MasteryTier = (typeof MASTERY_TIERS)[number];

export const TIER_RANK: Record<MasteryTier, number> = {
  FOUNDATION: 0,
  DEVELOPING: 1,
  PRACTITIONER: 2,
  DISTINCTION: 3,
};

/** Inclusive upper bound of each tier band, on the canonical [0, 1] mastery scale. */
export const TIER_NUMERIC_CEILING: Record<MasteryTier, number> = {
  FOUNDATION: 0.25,
  DEVELOPING: 0.5,
  PRACTITIONER: 0.75,
  DISTINCTION: 1.0,
};

export function isMasteryTier(value: unknown): value is MasteryTier {
  return typeof value === "string" && (MASTERY_TIERS as readonly string[]).includes(value);
}

/** Returns the numeric ceiling for a tier on the [0, 1] mastery scale. */
export function numberCeilingForTier(tier: MasteryTier): number {
  return TIER_NUMERIC_CEILING[tier];
}

/** Pure tier comparison — returns the lower of `value` and `cap`. */
export function clampTier(value: MasteryTier, cap: MasteryTier): MasteryTier {
  return TIER_RANK[value] <= TIER_RANK[cap] ? value : cap;
}

/**
 * Clamp a numeric mastery score to the ceiling of the given tier.
 * Used at the AGGREGATE write site to enforce `Playbook.config.maxMasteryTier`
 * on the CONTRIBUTION (not the final value — see track-progress.ts for the
 * `max(existing, clamped)` discipline that prevents downgrades).
 */
export function clampNumberToTier(value: number, cap: MasteryTier): number {
  return Math.min(value, TIER_NUMERIC_CEILING[cap]);
}
