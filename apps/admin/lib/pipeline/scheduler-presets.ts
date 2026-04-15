/**
 * Scheduler policy presets — #155 Slice 2.
 *
 * Each preset is a bundle of weights for the 7 factors in `selectNextExchange`
 * (α–η, see `docs/decisions/2026-04-14-scheduler-owns-the-plan.md`) plus a
 * Track A retrieval cadence that drives `mode: assess` gating.
 *
 * Teachers never see these numbers. They pick a preset (Balanced / Interleaved /
 * Comprehension / Exam-prep / Revision / Confidence-build) or the system picks
 * one from `Playbook.config.teachingMode`.
 *
 * Forward compatibility note: when CourseArchetype lands (deferred per
 * 2026-04-15 planning session), archetype-level overrides replace the
 * teachingMode → preset mapping in `getPresetForPlaybook`. The preset values
 * themselves don't change.
 *
 * This module is a pure data module — no DB, no imports from runtime state.
 * `resolveLessonPlanMode()` in `lib/content-trust/resolve-config.ts` handles
 * routing (which *mode* of plan to run). This file handles *how* to pick inside
 * that mode. Do not conflate the two.
 */

export type SchedulerPresetName =
  | "BALANCED"
  | "INTERLEAVED"
  | "COMPREHENSION"
  | "EXAM_PREP"
  | "REVISION"
  | "CONFIDENCE_BUILD";

export interface SchedulerPolicy {
  name: SchedulerPresetName;
  /** α — mastery-gap priority (frontier outcomes first) */
  masteryGap: number;
  /** β — spaced-repetition due bonus */
  spacedDue: number;
  /** γ — interleave bonus (switch skill vs last exchange) */
  interleave: number;
  /** δ — difficulty targeting (ZPD offset) */
  difficultyZpd: number;
  /** −ε — recently-used penalty */
  recentlyUsedPenalty: number;
  /** −ζ — cognitive-load penalty (complex LOs stacked) */
  cognitiveLoadPenalty: number;
  /** η — retrieval-opportunity bonus (older mastered items due for test) */
  retrievalOpportunity: number;
  /**
   * Track A retrieval cadence — fire `mode: assess` every N calls.
   * 1 = every call, 2 = every second call, etc. Deferred refinement lives in
   * Track A delivery spike (#164); this is a v1 deterministic cap.
   */
  retrievalCadence: number;
  /**
   * Optional per-outcome mastery threshold override. Presets that need
   * tighter/looser criteria (Exam-prep, Confidence-build) set this; others
   * inherit from `LearningObjective.masteryThreshold ?? module.masteryThreshold`.
   */
  masteryThresholdOverride: number | null;
}

export const BALANCED: SchedulerPolicy = {
  name: "BALANCED",
  masteryGap: 1.0,
  spacedDue: 0.8,
  interleave: 0.5,
  difficultyZpd: 0.4,
  recentlyUsedPenalty: 0.3,
  cognitiveLoadPenalty: 0.2,
  retrievalOpportunity: 0.4,
  retrievalCadence: 3,
  masteryThresholdOverride: null,
};

export const INTERLEAVED: SchedulerPolicy = {
  name: "INTERLEAVED",
  masteryGap: 1.0,
  spacedDue: 0.9,
  interleave: 0.9,
  difficultyZpd: 0.4,
  recentlyUsedPenalty: 0.5,
  cognitiveLoadPenalty: 0.2,
  retrievalOpportunity: 0.4,
  retrievalCadence: 2,
  masteryThresholdOverride: null,
};

export const COMPREHENSION: SchedulerPolicy = {
  name: "COMPREHENSION",
  masteryGap: 1.0,
  spacedDue: 0.7,
  // Sequential content within frontier; interleave skills not content
  interleave: 0.7,
  difficultyZpd: 0.4,
  recentlyUsedPenalty: 0.3,
  cognitiveLoadPenalty: 0.2,
  retrievalOpportunity: 0.3,
  // Fire retrieval after each passage chunk — v1 approximation
  retrievalCadence: 2,
  masteryThresholdOverride: null,
};

export const EXAM_PREP: SchedulerPolicy = {
  name: "EXAM_PREP",
  // Breadth first: prioritise coverage of uncovered outcomes
  masteryGap: 1.3,
  spacedDue: 1.1,
  interleave: 0.5,
  // +25% ZPD per ADR
  difficultyZpd: 0.65,
  recentlyUsedPenalty: 0.3,
  cognitiveLoadPenalty: 0.2,
  retrievalOpportunity: 0.5,
  retrievalCadence: 2,
  // Lower threshold during coverage sweep
  masteryThresholdOverride: 0.6,
};

export const REVISION: SchedulerPolicy = {
  name: "REVISION",
  masteryGap: 0.6,
  spacedDue: 1.2,
  interleave: 0.6,
  difficultyZpd: 0.3,
  recentlyUsedPenalty: 0.3,
  cognitiveLoadPenalty: 0.2,
  // Heavy retrieval emphasis
  retrievalOpportunity: 1.0,
  retrievalCadence: 1,
  masteryThresholdOverride: null,
};

export const CONFIDENCE_BUILD: SchedulerPolicy = {
  name: "CONFIDENCE_BUILD",
  masteryGap: 1.0,
  spacedDue: 0.7,
  interleave: 0.4,
  // −5% ZPD per ADR
  difficultyZpd: 0.25,
  recentlyUsedPenalty: 0.5,
  // Avoid stacking hard items
  cognitiveLoadPenalty: 0.4,
  retrievalOpportunity: 0.3,
  retrievalCadence: 4,
  // Lower bar to let the learner bank wins
  masteryThresholdOverride: 0.6,
};

export const ALL_PRESETS: Record<SchedulerPresetName, SchedulerPolicy> = {
  BALANCED,
  INTERLEAVED,
  COMPREHENSION,
  EXAM_PREP,
  REVISION,
  CONFIDENCE_BUILD,
};

/**
 * Map a playbook to a preset.
 *
 * Priority:
 *   1. Explicit `config.schedulerPreset` on Playbook (story #166 adds the picker).
 *   2. `teachingMode` heuristic — the temporary bridge until CourseArchetype ships.
 *   3. BALANCED fallback.
 *
 * Accepts a loose playbook shape so callers can pass `data.playbooks[0]` directly
 * without coupling this module to the Playbook Prisma type.
 */
export function getPresetForPlaybook(
  playbook: { config?: unknown } | null | undefined,
): SchedulerPolicy {
  const cfg = (playbook?.config ?? {}) as Record<string, unknown>;

  const explicit = cfg.schedulerPreset;
  if (typeof explicit === "string" && explicit.toUpperCase() in ALL_PRESETS) {
    return ALL_PRESETS[explicit.toUpperCase() as SchedulerPresetName];
  }

  const teachingMode = typeof cfg.teachingMode === "string" ? cfg.teachingMode : null;
  switch (teachingMode) {
    case "comprehension":
      return COMPREHENSION;
    case "practice":
      return INTERLEAVED;
    case "syllabus":
      return EXAM_PREP;
    case "recall":
      return BALANCED;
    default:
      return BALANCED;
  }
}
