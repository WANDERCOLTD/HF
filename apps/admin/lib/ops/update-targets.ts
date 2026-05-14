/**
 * update-targets.ts
 *
 * Target Update (Learning Loop)
 *
 * Updates BehaviorTargets based on reward signals.
 * Implements the learning loop: if outcome was good and we missed the target,
 * adjust the target toward what we actually did.
 *
 * Flow:
 * 1. For each RewardScore without targetUpdatesApplied:
 *    a. Analyze outcome (good/bad)
 *    b. Analyze parameter diffs (missed targets)
 *    c. Compute target adjustments based on learning rules
 *    d. Create new BehaviorTarget versions (supersede old ones)
 *    e. Record updates in RewardScore.targetUpdatesApplied
 *
 * Learning Rules:
 * - Good outcome + hit target → reinforce (increase confidence)
 * - Good outcome + missed target → adjust target toward actual
 * - Bad outcome + hit target → re-evaluate (maybe target is wrong)
 * - Bad outcome + missed target → adjust target away from actual
 *
 * This is the third step in the post-call reward loop.
 */

import { PrismaClient, BehaviorTargetScope, BehaviorTargetSource, Prisma } from "@prisma/client";
import type { SpecConfig, ParameterDiff } from "@/lib/types/json-fields";

const prisma = new PrismaClient();

// Config loaded from TARGET_LEARN spec (with defaults)
interface TargetLearnConfig {
  tolerance: number;
  learningRate: number;
  minConfidence: number;
  maxConfidence: number;
  // Adjustment multipliers for different scenarios
  reinforceConfidenceBoost: number;
  goodMissedConfidenceBoost: number;
  badHitConfidencePenalty: number;
  badMissedConfidencePenalty: number;
  badHitTargetAdjust: number;
  badMissedTargetAdjust: number;
}

const DEFAULT_TARGET_LEARN_CONFIG: TargetLearnConfig = {
  tolerance: 0.15,
  learningRate: 0.1,
  minConfidence: 0.1,
  maxConfidence: 0.95,
  reinforceConfidenceBoost: 0.5,
  goodMissedConfidenceBoost: 0.2,
  badHitConfidencePenalty: 0.3,
  badMissedConfidencePenalty: 0.2,
  badHitTargetAdjust: 0.3,
  badMissedTargetAdjust: 0.5,
};

/**
 * Load TARGET_LEARN spec config from database
 */
async function loadTargetLearnConfig(): Promise<TargetLearnConfig> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      outputType: "ADAPT", // Using ADAPT as this is target learning
      domain: "targets",
      isActive: true,
      scope: "SYSTEM",
    },
  });

  if (!spec?.config) {
    return DEFAULT_TARGET_LEARN_CONFIG;
  }

  const specConfig = spec.config as SpecConfig;
  return {
    tolerance: specConfig.tolerance ?? DEFAULT_TARGET_LEARN_CONFIG.tolerance,
    learningRate: specConfig.learningRate ?? DEFAULT_TARGET_LEARN_CONFIG.learningRate,
    minConfidence: specConfig.minConfidence ?? DEFAULT_TARGET_LEARN_CONFIG.minConfidence,
    maxConfidence: specConfig.maxConfidence ?? DEFAULT_TARGET_LEARN_CONFIG.maxConfidence,
    reinforceConfidenceBoost: specConfig.reinforceConfidenceBoost ?? DEFAULT_TARGET_LEARN_CONFIG.reinforceConfidenceBoost,
    goodMissedConfidenceBoost: specConfig.goodMissedConfidenceBoost ?? DEFAULT_TARGET_LEARN_CONFIG.goodMissedConfidenceBoost,
    badHitConfidencePenalty: specConfig.badHitConfidencePenalty ?? DEFAULT_TARGET_LEARN_CONFIG.badHitConfidencePenalty,
    badMissedConfidencePenalty: specConfig.badMissedConfidencePenalty ?? DEFAULT_TARGET_LEARN_CONFIG.badMissedConfidencePenalty,
    badHitTargetAdjust: specConfig.badHitTargetAdjust ?? DEFAULT_TARGET_LEARN_CONFIG.badHitTargetAdjust,
    badMissedTargetAdjust: specConfig.badMissedTargetAdjust ?? DEFAULT_TARGET_LEARN_CONFIG.badMissedTargetAdjust,
  };
}

interface UpdateTargetsOptions {
  verbose?: boolean;
  plan?: boolean;
  callId?: string;          // Update for specific call
  limit?: number;           // Max rewards to process
  learningRate?: number;    // How much to adjust (0-1, default 0.1)
  minConfidence?: number;   // Don't adjust targets below this confidence
}

interface TargetUpdate {
  parameterId: string;
  oldTarget: number;
  newTarget: number;
  oldConfidence: number;
  newConfidence: number;
  reason: string;
}

interface UpdateTargetsResult {
  rewardsProcessed: number;
  targetsUpdated: number;
  targetsCreated: number;
  errors: string[];
  updates: Array<{
    callId: string;
    updateCount: number;
    updates: TargetUpdate[];
  }>;
}

/**
 * Compute target adjustment based on reward outcome and diff
 */
function computeAdjustment(
  targetValue: number,
  actualValue: number,
  rewardScore: number,
  confidence: number,
  config: TargetLearnConfig
): { newTarget: number; newConfidence: number; reason: string } {
  const diff = actualValue - targetValue;
  const absDiff = Math.abs(diff);
  const hitTarget = absDiff <= config.tolerance;
  const goodOutcome = rewardScore > 0;

  let newTarget = targetValue;
  let newConfidence = confidence;
  let reason = "";

  if (goodOutcome && hitTarget) {
    // Reinforce - increase confidence
    newConfidence = Math.min(config.maxConfidence, confidence + config.learningRate * config.reinforceConfidenceBoost);
    reason = "Good outcome, hit target - reinforcing";
  } else if (goodOutcome && !hitTarget) {
    // Adjust target toward actual
    const adjustmentStrength = config.learningRate * (1 - confidence); // Lower confidence = more adjustment
    newTarget = targetValue + diff * adjustmentStrength;
    newTarget = Math.max(0, Math.min(1, newTarget));
    // Slightly increase confidence (we learned something)
    newConfidence = Math.min(config.maxConfidence, confidence + config.learningRate * config.goodMissedConfidenceBoost);
    reason = `Good outcome but missed target (diff=${diff.toFixed(2)}) - adjusting toward actual`;
  } else if (!goodOutcome && hitTarget) {
    // Hit target but bad outcome - maybe target is wrong
    // Decrease confidence, small adjustment away from actual
    newConfidence = Math.max(config.minConfidence, confidence - config.learningRate * config.badHitConfidencePenalty);
    // Small adjustment in opposite direction
    newTarget = targetValue - diff * config.learningRate * config.badHitTargetAdjust;
    newTarget = Math.max(0, Math.min(1, newTarget));
    reason = "Bad outcome despite hitting target - reconsidering";
  } else {
    // Bad outcome, missed target - adjust away from actual
    const adjustmentStrength = config.learningRate * config.badMissedTargetAdjust;
    newTarget = targetValue - diff * adjustmentStrength;
    newTarget = Math.max(0, Math.min(1, newTarget));
    // Decrease confidence
    newConfidence = Math.max(config.minConfidence, confidence - config.learningRate * config.badMissedConfidencePenalty);
    reason = `Bad outcome and missed target (diff=${diff.toFixed(2)}) - adjusting away from actual`;
  }

  return {
    newTarget: Math.round(newTarget * 100) / 100,
    newConfidence: Math.round(newConfidence * 100) / 100,
    reason,
  };
}

export async function updateTargets(
  options: UpdateTargetsOptions = {}
): Promise<UpdateTargetsResult> {
  const {
    verbose = false,
    plan = false,
    callId,
    limit = 100,
    learningRate: optionLearningRate,
    minConfidence: optionMinConfidence,
  } = options;

  const result: UpdateTargetsResult = {
    rewardsProcessed: 0,
    targetsUpdated: 0,
    targetsCreated: 0,
    errors: [],
    updates: [],
  };

  // Load TARGET_LEARN spec config
  const specConfig = await loadTargetLearnConfig();

  // Override spec config with options if provided
  const config: TargetLearnConfig = {
    ...specConfig,
    learningRate: optionLearningRate ?? specConfig.learningRate,
    minConfidence: optionMinConfidence ?? specConfig.minConfidence,
  };

  if (verbose) {
    console.log("TARGET_LEARN spec config:", {
      tolerance: config.tolerance,
      learningRate: config.learningRate,
      minConfidence: config.minConfidence,
      maxConfidence: config.maxConfidence,
    });
  }

  // Find rewards that haven't had target updates applied
  const rewards = await prisma.rewardScore.findMany({
    where: {
      ...(callId ? { callId } : {}),
      targetUpdatesApplied: { equals: Prisma.DbNull },
      effectiveTargets: { not: Prisma.DbNull },
      parameterDiffs: { not: Prisma.DbNull },
    },
    take: limit,
    orderBy: { scoredAt: "desc" },
    include: {
      call: {
        include: {
          caller: {
            include: {
              callerIdentities: {
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (verbose) console.log(`Found ${rewards.length} rewards to process for target updates`);

  if (plan) {
    console.log("\n=== UPDATE TARGETS PLAN ===");
    console.log(`Rewards to process: ${rewards.length}`);
    console.log(`Learning rate: ${config.learningRate}`);
    console.log(`Min confidence: ${config.minConfidence}`);
    for (const r of rewards.slice(0, 5)) {
      console.log(`  - Call ${r.callId}: score=${r.overallScore}`);
    }
    return result;
  }

  // Process each reward
  for (const reward of rewards) {
    try {
      result.rewardsProcessed++;

      const callerIdentityId = reward.call.caller?.callerIdentities?.[0]?.id || null;
      const effectiveTargets = reward.effectiveTargets as Record<string, any>;
      const parameterDiffs = reward.parameterDiffs as Record<string, any>;

      if (!effectiveTargets || !parameterDiffs) {
        if (verbose) console.log(`Reward ${reward.id}: Missing targets or diffs, skipping`);
        continue;
      }

      const updates: TargetUpdate[] = [];

      // Process each parameter diff
      for (const [parameterId, diffData] of Object.entries(parameterDiffs)) {
        const targetData = effectiveTargets[parameterId];
        if (!targetData) continue;

        const { target, actual, withinTolerance } = diffData as ParameterDiff;
        const { confidence: targetConfidence, scope } = targetData as { confidence: number; scope: string };

        // Skip if confidence is too low (avoid over-adjusting)
        if (targetConfidence < config.minConfidence) {
          if (verbose) console.log(`  ${parameterId}: Confidence too low (${targetConfidence}), skipping`);
          continue;
        }

        // Compute adjustment using config
        const adjustment = computeAdjustment(
          target,
          actual,
          reward.overallScore,
          targetConfidence,
          config
        );

        // Only update if there's a meaningful change
        const targetChange = Math.abs(adjustment.newTarget - target);
        const confidenceChange = Math.abs(adjustment.newConfidence - targetConfidence);

        if (targetChange < 0.01 && confidenceChange < 0.01) {
          if (verbose) console.log(`  ${parameterId}: No significant change, skipping`);
          continue;
        }

        // Determine scope for new target (CALLER if we have one, otherwise keep original scope)
        const newScope = callerIdentityId ? BehaviorTargetScope.CALLER : (scope as BehaviorTargetScope);

        // Create new target (or update existing CALLER target)
        if (callerIdentityId && newScope === BehaviorTargetScope.CALLER) {
          // Check for existing CALLER target
          const existingTarget = await prisma.behaviorTarget.findFirst({
            where: {
              parameterId,
              callerIdentityId,
              scope: BehaviorTargetScope.CALLER,
              effectiveUntil: null,
            },
          });

          if (existingTarget) {
            // Supersede existing target
            await prisma.behaviorTarget.update({
              where: { id: existingTarget.id },
              data: { effectiveUntil: new Date() },
            });
            result.targetsUpdated++;
          }

          // Create new target
          await prisma.behaviorTarget.create({
            data: {
              parameterId,
              scope: BehaviorTargetScope.CALLER,
              callerIdentityId,
              targetValue: adjustment.newTarget,
              confidence: adjustment.newConfidence,
              source: BehaviorTargetSource.LEARNED,
              observationCount: 1,
              lastLearnedAt: new Date(),
              supersededById: existingTarget?.id,
            },
          });
          result.targetsCreated++;
        } else {
          // For SYSTEM/SEGMENT targets, we just record the update but don't modify
          // (Those should be updated through aggregate analysis, not individual calls)
          if (verbose) {
            console.log(`  ${parameterId}: Would update ${scope} target but skipping (only CALLER targets updated per-call)`);
          }
        }

        updates.push({
          parameterId,
          oldTarget: target,
          newTarget: adjustment.newTarget,
          oldConfidence: targetConfidence,
          newConfidence: adjustment.newConfidence,
          reason: adjustment.reason,
        });

        if (verbose) {
          console.log(`  ${parameterId}: ${target} → ${adjustment.newTarget} (${adjustment.reason})`);
        }
      }

      // Record updates in reward
      if (updates.length > 0) {
        await prisma.rewardScore.update({
          where: { id: reward.id },
          data: {
            targetUpdatesApplied: updates as unknown as Prisma.InputJsonValue,
          },
        });

        result.updates.push({
          callId: reward.callId,
          updateCount: updates.length,
          updates,
        });
      } else {
        // Mark as processed even if no updates
        await prisma.rewardScore.update({
          where: { id: reward.id },
          data: {
            targetUpdatesApplied: [] as unknown as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error: any) {
      const errorMsg = `Error updating targets for reward ${reward.id}: ${error.message}`;
      result.errors.push(errorMsg);
      if (verbose) console.error(errorMsg);
    }
  }

  if (verbose) {
    console.log(`\nUpdate Targets Complete:`);
    console.log(`  Rewards processed: ${result.rewardsProcessed}`);
    console.log(`  Targets updated: ${result.targetsUpdated}`);
    console.log(`  Targets created: ${result.targetsCreated}`);
    console.log(`  Errors: ${result.errors.length}`);
  }

  return result;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: UpdateTargetsOptions = {
    verbose: args.includes("--verbose") || args.includes("-v"),
    plan: args.includes("--plan"),
    limit: parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "100"),
    callId: args.find(a => a.startsWith("--call="))?.split("=")[1],
    learningRate: parseFloat(args.find(a => a.startsWith("--rate="))?.split("=")[1] || "0.1"),
  };

  updateTargets(options)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error("Fatal error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
