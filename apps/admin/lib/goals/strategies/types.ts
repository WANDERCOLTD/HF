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

/**
 * Canonical enum of every registered strategy key — #1599.
 *
 * Use `StrategyKey.lo_rollup` etc. when assigning `Goal.progressStrategy`
 * from a new write site. The ESLint rule `hf-goals/no-bare-strategy-key`
 * blocks bare string literals outside this enum in `lib/` and `scripts/`
 * (registry alias map + test files are allow-listed) — same pattern as
 * `hf-curriculum/no-unscoped-slug-lookup` (#411) and
 * `hf-call/no-bare-call-create` (#1333).
 *
 * History: pre-#1599 the type was a bare string literal union, and a
 * seed script wrote `progressStrategy: "LO_MASTERY"` (uppercase) — the
 * registry resolved it via case-insensitive normalization, but only
 * because `STRATEGY_ALIASES` carries an explicit `lo_mastery → lo_rollup`
 * row. Without the alias, every LEARN goal on that playbook would have
 * silently fallen through to `manual_only` and sat at 0% forever.
 * #1554 added the alias to repair the live damage; #1599 ships the
 * enum + ESLint rule so a future surface can't reintroduce a casing
 * variant or a typo.
 *
 * If you add a new strategy: register it in `registry.ts` AND add it
 * here. The rule's hardcoded valid set in
 * `eslint-rules/no-bare-strategy-key.mjs` MUST be updated in the same
 * PR (the rule cannot import this TS module at lint time).
 */
export const StrategyKey = {
  skill_ema: "skill_ema",
  lo_rollup: "lo_rollup",
  assessment_readiness: "assessment_readiness",
  connect_warmth_avg: "connect_warmth_avg",
  manual_only: "manual_only",
} as const;

export type StrategyKey = (typeof StrategyKey)[keyof typeof StrategyKey];

export const ALL_STRATEGY_KEYS: StrategyKey[] = Object.values(StrategyKey);
