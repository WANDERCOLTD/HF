/**
 * Scheduler policy presets — #155 Slice 2, extended by #164 (retrieval practice).
 *
 * Each preset is a bundle of weights for the 7 factors in `selectNextExchange`
 * (α–η, see `docs/decisions/2026-04-14-scheduler-owns-the-plan.md`) plus a
 * Track A retrieval cadence that drives `mode: assess` gating, plus retrieval
 * practice defaults that control how many MCQs are injected per call mode.
 *
 * Teachers never see these numbers. They pick a preset (Balanced / Interleaved /
 * Comprehension / Exam-prep / Revision / Confidence-build) or the system picks
 * one from `Playbook.config.teachingMode`.
 *
 * Archetype alignment: each preset is the FIRST FACET of what will become a
 * full CourseArchetype — the retrieval defaults here are the seed values for
 * per-archetype config records in the DB. When the CourseArchetype epic ships,
 * the teachingMode → preset mapping is replaced by archetype → config lookup.
 * The preset values become the seed source, not the runtime truth.
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
  | "CONFIDENCE_BUILD"
  | "FREE_FLOW";

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

  // ── Retrieval practice defaults (#164) ────────────────────
  //
  // These seed the per-archetype retrieval config in the DB. After seeding,
  // the DB owns the values. This is the first facet of the CourseArchetype
  // shape — more facets (prompt tone, assessment strategy, communication
  // rules) will follow when the archetype epic ships.

  /**
   * Maximum retrieval questions per call, keyed by scheduler mode.
   * Actual count is scaled down by `informationNeed` (0–1): fewer questions
   * when the system has fresh, comprehensive mastery data for this learner.
   * Minimum is always 1 (retrieval is never off in continuous mode).
   */
  retrievalQuestions: { teach: number; assess: number; review: number };

  /**
   * Minimum Bloom taxonomy level for retrieval questions.
   * Exam-prep and comprehension courses skip REMEMBER-only questions;
   * confidence-build and revision include them for easy wins.
   */
  retrievalBloomFloor: "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE";
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
  retrievalQuestions: { teach: 2, assess: 3, review: 1 },
  retrievalBloomFloor: "REMEMBER",
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
  retrievalQuestions: { teach: 2, assess: 3, review: 2 },
  retrievalBloomFloor: "REMEMBER",
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
  // Theme recall + inference probes, not factual recall
  retrievalQuestions: { teach: 1, assess: 2, review: 1 },
  retrievalBloomFloor: "UNDERSTAND",
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
  // Past-paper style, application-level questions
  retrievalQuestions: { teach: 2, assess: 3, review: 2 },
  retrievalBloomFloor: "UNDERSTAND",
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
  // High frequency, all levels — student has seen this material before
  retrievalQuestions: { teach: 2, assess: 3, review: 2 },
  retrievalBloomFloor: "REMEMBER",
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
  // Easy wins, low pressure — REMEMBER-level so the learner can bank successes
  retrievalQuestions: { teach: 1, assess: 2, review: 1 },
  retrievalBloomFloor: "REMEMBER",
};

/**
 * FREE_FLOW — the preset CONTINUOUS courses get (#1257).
 *
 * CONTINUOUS courses have no fixed module sequence — there's no "frontier
 * outcome", no spaced-due to fire, no skill to interleave to next. All
 * factor weights are zero so `selectNextExchange` falls back to uniform
 * selection inside the topic pool. Retrieval is effectively off
 * (`retrievalCadence: 999` means "fire mode:assess every 999 calls" —
 * we use a sentinel instead of `null` because the readers do
 * `callCount % retrievalCadence` arithmetic).
 *
 * Retrieval questions all zero — CONTINUOUS courses don't run the MCQ
 * injection pipeline. `retrievalBloomFloor` is set to "REMEMBER" (the
 * most permissive) because the field is a non-null string union; the
 * value is unread when `retrievalQuestions` are all zero.
 */
export const FREE_FLOW: SchedulerPolicy = {
  name: "FREE_FLOW",
  masteryGap: 0,
  spacedDue: 0,
  interleave: 0,
  difficultyZpd: 0,
  recentlyUsedPenalty: 0,
  cognitiveLoadPenalty: 0,
  retrievalOpportunity: 0,
  retrievalCadence: 999,
  masteryThresholdOverride: null,
  retrievalQuestions: { teach: 0, assess: 0, review: 0 },
  retrievalBloomFloor: "REMEMBER",
};

export const ALL_PRESETS: Record<SchedulerPresetName, SchedulerPolicy> = {
  BALANCED,
  INTERLEAVED,
  COMPREHENSION,
  EXAM_PREP,
  REVISION,
  CONFIDENCE_BUILD,
  FREE_FLOW,
};

/**
 * Map a playbook to a preset.
 *
 * Priority (post-#1257):
 *   1. CONTINUOUS course → FREE_FLOW. Unconditional. CONTINUOUS courses
 *      have no fixed module sequence, so prioritisation weights are
 *      meaningless.
 *   2. Explicit `config.schedulerPreset` on Playbook (story #166 adds the picker).
 *   3. STRUCTURED course with no explicit preset → `teachingMode` bridge
 *      (kept for back-compat — only fires on STRUCTURED playbooks that
 *      pre-date the picker).
 *   4. BALANCED fallback.
 *
 * Accepts a loose playbook shape so callers can pass `data.playbooks[0]` directly
 * without coupling this module to the Playbook Prisma type.
 */
export function getPresetForPlaybook(
  playbook: { config?: unknown } | null | undefined,
): SchedulerPolicy {
  const cfg = (playbook?.config ?? {}) as Record<string, unknown>;

  // #1257 — CONTINUOUS courses always get FREE_FLOW. Read lessonPlanMode
  // directly here (no import of getCourseStyle to avoid the pipeline →
  // scheduler cycle); the default-deny rule is the same shape: only
  // explicit `lessonPlanMode === "structured"` opts out of FREE_FLOW.
  if (cfg.lessonPlanMode !== "structured") {
    return FREE_FLOW;
  }

  let basePreset: SchedulerPolicy;
  const explicit = cfg.schedulerPreset;
  if (typeof explicit === "string" && explicit.toUpperCase() in ALL_PRESETS) {
    basePreset = ALL_PRESETS[explicit.toUpperCase() as SchedulerPresetName];
  } else {
    const teachingMode = typeof cfg.teachingMode === "string" ? cfg.teachingMode : null;
    switch (teachingMode) {
      case "comprehension":
        basePreset = COMPREHENSION;
        break;
      case "practice":
        basePreset = INTERLEAVED;
        break;
      case "syllabus":
        basePreset = EXAM_PREP;
        break;
      case "recall":
        basePreset = BALANCED;
        break;
      default:
        basePreset = BALANCED;
    }
  }

  // #598 Slice 1 — `Playbook.config.tolerances.retrievalCadenceOverride` is a
  // course-level shallow merge over the preset's retrievalCadence (positive
  // integer, no per-learner override per ADR — interleaving relies on a
  // single course-wide rhythm). Preset name is unchanged so downstream logs
  // still surface the named policy.
  const tolerances = cfg.tolerances as { retrievalCadenceOverride?: unknown } | undefined;
  const override = tolerances?.retrievalCadenceOverride;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return { ...basePreset, retrievalCadence: Math.floor(override) };
  }
  return basePreset;
}
