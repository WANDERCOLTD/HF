/**
 * scoring-config.ts — sub-epic C of epic #2049 (story #2052).
 *
 * Single chokepoint that reads the 5 scoring-related operator overrides
 * from `Playbook.config` and exposes them as a typed envelope.
 *
 * Wired into:
 *   - `lib/prompt/composition/transforms/modules.ts` — `loMasteryThreshold`
 *     overrides the per-LO mastery cut used by the loMastery section.
 *   - `lib/prompt/composition/transforms/instructions.ts` — emits
 *     `assessment_readiness_directive` (gates pre/mid/post-test stops on
 *     `behavior_profile:learning:*` rollup) + `progress_signal_directive`
 *     (reads `behavior_profile:engagement:*` rollup against the low/high
 *     water marks; falls back to averaged per-LO mastery when the rollup
 *     is unavailable).
 *   - `lib/ops/compute-reward.ts` — picks the reward-strategy weighting
 *     when the operator override is set.
 *
 * Lattice survey (per `.claude/rules/lattice-survey.md`):
 *   - DB columns touched: read-only over Playbook.config + CallerAttribute
 *     rows produced by BEH-AGG-001 (`behavior_profile:*` keys).
 *   - Chain-stage boundary: COMPOSE (read inputs); REWARD (read inputs).
 *     No writes from this module — REWARD's write surface is intact.
 *   - Cascade: these 5 settings are Course-scoped only today. Future
 *     Domain/System cascade would wire through `lib/cascade/effective-value.ts`.
 *   - Convention: every read is `?? undefined` — absence preserves
 *     byte-identity with the previous behaviour.
 *
 * @see lib/journey/producer-only-registry.ts — these 5 contracts are now
 *      removed from the producer-only list.
 * @see lib/journey/setting-contracts.entries.ts — the 5 contracts:
 *      `loMasteryThreshold`, `assessmentReadinessThreshold`,
 *      `progressSignalLowWater`, `progressSignalHighWater`,
 *      `rewardStrategy`.
 */

import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface ScoringConfig {
  /** Per-course LO mastery pass threshold. Overrides tierPresetId-derived
   *  cut when set. Range [0,1]. */
  loMasteryThreshold: number | undefined;
  /** Mastery the learner must reach before pre/mid/post-test stops fire.
   *  Read against `behavior_profile:learning:*` aggregates (with per-LO
   *  mastery fallback). Range [0,1]. */
  assessmentReadinessThreshold: number | undefined;
  /** Below this mastery, AI emphasises encouragement. Range [0,1]. */
  progressSignalLowWater: number | undefined;
  /** Above this mastery, AI emphasises stretch / challenge. Range [0,1]. */
  progressSignalHighWater: number | undefined;
  /** Which reward signal the adaptive loop optimises for. */
  rewardStrategy: "learner_mastery" | "educator_drift" | "blended" | undefined;
}

/**
 * Resolve the 5 scoring overrides from a Playbook.config payload.
 *
 * Returns an envelope where every field is `undefined` when the operator
 * hasn't set the value — consumers are responsible for the fallback
 * (tier preset / hardcoded threshold / default strategy).
 *
 * Pure function. No I/O. Safe to call from any compose / pipeline path
 * that has the Playbook.config in hand.
 */
export function resolveScoringConfig(
  config: PlaybookConfig | null | undefined,
): ScoringConfig {
  if (!config) {
    return {
      loMasteryThreshold: undefined,
      assessmentReadinessThreshold: undefined,
      progressSignalLowWater: undefined,
      progressSignalHighWater: undefined,
      rewardStrategy: undefined,
    };
  }
  return {
    loMasteryThreshold: clampUnit(config.loMasteryThreshold),
    assessmentReadinessThreshold: clampUnit(config.assessmentReadinessThreshold),
    progressSignalLowWater: clampUnit(config.progressSignals?.lowWater),
    progressSignalHighWater: clampUnit(config.progressSignals?.highWater),
    rewardStrategy: normaliseRewardStrategy(config.rewardStrategy),
  };
}

/** Clamp to [0,1] and reject non-finite values. */
function clampUnit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normaliseRewardStrategy(
  v: unknown,
): "learner_mastery" | "educator_drift" | "blended" | undefined {
  if (v === "learner_mastery" || v === "educator_drift" || v === "blended") {
    return v;
  }
  return undefined;
}

/**
 * Read the aggregated learning-mastery rollup from `behavior_profile:learning:*`
 * CallerAttributes produced by BEH-AGG-001. Returns the mean across all
 * matching rows, or `null` when no aggregate exists yet.
 *
 * Used by:
 *   - `assessment_readiness_directive` (instructions transform) to decide
 *     whether a pre/mid/post-test stop should be allowed to fire.
 *   - `progress_signal_directive` (instructions transform) as the primary
 *     signal compared against low/high water marks.
 *
 * Per `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing": the
 * AGGREGATE output `behavior_profile:learning:*` (BEH-AGG-001) was
 * previously listed in `tests/lib/measurement/aggregate-output-consumer-coverage.test.ts`
 * — this consumer drops the gap by 1 when wired.
 */
export interface CallerAttributeLike {
  key: string;
  numberValue: number | null;
}

export function readLearningProfileMastery(
  callerAttributes: readonly CallerAttributeLike[] | null | undefined,
): number | null {
  return averageMatchingNumeric(callerAttributes, "behavior_profile:learning:");
}

/** Read the engagement rollup. Same shape as learning. */
export function readEngagementProfileMastery(
  callerAttributes: readonly CallerAttributeLike[] | null | undefined,
): number | null {
  return averageMatchingNumeric(callerAttributes, "behavior_profile:engagement:");
}

/** Read the supervision rollup — used by reward-strategy "learner_mastery"
 *  to weight tutor compliance. */
export function readSupervisionProfileMastery(
  callerAttributes: readonly CallerAttributeLike[] | null | undefined,
): number | null {
  return averageMatchingNumeric(callerAttributes, "behavior_profile:supervision:");
}

function averageMatchingNumeric(
  attrs: readonly CallerAttributeLike[] | null | undefined,
  prefix: string,
): number | null {
  if (!attrs || attrs.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const a of attrs) {
    if (a.key.startsWith(prefix) && typeof a.numberValue === "number" && Number.isFinite(a.numberValue)) {
      sum += a.numberValue;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * Fallback signal for the progress-signal directive when the engagement
 * rollup is absent — averages a `loMasteryMap` (per-LO mastery, keyed
 * `<moduleSlug>:<loRef>`).
 */
export function averageLoMastery(
  loMasteryMap: Record<string, number> | null | undefined,
): number | null {
  if (!loMasteryMap) return null;
  const values = Object.values(loMasteryMap).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Build the `assessment_readiness_directive` text. Returns null when the
 * operator hasn't set `assessmentReadinessThreshold` (byte-identical
 * previous behaviour).
 *
 * When set, emits one of:
 *   - "ready" — learner's mastery is >= threshold; assessment stops may fire.
 *   - "not_ready" — mastery is below threshold; defer assessment stops.
 *   - "unknown" — no mastery signal available yet; let existing rules decide.
 */
export interface AssessmentReadinessDirective {
  threshold: number;
  observedMastery: number | null;
  /** "ready" | "not_ready" | "unknown". */
  status: "ready" | "not_ready" | "unknown";
  source: "behavior_profile:learning:*" | "loMasteryMap" | "none";
}

export function buildAssessmentReadinessDirective(
  scoring: ScoringConfig,
  callerAttributes: readonly CallerAttributeLike[] | null | undefined,
  loMasteryMap: Record<string, number> | null | undefined,
): AssessmentReadinessDirective | null {
  if (scoring.assessmentReadinessThreshold === undefined) return null;
  const threshold = scoring.assessmentReadinessThreshold;

  const fromLearning = readLearningProfileMastery(callerAttributes);
  if (fromLearning !== null) {
    return {
      threshold,
      observedMastery: fromLearning,
      status: fromLearning >= threshold ? "ready" : "not_ready",
      source: "behavior_profile:learning:*",
    };
  }

  const fromMap = averageLoMastery(loMasteryMap);
  if (fromMap !== null) {
    return {
      threshold,
      observedMastery: fromMap,
      status: fromMap >= threshold ? "ready" : "not_ready",
      source: "loMasteryMap",
    };
  }

  return {
    threshold,
    observedMastery: null,
    status: "unknown",
    source: "none",
  };
}

/**
 * Build the `progress_signal_directive` text. Returns null when neither
 * water mark is set (byte-identical previous behaviour).
 *
 * Reads `behavior_profile:engagement:*` first; falls back to averaged
 * loMasteryMap.
 *
 * Emits:
 *   - "encouragement" — mastery below lowWater (when lowWater is set).
 *   - "stretch" — mastery above highWater (when highWater is set).
 *   - "in_band" — mastery between the two water marks.
 *   - "unknown" — no mastery signal at all.
 */
export interface ProgressSignalDirective {
  lowWater: number | undefined;
  highWater: number | undefined;
  observedMastery: number | null;
  /** "encouragement" | "stretch" | "in_band" | "unknown". */
  status: "encouragement" | "stretch" | "in_band" | "unknown";
  source: "behavior_profile:engagement:*" | "loMasteryMap" | "none";
}

export function buildProgressSignalDirective(
  scoring: ScoringConfig,
  callerAttributes: readonly CallerAttributeLike[] | null | undefined,
  loMasteryMap: Record<string, number> | null | undefined,
): ProgressSignalDirective | null {
  if (
    scoring.progressSignalLowWater === undefined &&
    scoring.progressSignalHighWater === undefined
  ) {
    return null;
  }

  const fromEngagement = readEngagementProfileMastery(callerAttributes);
  let observedMastery: number | null = fromEngagement;
  let source: ProgressSignalDirective["source"] = "behavior_profile:engagement:*";
  if (observedMastery === null) {
    observedMastery = averageLoMastery(loMasteryMap);
    source = "loMasteryMap";
  }
  if (observedMastery === null) {
    return {
      lowWater: scoring.progressSignalLowWater,
      highWater: scoring.progressSignalHighWater,
      observedMastery: null,
      status: "unknown",
      source: "none",
    };
  }

  let status: ProgressSignalDirective["status"] = "in_band";
  if (
    scoring.progressSignalLowWater !== undefined &&
    observedMastery < scoring.progressSignalLowWater
  ) {
    status = "encouragement";
  } else if (
    scoring.progressSignalHighWater !== undefined &&
    observedMastery > scoring.progressSignalHighWater
  ) {
    status = "stretch";
  }

  return {
    lowWater: scoring.progressSignalLowWater,
    highWater: scoring.progressSignalHighWater,
    observedMastery,
    status,
    source,
  };
}
