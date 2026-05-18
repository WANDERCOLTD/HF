/**
 * lo_rollup strategy (#444).
 *
 * LEARN goals tagged to a learning-objective ref (`OUT-NN`, `LO-NN`,
 * `BAND-N-XXX`). Progress = mean of per-LO mastery across every module
 * in the playbook's curriculum that contains an LO with this ref.
 *
 * When the goal has a contentSpec but no ref (legacy / older authored
 * goals), falls back to module-level mastery roll-up against the
 * contentSpec's curriculum.
 *
 * Never regresses; never auto-engages on transcript noise — if no LO
 * scores exist, returns null and the goal stays at 0 with the
 * awaiting-evidence affordance.
 */

import {
  deriveLearnGoalProgressFromRef,
  deriveLearnGoalProgressFromMastery,
} from "../track-progress";
import { registerStrategy } from "./registry";
import type { StrategyFn } from "./types";

const loRollupStrategy: StrategyFn = async (goal, ctx) => {
  if (goal.ref && goal.playbookId) {
    const derived = await deriveLearnGoalProgressFromRef(ctx.callerId, {
      ref: goal.ref,
      playbookId: goal.playbookId,
    });
    if (derived && derived.progress > goal.progress) {
      return {
        goalId: goal.id,
        progressDelta: derived.progress - goal.progress,
        evidence: `LO ${goal.ref} mastery ${(derived.progress * 100).toFixed(0)}% across ${derived.touchedModules}/${derived.totalModulesWithRef} module(s)`,
      };
    }
    return null;
  }

  if (goal.contentSpecId) {
    const derived = await deriveLearnGoalProgressFromMastery(
      ctx.callerId,
      goal.contentSpecId,
    );
    if (derived && derived.progress > goal.progress) {
      return {
        goalId: goal.id,
        progressDelta: derived.progress - goal.progress,
        evidence: `Curriculum mastery avg ${(derived.progress * 100).toFixed(0)}% across ${derived.touchedModules}/${derived.totalModules} modules`,
      };
    }
  }

  return null;
};

registerStrategy("lo_rollup", loRollupStrategy);
