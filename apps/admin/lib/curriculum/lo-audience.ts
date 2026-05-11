/**
 * LO audience helpers (#317)
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §5
 * @canonical-doc docs/CONTENT-PIPELINE.md §6
 * @canonical-doc docs/ENTITIES.md §6
 *
 * Two consumers see different shapes of the same Learning Objective rows:
 *
 *   - LEARNER view — the student-facing curriculum page. Filters out
 *     `learnerVisible=false` rows entirely; projects `performanceStatement`
 *     into the `description` field. The learner UI never knows the
 *     original row existed.
 *
 *   - AUTHOR view — the OPERATOR-facing curriculum editor. Returns every
 *     row with all classifier columns intact, so the editor can show
 *     hidden LOs with [system: ASSESSOR_RUBRIC] badges and let the author
 *     review/override classifier decisions.
 *
 * Both views read the same DB rows; only the projection differs. This
 * file provides the small helpers callers use to build either shape
 * from a Prisma `LearningObjective` selection.
 */

export type LoAudience = "learner" | "author";

/**
 * Parse the `?audience=...` query param. Returns "author" by default —
 * curriculum admin endpoints are OPERATOR-gated and benefit from the full
 * shape unless the caller explicitly requests the learner projection.
 */
export function parseAudience(value: string | null | undefined): LoAudience {
  return value === "learner" ? "learner" : "author";
}

/**
 * The fields we read from a LearningObjective row to make audience-aware
 * shaping decisions. Use this when constructing a Prisma select.
 */
export const AUDIENCE_AWARE_LO_SELECT = {
  id: true,
  ref: true,
  description: true,
  originalText: true,
  sortOrder: true,
  masteryThreshold: true,
  learnerVisible: true,
  performanceStatement: true,
  systemRole: true,
  humanOverriddenAt: true,
} as const;

/** Minimal shape returned by Prisma when AUDIENCE_AWARE_LO_SELECT is used. */
export interface AudienceAwareLo {
  id: string;
  ref: string;
  description: string;
  originalText: string | null;
  sortOrder: number;
  masteryThreshold: number | null;
  learnerVisible: boolean;
  performanceStatement: string | null;
  systemRole: string;
  humanOverriddenAt: Date | null;
}

/**
 * Resolve the description string the audience should see.
 *
 *   - learner view: `performanceStatement` if set, else `description`
 *     (gives a sensible fallback for rows the classifier hasn't touched yet).
 *   - author view: original `description` (the actual stored row text;
 *     `originalText` shown alongside as provenance, not as the headline).
 */
export function resolveLoDescription(lo: AudienceAwareLo, audience: LoAudience): string {
  if (audience === "learner") {
    return lo.performanceStatement ?? lo.description;
  }
  return lo.description;
}

/**
 * Filter a list of LOs for an audience.
 *
 *   - learner: drops `learnerVisible=false` rows entirely.
 *   - author: returns every row.
 */
export function filterLOsForAudience<T extends Pick<AudienceAwareLo, "learnerVisible">>(
  los: T[],
  audience: LoAudience,
): T[] {
  if (audience === "learner") {
    return los.filter((lo) => lo.learnerVisible);
  }
  return los;
}

/**
 * Project a LO row into the audience-appropriate response shape.
 *
 *   - learner view: minimal fields, `description` already resolved to
 *     `performanceStatement ?? description`. No classifier columns leak
 *     to the learner.
 *   - author view: full record including classifier columns.
 */
export function projectLoForAudience(
  lo: AudienceAwareLo,
  audience: LoAudience,
): Record<string, unknown> {
  if (audience === "learner") {
    return {
      id: lo.id,
      ref: lo.ref,
      description: resolveLoDescription(lo, "learner"),
      sortOrder: lo.sortOrder,
      masteryThreshold: lo.masteryThreshold,
    };
  }
  return {
    id: lo.id,
    ref: lo.ref,
    description: lo.description,
    originalText: lo.originalText,
    sortOrder: lo.sortOrder,
    masteryThreshold: lo.masteryThreshold,
    learnerVisible: lo.learnerVisible,
    performanceStatement: lo.performanceStatement,
    systemRole: lo.systemRole,
    humanOverriddenAt: lo.humanOverriddenAt,
  };
}
