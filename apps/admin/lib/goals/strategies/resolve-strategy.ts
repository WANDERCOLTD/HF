/**
 * GOAL-PROGRESS-001 spec resolver (#444).
 *
 * Loads the spec once per call site (e.g. once at the top of
 * trackGoalProgress, once at the top of instantiate-goals), then runs
 * the rule list against each goal's shape to determine its strategy
 * key.
 *
 * Resolution precedence:
 *   1. Explicit Goal.progressStrategy column (set at projection / creation).
 *   2. First GOAL-PROGRESS-001 rule whose `match` matches (highest priority).
 *   3. spec.defaultStrategy ("manual_only").
 */

import { prisma } from "@/lib/prisma";
import type { GoalType } from "@prisma/client";

export interface GoalProgressRule {
  priority: number;
  match: {
    goalType?: GoalType;
    refPattern?: string;
    hasContentSpec?: boolean;
    isAssessmentTarget?: boolean;
  };
  strategy: string;
  rationale?: string;
}

export interface GoalProgressSpec {
  defaultStrategy: string;
  rules: GoalProgressRule[];
  strategyConfig: Record<string, Record<string, unknown>>;
}

const DEFAULT_SPEC: GoalProgressSpec = {
  defaultStrategy: "manual_only",
  rules: [],
  strategyConfig: {},
};

let _cached: { value: GoalProgressSpec; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Test helper — clears the in-process cache. */
export function _resetGoalProgressCache(): void {
  _cached = null;
}

/**
 * Load GOAL-PROGRESS-001 once per call site. Cached for 30s in-process.
 * Falls back to an empty spec (everything resolves to manual_only) if
 * the spec hasn't been seeded yet — useful for first-boot dev environments.
 */
export async function loadGoalProgressSpec(): Promise<GoalProgressSpec> {
  if (_cached && Date.now() - _cached.loadedAt < CACHE_TTL_MS) {
    return _cached.value;
  }
  try {
    const spec = await prisma.analysisSpec.findFirst({
      where: { slug: { in: ["GOAL-PROGRESS-001", "goal-progress-001"] }, isActive: true },
      select: { config: true },
    });
    if (!spec) {
      _cached = { value: DEFAULT_SPEC, loadedAt: Date.now() };
      return DEFAULT_SPEC;
    }
    // Same shape as SKILL-AGG-001 etc. — spec.config holds a parameters[]
    // array; the entry with `goal_progress_strategies` id carries the rule
    // list under its own .config block.
    const specConfig = (spec.config ?? {}) as { parameters?: Array<{ id?: string; config?: Partial<GoalProgressSpec> }> };
    const param = (specConfig.parameters ?? []).find((p) => p.id === "goal_progress_strategies");
    const ruleConfig = (param?.config ?? {}) as Partial<GoalProgressSpec>;
    const value: GoalProgressSpec = {
      defaultStrategy: ruleConfig.defaultStrategy ?? "manual_only",
      rules: (ruleConfig.rules ?? []).slice().sort((a, b) => b.priority - a.priority),
      strategyConfig: ruleConfig.strategyConfig ?? {},
    };
    _cached = { value, loadedAt: Date.now() };
    return value;
  } catch (error: any) {
    console.warn(`[goal-progress-spec] load failed, using empty default: ${error.message}`);
    _cached = { value: DEFAULT_SPEC, loadedAt: Date.now() };
    return DEFAULT_SPEC;
  }
}

interface GoalShape {
  type: GoalType;
  ref: string | null;
  contentSpecId: string | null;
  isAssessmentTarget: boolean;
}

/**
 * Resolve the strategy key for a given goal shape. Pure function over the
 * spec — exported separately so apply-projection / instantiate-goals can
 * call it without dispatching the strategy itself.
 */
export function resolveStrategyKey(goal: GoalShape, spec: GoalProgressSpec): string {
  for (const rule of spec.rules) {
    if (rule.match.goalType && rule.match.goalType !== goal.type) continue;
    if (rule.match.refPattern) {
      if (!goal.ref) continue;
      try {
        if (!new RegExp(rule.match.refPattern).test(goal.ref)) continue;
      } catch {
        continue;
      }
    }
    if (
      rule.match.hasContentSpec !== undefined &&
      rule.match.hasContentSpec !== Boolean(goal.contentSpecId)
    )
      continue;
    if (
      rule.match.isAssessmentTarget !== undefined &&
      rule.match.isAssessmentTarget !== goal.isAssessmentTarget
    )
      continue;
    return rule.strategy;
  }
  return spec.defaultStrategy;
}

/** Convenience: load spec + resolve in one call. */
export async function resolveStrategyKeyAsync(goal: GoalShape): Promise<string> {
  const spec = await loadGoalProgressSpec();
  return resolveStrategyKey(goal, spec);
}
