/**
 * compute-reward.ts
 *
 * Reward Computation
 *
 * Compares BehaviorMeasurements (what agent did) against BehaviorTargets (what we wanted).
 * Combines with outcome signals to compute a reward score.
 * Stores results in RewardScore table.
 *
 * Flow:
 * 1. For each call with BehaviorMeasurements but no RewardScore:
 *    a. Load effective targets (merged SYSTEM → SEGMENT → CALLER)
 *    b. Load behavior measurements
 *    c. Compute parameter diffs (target vs actual)
 *    d. Load/estimate outcome signals
 *    e. Compute overall reward score
 *    f. Store in RewardScore
 *
 * This is the second step in the post-call reward loop.
 */

import { PrismaClient, BehaviorTargetScope } from "@prisma/client";
import type { SpecConfig, OutcomeSignal, PlaybookConfig } from "@/lib/types/json-fields";
import {
  resolveScoringConfig,
  readLearningProfileMastery,
  readSupervisionProfileMastery,
  type CallerAttributeLike,
} from "@/lib/prompt/composition/scoring-config";

const prisma = new PrismaClient();

// Config loaded from REWARD spec (with defaults)
export interface RewardConfig {
  defaultTargetValue: number;
  tolerance: number;
  outcomeWeights: {
    resolved: number;
    notResolved: number;
    escalated: number;
    notEscalated: number;
  };
  behaviorWeight: number;
  outcomeWeight: number;
  resolutionMarkers: string[];
  escalationMarkers: string[];
  positiveWords: string[];
  negativeWords: string[];
}

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  defaultTargetValue: 0.5,
  tolerance: 0.15,
  outcomeWeights: {
    resolved: 0.5,
    notResolved: -0.3,
    escalated: -0.5,
    notEscalated: 0.2,
  },
  behaviorWeight: 0.4,
  outcomeWeight: 0.6,
  resolutionMarkers: ["thank you", "solved", "resolved", "that helps", "perfect", "great"],
  escalationMarkers: ["supervisor", "manager", "escalate", "complaint"],
  positiveWords: ["thank", "great", "perfect", "happy", "excellent", "wonderful"],
  negativeWords: ["frustrated", "angry", "annoyed", "disappointed", "terrible"],
};

/**
 * Load REWARD spec config from database
 */
async function loadRewardConfig(): Promise<RewardConfig> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      outputType: "REWARD",
      isActive: true,
      scope: "SYSTEM",
    },
  });

  if (!spec?.config) {
    return DEFAULT_REWARD_CONFIG;
  }

  const specConfig = spec.config as SpecConfig;
  return {
    defaultTargetValue: specConfig.defaultTargetValue ?? DEFAULT_REWARD_CONFIG.defaultTargetValue,
    tolerance: specConfig.tolerance ?? DEFAULT_REWARD_CONFIG.tolerance,
    outcomeWeights: {
      resolved: specConfig.outcomeWeights?.resolved ?? DEFAULT_REWARD_CONFIG.outcomeWeights.resolved,
      notResolved: specConfig.outcomeWeights?.notResolved ?? DEFAULT_REWARD_CONFIG.outcomeWeights.notResolved,
      escalated: specConfig.outcomeWeights?.escalated ?? DEFAULT_REWARD_CONFIG.outcomeWeights.escalated,
      notEscalated: specConfig.outcomeWeights?.notEscalated ?? DEFAULT_REWARD_CONFIG.outcomeWeights.notEscalated,
    },
    behaviorWeight: specConfig.behaviorWeight ?? DEFAULT_REWARD_CONFIG.behaviorWeight,
    outcomeWeight: specConfig.outcomeWeight ?? DEFAULT_REWARD_CONFIG.outcomeWeight,
    resolutionMarkers: specConfig.resolutionMarkers ?? DEFAULT_REWARD_CONFIG.resolutionMarkers,
    escalationMarkers: specConfig.escalationMarkers ?? DEFAULT_REWARD_CONFIG.escalationMarkers,
    positiveWords: specConfig.positiveWords ?? DEFAULT_REWARD_CONFIG.positiveWords,
    negativeWords: specConfig.negativeWords ?? DEFAULT_REWARD_CONFIG.negativeWords,
  };
}

interface ComputeRewardOptions {
  verbose?: boolean;
  plan?: boolean;
  callId?: string;          // Compute for specific call
  limit?: number;           // Max calls to process
}

interface EffectiveTarget {
  parameterId: string;
  targetValue: number;
  confidence: number;
  scope: BehaviorTargetScope;
  source: string;
}

export interface ParameterDiff {
  parameterId: string;
  target: number;
  actual: number;
  diff: number;
  withinTolerance: boolean;
}

export interface OutcomeSignals {
  resolved?: boolean;
  sentimentDelta?: number;
  duration?: number;
  csat?: number;
  escalated?: boolean;
}

interface ComputeRewardResult {
  callsProcessed: number;
  rewardsCreated: number;
  errors: string[];
  rewards: Array<{
    callId: string;
    overallScore: number;
    diffCount: number;
    avgDiff: number;
  }>;
}

/**
 * Load effective targets for a caller identity, merging SYSTEM → SEGMENT → CALLER
 */
/**
 * Load effective targets for a call by composing SYSTEM → SEGMENT → CALLER
 * scopes, with later layers overriding earlier ones per parameter.
 *
 * #836 fanout contract — `BehaviorTarget.callerIdentityId` references
 * `CallerIdentity.id`, NOT `Caller.id`. A caller may have multiple identities
 * (one per channel) and BehaviorTarget overrides may sit on any of them. We
 * fan out via the full `callerIdentityIds[]` list, collect all matching rows,
 * and resolve cross-identity conflicts by picking **MAX targetValue** per
 * parameter — same tie-break as `lib/tolerance/resolve-tolerance.ts` so reads
 * are consistent across both call paths. Pre-fix this used `identities?.[0]?.id`
 * and silently ignored overrides written to any non-first identity.
 *
 * Segment fanout uses the same shape — every identity's `segmentId` is
 * considered, deduplicated, and queried with `segmentId: { in: ... }`.
 */
async function loadEffectiveTargets(
  callerIdentityIds: string[],
  segmentIds: string[]
): Promise<Map<string, EffectiveTarget>> {
  const targets = new Map<string, EffectiveTarget>();

  // Load SYSTEM targets (base)
  const systemTargets = await prisma.behaviorTarget.findMany({
    where: {
      scope: BehaviorTargetScope.SYSTEM,
      effectiveUntil: null, // Currently active
    },
  });

  for (const t of systemTargets) {
    targets.set(t.parameterId, {
      parameterId: t.parameterId,
      targetValue: t.targetValue,
      confidence: t.confidence,
      scope: t.scope,
      source: t.source,
    });
  }

  // Load SEGMENT targets (override system) — fan out across all segments the
  // caller's identities belong to. MAX per parameter.
  if (segmentIds.length > 0) {
    const segmentTargets = await prisma.behaviorTarget.findMany({
      where: {
        scope: BehaviorTargetScope.SEGMENT,
        segmentId: { in: segmentIds },
        effectiveUntil: null,
      },
    });

    for (const t of segmentTargets) {
      const existing = targets.get(t.parameterId);
      if (
        !existing ||
        existing.scope !== BehaviorTargetScope.SEGMENT ||
        t.targetValue > existing.targetValue
      ) {
        targets.set(t.parameterId, {
          parameterId: t.parameterId,
          targetValue: t.targetValue,
          confidence: t.confidence,
          scope: t.scope,
          source: t.source,
        });
      }
    }
  }

  // Load CALLER targets (override segment/system) — fan out across all caller
  // identities. MAX per parameter so a higher per-identity override can't be
  // silently undercut by a stale lower value on a different identity.
  if (callerIdentityIds.length > 0) {
    const callerTargets = await prisma.behaviorTarget.findMany({
      where: {
        scope: BehaviorTargetScope.CALLER,
        callerIdentityId: { in: callerIdentityIds },
        effectiveUntil: null,
      },
    });

    for (const t of callerTargets) {
      const existing = targets.get(t.parameterId);
      if (
        !existing ||
        existing.scope !== BehaviorTargetScope.CALLER ||
        t.targetValue > existing.targetValue
      ) {
        targets.set(t.parameterId, {
          parameterId: t.parameterId,
          targetValue: t.targetValue,
          confidence: t.confidence,
          scope: t.scope,
          source: t.source,
        });
      }
    }
  }

  return targets;
}

/**
 * Estimate outcome signals from available data
 * In production, these would come from various sources
 */
function estimateOutcomeSignals(
  transcript: string,
  config: RewardConfig,
  callDuration?: number
): OutcomeSignals {
  // Simple heuristics for mock/demo purposes
  const signals: OutcomeSignals = {};

  // Check for resolution markers (from config)
  const resolutionPattern = new RegExp(config.resolutionMarkers.join("|"), "gi");
  signals.resolved = resolutionPattern.test(transcript);

  // Estimate sentiment delta (end vs start)
  // Simplified: check for positive words at end of transcript
  const lastThird = transcript.slice(-transcript.length / 3);
  const positivePattern = new RegExp(config.positiveWords.join("|"), "gi");
  const negativePattern = new RegExp(config.negativeWords.join("|"), "gi");
  const positiveCount = (lastThird.match(positivePattern) || []).length;
  const negativeCount = (lastThird.match(negativePattern) || []).length;
  signals.sentimentDelta = (positiveCount - negativeCount) / 10;

  // Duration (would come from call metadata)
  signals.duration = callDuration || transcript.length / 50; // Rough estimate

  // Escalation check (from config)
  const escalationPattern = new RegExp(config.escalationMarkers.join("|"), "gi");
  signals.escalated = escalationPattern.test(transcript);

  return signals;
}

/**
 * Compute overall reward from diffs and outcome signals.
 *
 * #2052 sub-epic C — when `strategy` is provided AND not `"blended"`, the
 * weighting changes:
 *
 *   - `"learner_mastery"` — weight the behaviour score by the learner's
 *     aggregated mastery rollup (`behavior_profile:learning:*` from
 *     BEH-AGG-001). When the rollup is available, behavior weight scales
 *     to (0.4 + 0.6 × masteryRollup) so high-mastery learners contribute
 *     more behaviour signal to the overall score.
 *   - `"educator_drift"` — outcome signals are dropped entirely; reward
 *     is the pure behaviour alignment with operator targets.
 *   - `"blended"` (or undefined) — the original behavior + outcome weighting.
 */
export function computeOverallReward(
  diffs: ParameterDiff[],
  outcomes: OutcomeSignals,
  targetConfidences: Map<string, number>,
  config: RewardConfig,
  strategy: "learner_mastery" | "educator_drift" | "blended" | undefined,
  learnerMasteryRollup: number | null,
): number {
  if (diffs.length === 0) return 0;

  // 1. Behavior alignment score (-1 to +1)
  // Weight by target confidence (more confident targets matter more)
  let totalWeight = 0;
  let weightedDiffSum = 0;

  for (const diff of diffs) {
    const confidence = targetConfidences.get(diff.parameterId) || config.defaultTargetValue;
    const weight = confidence;
    // Convert diff to score: 0 diff = 1, larger diff = lower score
    const diffScore = Math.max(-1, 1 - Math.abs(diff.diff) * 2);
    weightedDiffSum += diffScore * weight;
    totalWeight += weight;
  }

  const behaviorScore = totalWeight > 0 ? weightedDiffSum / totalWeight : 0;

  // 2. Outcome score (-1 to +1) - using weights from config
  let outcomeScore = 0;
  let outcomeFactors = 0;

  if (outcomes.resolved !== undefined) {
    outcomeScore += outcomes.resolved
      ? config.outcomeWeights.resolved
      : config.outcomeWeights.notResolved;
    outcomeFactors++;
  }

  if (outcomes.sentimentDelta !== undefined) {
    outcomeScore += Math.max(-0.5, Math.min(0.5, outcomes.sentimentDelta));
    outcomeFactors++;
  }

  if (outcomes.escalated !== undefined) {
    outcomeScore += outcomes.escalated
      ? config.outcomeWeights.escalated
      : config.outcomeWeights.notEscalated;
    outcomeFactors++;
  }

  const normalizedOutcome = outcomeFactors > 0 ? outcomeScore / outcomeFactors : 0;

  // 3. Combined score — strategy-dependent.
  let overallScore: number;
  if (strategy === "educator_drift") {
    // Pure behaviour — operator targets are the truth.
    overallScore = behaviorScore;
  } else if (strategy === "learner_mastery" && learnerMasteryRollup !== null) {
    // Scale behaviour weight by mastery: high-mastery learners contribute
    // more behaviour signal. Range [0.4, 1.0] for behaviour weight.
    const behW = 0.4 + 0.6 * learnerMasteryRollup;
    const outW = 1 - behW;
    overallScore = behaviorScore * behW + normalizedOutcome * outW;
  } else {
    // Default blended (and the safe fallback when learner_mastery is
    // requested but no rollup is available yet).
    overallScore = behaviorScore * config.behaviorWeight + normalizedOutcome * config.outcomeWeight;
  }

  return Math.max(-1, Math.min(1, Math.round(overallScore * 100) / 100));
}

export async function computeReward(
  options: ComputeRewardOptions = {}
): Promise<ComputeRewardResult> {
  const {
    verbose = false,
    plan = false,
    callId,
    limit = 100,
  } = options;

  const result: ComputeRewardResult = {
    callsProcessed: 0,
    rewardsCreated: 0,
    errors: [],
    rewards: [],
  };

  // Load REWARD spec config
  const config = await loadRewardConfig();
  if (verbose) {
    console.log("REWARD spec config:", {
      tolerance: config.tolerance,
      behaviorWeight: config.behaviorWeight,
      outcomeWeight: config.outcomeWeight,
    });
  }

  // Find calls with behavior measurements but no reward score
  const calls = await prisma.call.findMany({
    where: {
      ...(callId ? { id: callId } : {}),
      behaviorMeasurements: {
        some: {},
      },
      rewardScore: null,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      behaviorMeasurements: true,
      caller: {
        include: {
          // #836 fanout — load ALL identities so loadEffectiveTargets can
          // resolve per-identity CALLER + SEGMENT targets and MAX over them.
          // Pre-fix this had `take: 1`, which silently dropped overrides on
          // any non-first identity.
          callerIdentities: {
            include: {
              segment: true,
            },
          },
        },
      },
    },
  });

  if (verbose) console.log(`Found ${calls.length} calls to compute rewards for`);

  if (plan) {
    console.log("\n=== COMPUTE REWARD PLAN ===");
    console.log(`Calls to process: ${calls.length}`);
    for (const call of calls.slice(0, 5)) {
      console.log(`  - ${call.id}: ${call.behaviorMeasurements.length} measurements`);
    }
    if (calls.length > 5) console.log(`  ... and ${calls.length - 5} more`);
    return result;
  }

  // Process each call
  for (const call of calls) {
    try {
      result.callsProcessed++;

      // #836 fanout — collect every CallerIdentity.id + unique segmentId
      // attached to this caller. `loadEffectiveTargets` does the fanout query
      // and the MAX-per-parameter tie-break across identities.
      const identities = call.caller?.callerIdentities ?? [];
      const callerIdentityIds = identities.map((i) => i.id);
      const segmentIds = Array.from(
        new Set(identities.map((i) => i.segmentId).filter((s): s is string => !!s)),
      );

      // Load effective targets
      const targets = await loadEffectiveTargets(callerIdentityIds, segmentIds);

      if (targets.size === 0) {
        if (verbose) console.log(`Call ${call.id}: No targets found, using defaults`);
        // Load system defaults anyway
      }

      // Build measurements map
      const measurements = new Map<string, { actualValue: number; confidence: number }>();
      for (const m of call.behaviorMeasurements) {
        measurements.set(m.parameterId, {
          actualValue: m.actualValue,
          confidence: m.confidence,
        });
      }

      // Compute parameter diffs
      const diffs: ParameterDiff[] = [];
      const targetConfidences = new Map<string, number>();

      for (const [parameterId, target] of targets) {
        const measurement = measurements.get(parameterId);
        if (measurement) {
          const diff = measurement.actualValue - target.targetValue;
          diffs.push({
            parameterId,
            target: target.targetValue,
            actual: measurement.actualValue,
            diff,
            withinTolerance: Math.abs(diff) <= config.tolerance,
          });
          targetConfidences.set(parameterId, target.confidence);
        }
      }

      // Estimate outcome signals (using config for markers)
      const outcomes = estimateOutcomeSignals(call.transcript, config);

      // #2052 sub-epic C — read the operator's rewardStrategy override
      // from the Playbook attached to the call (when available). Falls
      // back to "blended" (current behaviour) when:
      //   - The call has no playbookId (legacy / harness rows)
      //   - The Playbook config doesn't set rewardStrategy
      //
      // For "learner_mastery" we also read the aggregated
      // `behavior_profile:learning:*` rollup from CallerAttribute rows
      // produced by BEH-AGG-001.
      let strategy: "learner_mastery" | "educator_drift" | "blended" | undefined;
      let learnerMasteryRollup: number | null = null;
      if (call.playbookId) {
        const pb = await prisma.playbook.findUnique({
          where: { id: call.playbookId },
          select: { config: true },
        });
        const scoring = resolveScoringConfig((pb?.config ?? null) as PlaybookConfig | null);
        strategy = scoring.rewardStrategy;
        if (strategy === "learner_mastery" && call.callerId) {
          const attrs = await prisma.callerAttribute.findMany({
            where: {
              callerId: call.callerId,
              key: { startsWith: "behavior_profile:learning:" },
            },
            select: { key: true, numberValue: true },
          });
          learnerMasteryRollup = readLearningProfileMastery(
            attrs as CallerAttributeLike[],
          );
          if (verbose) {
            console.log(
              `[reward] #2052 rewardStrategy=learner_mastery, learningRollup=${learnerMasteryRollup} (${attrs.length} aggregate rows)`,
            );
          }
        } else if (strategy === "educator_drift" && verbose) {
          // Supervision rollup is read so the diagnostic log carries a
          // verifiable signal that the strategy switch took effect.
          const supAttrs = await prisma.callerAttribute.findMany({
            where: {
              callerId: call.callerId ?? "__none__",
              key: { startsWith: "behavior_profile:supervision:" },
            },
            select: { key: true, numberValue: true },
          });
          const supRollup = readSupervisionProfileMastery(
            supAttrs as CallerAttributeLike[],
          );
          console.log(
            `[reward] #2052 rewardStrategy=educator_drift (supervisionRollup=${supRollup} for diagnostics; outcome signals dropped from blend)`,
          );
        }
      }

      // Compute overall reward (using config for weights + strategy override)
      const overallScore = computeOverallReward(
        diffs,
        outcomes,
        targetConfidences,
        config,
        strategy,
        learnerMasteryRollup,
      );

      // Build JSON snapshots
      const effectiveTargetsJson: Record<string, any> = {};
      for (const [pid, t] of targets) {
        effectiveTargetsJson[pid] = {
          targetValue: t.targetValue,
          scope: t.scope,
          source: t.source,
        };
      }

      const actualBehaviorJson: Record<string, any> = {};
      for (const [pid, m] of measurements) {
        actualBehaviorJson[pid] = {
          actualValue: m.actualValue,
          confidence: m.confidence,
        };
      }

      const parameterDiffsJson: Record<string, any> = {};
      for (const d of diffs) {
        parameterDiffsJson[d.parameterId] = {
          target: d.target,
          actual: d.actual,
          diff: d.diff,
          withinTolerance: d.withinTolerance,
        };
      }

      // Store reward score
      await prisma.rewardScore.create({
        data: {
          callId: call.id,
          overallScore,
          modelVersion: "reward_v1",
          scoredBy: "compute_reward_op",

          // Outcome signals
          taskCompleted: outcomes.resolved,
          escalated: outcomes.escalated,

          // Behavior target comparison
          effectiveTargets: effectiveTargetsJson,
          actualBehavior: actualBehaviorJson,
          parameterDiffs: parameterDiffsJson,
          outcomeSignals: outcomes as Record<string, any>,
        },
      });

      result.rewardsCreated++;
      result.rewards.push({
        callId: call.id,
        overallScore,
        diffCount: diffs.length,
        avgDiff: diffs.length > 0
          ? Math.round(diffs.reduce((s, d) => s + Math.abs(d.diff), 0) / diffs.length * 100) / 100
          : 0,
      });

      if (verbose) {
        console.log(`Call ${call.id}: reward=${overallScore.toFixed(2)}, diffs=${diffs.length}, resolved=${outcomes.resolved}`);
      }
    } catch (error: any) {
      const errorMsg = `Error computing reward for call ${call.id}: ${error.message}`;
      result.errors.push(errorMsg);
      if (verbose) console.error(errorMsg);
    }
  }

  if (verbose) {
    console.log(`\nCompute Reward Complete:`);
    console.log(`  Calls processed: ${result.callsProcessed}`);
    console.log(`  Rewards created: ${result.rewardsCreated}`);
    console.log(`  Errors: ${result.errors.length}`);
  }

  return result;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: ComputeRewardOptions = {
    verbose: args.includes("--verbose") || args.includes("-v"),
    plan: args.includes("--plan"),
    limit: parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "100"),
    callId: args.find(a => a.startsWith("--call="))?.split("=")[1],
  };

  computeReward(options)
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
