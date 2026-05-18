/**
 * assessment_readiness strategy (#444).
 *
 * Goals with isAssessmentTarget=true and a linked contentSpec (the rubric).
 * Delegates to computeExamReadiness, which scores module coverage against
 * the contract's readiness thresholds.
 *
 * Critically: if readiness computation fails (e.g. contract not seeded yet),
 * returns null — does NOT fall back to a fake engagement delta. The goal
 * stays at its current progress and the UI surfaces "awaiting evidence".
 */

import { computeExamReadiness } from "@/lib/curriculum/exam-readiness";
import { registerStrategy } from "./registry";
import type { StrategyFn } from "./types";

const assessmentReadinessStrategy: StrategyFn = async (goal, ctx) => {
  if (!goal.contentSpec) return null;

  try {
    const readiness = await computeExamReadiness(ctx.callerId, goal.contentSpec.slug);
    const readinessScore = readiness.readinessScore;
    if (readinessScore > goal.progress) {
      return {
        goalId: goal.id,
        progressDelta: readinessScore - goal.progress,
        evidence: `Exam readiness: ${(readinessScore * 100).toFixed(0)}% (${readiness.level})${readiness.weakModules.length > 0 ? ` | Weak: ${readiness.weakModules.join(", ")}` : ""}`,
      };
    }
    return null;
  } catch (error: any) {
    console.warn(
      `[strategy:assessment_readiness] computeExamReadiness failed for goal ${goal.id}: ${error.message}`,
    );
    return null;
  }
};

registerStrategy("assessment_readiness", assessmentReadinessStrategy);
