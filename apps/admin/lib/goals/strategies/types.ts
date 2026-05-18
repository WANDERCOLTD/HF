/**
 * Goal-progress strategy contract (#444).
 *
 * Every strategy receives the same context shape: the Goal row (already
 * scoped to ACTIVE/PAUSED via trackGoalProgress), the callerId, the
 * callId for this call, and the resolved GOAL-PROGRESS-001 spec config
 * (passed down once per pipeline run — never re-fetched per goal).
 *
 * Strategies return a GoalProgressUpdate when progress moves forward, or
 * null when nothing changed / no signal available. They must never
 * regress progress; trackGoalProgress clamps `progress + progressDelta`
 * to [0, 1] but a strategy returning a negative delta is a bug.
 */

import type { Goal } from "@prisma/client";

export interface GoalProgressUpdate {
  goalId: string;
  progressDelta: number;
  evidence?: string;
}

export interface StrategyContext {
  callerId: string;
  callId: string;
  /** GOAL-PROGRESS-001 parsed config — the `strategyConfig[strategyKey]` block. */
  strategyConfig?: Record<string, unknown>;
}

export type GoalForStrategy = Goal & {
  contentSpec?: { id: string; slug: string; domain: string; config: unknown } | null;
};

export type StrategyFn = (
  goal: GoalForStrategy,
  ctx: StrategyContext,
) => Promise<GoalProgressUpdate | null>;

export type StrategyKey =
  | "skill_ema"
  | "lo_rollup"
  | "assessment_readiness"
  | "connect_warmth_avg"
  | "manual_only";

export const ALL_STRATEGY_KEYS: StrategyKey[] = [
  "skill_ema",
  "lo_rollup",
  "assessment_readiness",
  "connect_warmth_avg",
  "manual_only",
];
