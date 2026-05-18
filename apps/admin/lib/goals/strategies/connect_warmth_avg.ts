/**
 * connect_warmth_avg strategy (#444).
 *
 * CONNECT goals — rapport / trust / open conversation. Progress derived
 * from the average of behaviour parameter scores listed in this strategy's
 * config block from GOAL-PROGRESS-001 (default `warmth`, `empathy`,
 * `insight`). Thresholds and bumps are spec-driven, NOT hardcoded.
 *
 * Config shape (from GOAL-PROGRESS-001 strategyConfig.connect_warmth_avg):
 *   {
 *     paramKeys: string[],
 *     lowBumpThreshold: number,
 *     lowBump: number,
 *     highBumpThreshold: number,
 *     highBump: number,
 *   }
 */

import { prisma } from "@/lib/prisma";
import { PARAMS } from "@/lib/registry";
import { registerStrategy } from "./registry";
import type { StrategyFn } from "./types";

interface ConnectConfig {
  paramKeys?: string[];
  lowBumpThreshold?: number;
  lowBump?: number;
  highBumpThreshold?: number;
  highBump?: number;
}

const PARAM_KEY_MAP: Record<string, string> = {
  warmth: PARAMS.BEH_WARMTH,
  empathy: PARAMS.BEH_EMPATHY_RATE,
  insight: PARAMS.BEH_INSIGHT_FREQUENCY,
};

const connectWarmthAvgStrategy: StrategyFn = async (goal, ctx) => {
  const cfg = (ctx.strategyConfig ?? {}) as ConnectConfig;
  const paramKeyAliases = cfg.paramKeys ?? ["warmth", "empathy", "insight"];
  const lowBumpThreshold = cfg.lowBumpThreshold ?? 0.5;
  const lowBump = cfg.lowBump ?? 0.05;
  const highBumpThreshold = cfg.highBumpThreshold ?? 0.7;
  const highBump = cfg.highBump ?? 0.10;

  const parameterIds = paramKeyAliases
    .map((alias) => PARAM_KEY_MAP[alias])
    .filter((p): p is string => Boolean(p));
  if (parameterIds.length === 0) return null;

  const scores = await prisma.callScore.findMany({
    where: {
      callId: ctx.callId,
      parameter: { parameterId: { in: parameterIds } },
    },
    select: { score: true },
  });
  if (scores.length === 0) return null;

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  if (avgScore > highBumpThreshold) {
    return {
      goalId: goal.id,
      progressDelta: highBump,
      evidence: `High connection quality (avg ${avgScore.toFixed(2)} of ${paramKeyAliases.join(", ")})`,
    };
  }
  if (avgScore > lowBumpThreshold) {
    return {
      goalId: goal.id,
      progressDelta: lowBump,
      evidence: `Moderate connection quality (avg ${avgScore.toFixed(2)} of ${paramKeyAliases.join(", ")})`,
    };
  }
  return null;
};

registerStrategy("connect_warmth_avg", connectWarmthAvgStrategy);
