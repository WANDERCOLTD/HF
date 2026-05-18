/**
 * Strategy registry entry point (#444).
 *
 * Importing this module side-effect-registers every strategy. trackGoalProgress
 * and any other dispatch site imports from here to guarantee the registry
 * is populated.
 */

import "./skill_ema";
import "./lo_rollup";
import "./assessment_readiness";
import "./connect_warmth_avg";
import "./manual_only";

export { getStrategy, registerStrategy, registeredKeys } from "./registry";
export {
  loadGoalProgressSpec,
  resolveStrategyKey,
  resolveStrategyKeyAsync,
  _resetGoalProgressCache,
} from "./resolve-strategy";
export type { GoalProgressSpec, GoalProgressRule } from "./resolve-strategy";
export type { StrategyFn, StrategyContext, GoalProgressUpdate, StrategyKey } from "./types";
