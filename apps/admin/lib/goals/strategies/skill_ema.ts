/**
 * skill_ema strategy (#444).
 *
 * SKILL-NN ACHIEVE goals — progress derived from the running EMA score
 * accumulated on `CallerTarget.currentScore` by SKILL-AGG-001 (#417).
 *
 * This is a thin wrapper around `calculateSkillAchieveProgress` in
 * track-progress.ts — kept there for backwards compatibility with
 * existing imports.
 */

import { calculateSkillAchieveProgress } from "../track-progress";
import { registerStrategy } from "./registry";
import type { StrategyFn } from "./types";

const skillEmaStrategy: StrategyFn = async (goal, ctx) => {
  return calculateSkillAchieveProgress(
    {
      id: goal.id,
      ref: goal.ref,
      playbookId: goal.playbookId,
      progress: goal.progress,
    },
    ctx.callerId,
  );
};

registerStrategy("skill_ema", skillEmaStrategy);
