/**
 * Goal Progress Tracking
 *
 * Updates goal progress based on call outcomes and curriculum completion.
 * Called after each call analysis to track progress toward goals.
 */

import { prisma } from "@/lib/prisma";
import { GoalStatus } from "@prisma/client";
import { PARAMS } from "@/lib/registry";
import { ContractRegistry } from "@/lib/contracts/registry";
import {
  getStrategy,
  loadGoalProgressSpec,
  resolveStrategyKey,
} from "./strategies";

export interface GoalProgressUpdate {
  goalId: string;
  progressDelta: number; // Amount to increment progress (0-1)
  evidence?: string;
}

// ── #417 Phase D — banding helper + ACHIEVE skill progress ────────────────

/** Default banding when SKILL_MEASURE_V1 contract isn't seeded yet. */
const SKILL_TIER_DEFAULTS = {
  thresholds: {
    approachingEmerging: 0.3,
    emerging: 0.55,
    developing: 0.7,
    secure: 1.0,
  },
  tierBands: {
    approachingEmerging: 3,
    emerging: 4,
    developing: 5.5,
    secure: 7,
  },
};

export interface SkillTierMapping {
  thresholds: {
    approachingEmerging: number;
    emerging: number;
    developing: number;
    secure: number;
  };
  tierBands: {
    approachingEmerging: number;
    emerging: number;
    developing: number;
    secure: number;
  };
}

/**
 * Pure-function tier classifier — exported for unit tests. Maps a 0-1
 * running skill score to a named tier and an IELTS-style band number.
 * Thresholds are inclusive at the upper end of each tier; see contract
 * notes for the IELTS band correspondence.
 */
export function scoreToTier(
  score: number,
  mapping: SkillTierMapping = SKILL_TIER_DEFAULTS,
): { tier: string; band: number } {
  const s = Math.max(0, Math.min(1, score));
  const t = mapping.thresholds;
  if (s < t.approachingEmerging)
    return { tier: "Approaching Emerging", band: mapping.tierBands.approachingEmerging };
  if (s < t.emerging) return { tier: "Emerging", band: mapping.tierBands.emerging };
  if (s < t.developing)
    return { tier: "Developing", band: mapping.tierBands.developing };
  return { tier: "Secure", band: mapping.tierBands.secure };
}

/**
 * Resolve the tier mapping. Precedence (highest first):
 *   1. Per-playbook `Playbook.config.skillTierMapping` (Story C)
 *   2. SKILL_MEASURE_V1 contract thresholds + tierBands
 *   3. Built-in IELTS defaults
 *
 * Exported so the caller-detail API can pass the resolved mapping to
 * the front-end (BandChip needs it client-side for tier rendering).
 */
export async function getSkillTierMapping(
  playbookId?: string | null,
): Promise<SkillTierMapping> {
  if (playbookId) {
    try {
      const playbook = await prisma.playbook.findUnique({
        where: { id: playbookId },
        select: { config: true },
      });
      const cfg = (playbook?.config ?? {}) as Record<string, any>;
      const pbMapping = cfg.skillTierMapping;
      if (
        pbMapping &&
        pbMapping.thresholds &&
        pbMapping.tierBands &&
        typeof pbMapping.thresholds.secure === "number" &&
        typeof pbMapping.tierBands.secure === "number"
      ) {
        return {
          thresholds: pbMapping.thresholds,
          tierBands: pbMapping.tierBands,
        };
      }
    } catch {
      // Playbook lookup failed — fall through to contract.
    }
  }
  try {
    const contract = await ContractRegistry.get("SKILL_MEASURE_V1");
    const thresholds = (contract?.thresholds ?? null) as SkillTierMapping["thresholds"] | null;
    const tierBands = ((contract as any)?.tierBands ?? null) as SkillTierMapping["tierBands"] | null;
    if (thresholds && tierBands) return { thresholds, tierBands };
  } catch {
    // Contract not seeded yet — fall through to defaults.
  }
  return SKILL_TIER_DEFAULTS;
}

/**
 * #417 Phase D — derive an ACHIEVE goal's progress from the running
 * per-skill score in `CallerTarget.currentScore`.
 *
 * Chain:
 *   `Goal.ref` ("SKILL-NN") + `Goal.playbookId`
 *     → BehaviorTarget(skillRef, playbookId, effectiveUntil=null).parameterId
 *     → CallerTarget(callerId, parameterId).currentScore + targetValue
 *     → progress = min(1.0, currentScore / targetValue)
 *
 * Returns null when:
 *   - no BehaviorTarget exists for the ref + playbook (skill not part of
 *     this playbook's framework), or
 *   - no CallerTarget exists yet (caller hasn't been scored on this skill),
 *     or
 *   - derived progress is not strictly greater than the goal's current
 *     progress (no update needed; never goes backwards).
 *
 * Pure-function consumers should call `scoreToTier()` directly with the
 * underlying score; the evidence string here is a convenience for
 * `trackGoalProgress` callers.
 */
export async function calculateSkillAchieveProgress(
  goal: { id: string; ref: string | null; playbookId: string | null; progress: number },
  callerId: string,
): Promise<GoalProgressUpdate | null> {
  if (!goal.ref || !goal.playbookId) return null;

  const bt = await prisma.behaviorTarget.findFirst({
    where: {
      skillRef: goal.ref,
      playbookId: goal.playbookId,
      effectiveUntil: null,
    },
    select: { parameterId: true, targetValue: true },
  });
  if (!bt) return null;

  const ct = await prisma.callerTarget.findUnique({
    where: { callerId_parameterId: { callerId, parameterId: bt.parameterId } },
    select: { currentScore: true, callsUsed: true },
  });
  if (!ct || ct.currentScore === null || !ct.callsUsed) return null;

  const targetValue = bt.targetValue || 1.0;
  const progress = Math.min(1.0, ct.currentScore / targetValue);
  if (progress <= goal.progress) return null;

  const mapping = await getSkillTierMapping(goal.playbookId);
  const { tier, band } = scoreToTier(ct.currentScore, mapping);
  return {
    goalId: goal.id,
    progressDelta: progress - goal.progress,
    evidence: `Skill score ${ct.currentScore.toFixed(2)} / target ${targetValue.toFixed(2)} — currently at ${tier} (band ~${band}), ${ct.callsUsed} call(s) weighted`,
  };
}

/**
 * Track progress for all active goals after a call (#444).
 *
 * Pure dispatch — loads GOAL-PROGRESS-001 spec once at the top, then for each
 * Goal looks up its progressStrategy (or resolves it on the fly when null) and
 * invokes the registered StrategyFn from lib/goals/strategies/registry.ts.
 *
 * No inline goal-type branching, no engagement-heuristic fallback. Goals that
 * resolve to `manual_only` stay at 0 with the UI showing "awaiting evidence".
 */
export async function trackGoalProgress(
  callerId: string,
  callId: string,
): Promise<{ updated: number; completed: number }> {
  const goals = await prisma.goal.findMany({
    where: {
      callerId,
      status: { in: [GoalStatus.ACTIVE, GoalStatus.PAUSED] },
    },
    include: { contentSpec: true },
  });

  if (goals.length === 0) {
    return { updated: 0, completed: 0 };
  }

  const spec = await loadGoalProgressSpec();

  let updatedCount = 0;
  let completedCount = 0;

  for (const goal of goals) {
    const strategyKey =
      goal.progressStrategy ??
      resolveStrategyKey(
        {
          type: goal.type,
          ref: goal.ref,
          contentSpecId: goal.contentSpecId,
          isAssessmentTarget: goal.isAssessmentTarget,
        },
        spec,
      );
    const strategy = getStrategy(strategyKey);
    const strategyConfig = spec.strategyConfig[strategyKey];
    const progressUpdate = await strategy(goal as any, { callerId, callId, strategyConfig });

    if (progressUpdate && progressUpdate.progressDelta > 0) {
      const newProgress = Math.min(1.0, goal.progress + progressUpdate.progressDelta);
      const shouldAutoComplete = newProgress >= 1.0 && !goal.isAssessmentTarget;

      await prisma.goal.update({
        where: { id: goal.id },
        data: {
          progress: newProgress,
          updatedAt: new Date(),
          ...(shouldAutoComplete && {
            status: GoalStatus.COMPLETED,
            completedAt: new Date(),
          }),
        },
      });

      updatedCount++;
      if (shouldAutoComplete) completedCount++;
    }
  }

  return { updated: updatedCount, completed: completedCount };
}

/**
 * #414 Phase 5b — derive a LEARN goal's progress from the specific LO it
 * tracks (`goal.ref`). Mean of `CallerModuleProgress.loScoresJson[ref].mastery`
 * across every module in the caller's playbook curricula that contains an LO
 * with this ref. Modules where the caller has no progress row, or where the
 * loScoresJson has no entry for `ref`, are skipped from the mean (matches
 * the existing `rollupModuleMastery` semantics — partial coverage doesn't
 * drag a goal toward zero).
 *
 * Returns null when:
 *   - no LO with this ref exists in the playbook's curricula, or
 *   - no caller progress has accumulated for any matching module's loScoresJson
 *
 * Mean-across-modules is the documented aggregation per #414 AC.
 */
export async function deriveLearnGoalProgressFromRef(
  callerId: string,
  goal: { ref: string; playbookId: string | null },
): Promise<{
  progress: number;
  totalModulesWithRef: number;
  touchedModules: number;
} | null> {
  if (!goal.ref || !goal.playbookId) return null;

  const los = await prisma.learningObjective.findMany({
    where: {
      ref: goal.ref,
      module: { curriculum: { playbookId: goal.playbookId } },
    },
    select: { moduleId: true },
  });
  if (los.length === 0) return null;

  const moduleIds = Array.from(new Set(los.map((lo) => lo.moduleId)));
  const progresses = await prisma.callerModuleProgress.findMany({
    where: { callerId, moduleId: { in: moduleIds } },
    select: { moduleId: true, loScoresJson: true },
  });

  const masteries: number[] = [];
  for (const p of progresses) {
    const scores = p.loScoresJson as Record<
      string,
      { mastery?: number; callCount?: number }
    > | null;
    const entry = scores?.[goal.ref];
    if (entry && typeof entry.mastery === "number") {
      masteries.push(entry.mastery);
    }
  }
  if (masteries.length === 0) return null;

  const progress = masteries.reduce((s, v) => s + v, 0) / masteries.length;
  return {
    progress,
    totalModulesWithRef: moduleIds.length,
    touchedModules: masteries.length,
  };
}

/**
 * #397 Phase 2: derive LEARN goal progress from accumulated CallerModuleProgress
 * mastery instead of the legacy flat 5%-per-engaged-call heuristic.
 *
 * Roll-up: sum(mastery for every CurriculumModule under any Curriculum linked
 * to the goal's contentSpec) / count(those modules). Untouched modules
 * contribute 0 so a goal can't claim near-completion after one call against
 * one module of a four-module course.
 */
export async function deriveLearnGoalProgressFromMastery(
  callerId: string,
  contentSpecId: string,
): Promise<{ progress: number; totalModules: number; touchedModules: number } | null> {
  const modules = await prisma.curriculumModule.findMany({
    where: {
      isActive: true,
      curriculum: { sourceSpecId: contentSpecId },
    },
    select: { id: true },
  });
  if (modules.length === 0) return null;

  const moduleIds = modules.map((m) => m.id);
  const progresses = await prisma.callerModuleProgress.findMany({
    where: { callerId, moduleId: { in: moduleIds } },
    select: { mastery: true },
  });

  const totalMastery = progresses.reduce((sum, p) => sum + p.mastery, 0);
  return {
    progress: totalMastery / modules.length,
    totalModules: modules.length,
    touchedModules: progresses.length,
  };
}

/**
 * #444 — per-type calculators removed. Strategies live in
 * lib/goals/strategies/*.ts and are dispatched from trackGoalProgress via
 * STRATEGY_REGISTRY. The engagement-heuristic path is intentionally deleted:
 * unmeasurable goals stay at 0 with the "awaiting evidence" UI affordance.
 */

/**
 * Apply assessment-aware target adjustments.
 *
 * When a caller has assessment target goals, adjusts behavior targets based on
 * proximity to the assessment threshold:
 * - Near threshold (>= 0.7): increase question rate, reduce scaffolding → exam prep mode
 * - Far from threshold (< 0.3): increase scaffolding, focus foundations → build-up mode
 * - Middle range: no adjustment (default behavior)
 *
 * Writes to CallerTarget entries, which are merged into behavior targets for prompt composition.
 */
export async function applyAssessmentAdaptation(
  callerId: string,
): Promise<{ adjustments: number }> {
  const goals = await prisma.goal.findMany({
    where: {
      callerId,
      isAssessmentTarget: true,
      status: "ACTIVE",
    },
    select: { progress: true, assessmentConfig: true },
  });

  if (goals.length === 0) return { adjustments: 0 };

  // Use the highest-priority (most advanced) assessment target for adaptation
  const primaryGoal = goals.reduce((best, g) => g.progress > best.progress ? g : best, goals[0]);
  const threshold = (primaryGoal.assessmentConfig as any)?.threshold ?? 0.8;
  const progress = primaryGoal.progress;

  let adjustments = 0;

  if (progress >= 0.7) {
    // Near threshold — exam prep mode: more questions, less hand-holding
    const targets: Array<{ parameterId: string; value: number; rationale: string }> = [
      { parameterId: PARAMS.BEH_QUESTION_RATE, value: 0.8, rationale: `Assessment target ${(progress * 100).toFixed(0)}% ready (threshold: ${(threshold * 100).toFixed(0)}%) — increase questioning for exam readiness` },
    ];
    for (const t of targets) {
      await prisma.callerTarget.upsert({
        where: { callerId_parameterId: { callerId, parameterId: t.parameterId } },
        create: { callerId, parameterId: t.parameterId, targetValue: t.value, confidence: 0.7 },
        update: { targetValue: t.value, confidence: 0.7 },
      });
      adjustments++;
    }
  } else if (progress < 0.3) {
    // Far from threshold — foundation mode: more scaffolding, gentler pace
    const targets: Array<{ parameterId: string; value: number; rationale: string }> = [
      { parameterId: PARAMS.BEH_QUESTION_RATE, value: 0.3, rationale: `Assessment target only ${(progress * 100).toFixed(0)}% ready — reduce question pressure, build foundations` },
    ];
    for (const t of targets) {
      await prisma.callerTarget.upsert({
        where: { callerId_parameterId: { callerId, parameterId: t.parameterId } },
        create: { callerId, parameterId: t.parameterId, targetValue: t.value, confidence: 0.6 },
        update: { targetValue: t.value, confidence: 0.6 },
      });
      adjustments++;
    }
  }
  // Middle range (0.3-0.7): no assessment-driven adjustment — default behavior targets apply

  return { adjustments };
}

/**
 * Manually update goal progress (for admin/testing)
 */
export async function updateGoalProgress(
  goalId: string,
  progress: number,
  evidence?: string
): Promise<void> {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  await prisma.goal.update({
    where: { id: goalId },
    data: {
      progress: clampedProgress,
      updatedAt: new Date(),
      ...(clampedProgress >= 1.0 && {
        status: 'COMPLETED',
        completedAt: new Date(),
      }),
    },
  });
}
