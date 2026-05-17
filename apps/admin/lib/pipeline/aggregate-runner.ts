/**
 * aggregate-runner.ts
 *
 * Runs AGGREGATE specs to compute derived attributes from measurements
 * Contract-based: reads aggregationRules from spec config, NO hardcoding
 *
 * Responsibilities:
 * - Find active AGGREGATE specs
 * - Read recent CallScores for source parameters
 * - Apply aggregation rules (thresholds, weighted average)
 * - Update CallerAttribute using contract-based helpers
 *
 * Example: LEARN-PROF-001 aggregates learning behavior scores into learner profile
 */

import { prisma } from "@/lib/prisma";
import { updateLearnerProfile } from "@/lib/learner/profile";
import { ContractRegistry } from "@/lib/contracts/registry";
import type { SpecConfig } from "@/lib/types/json-fields";

// ── #417 Phase C — per-skill EMA accumulation ──────────────────────────────

/**
 * Default contract values used when SKILL_MEASURE_V1 isn't seeded yet.
 * Phase D seeds the contract; this fallback keeps Phase C self-contained
 * for tests.
 */
const SKILL_DEFAULTS = {
  emaHalfLifeDays: 14,
  minCallsToFull: 4,
};

/**
 * #417 Phase 0 cap — mirrors `capMasteryByCallCount` in
 * `lib/curriculum/track-progress.ts:212`. Prevents a single-call 1.0
 * score from inflating CallerTarget.currentScore to Secure on call #1.
 * Pure function — exported for unit tests.
 */
export function capSkillScoreByCallCount(
  rawScore: number,
  callsUsedAfterThisCall: number,
  minCallsToFull: number = SKILL_DEFAULTS.minCallsToFull,
): number {
  const cap = Math.min(1.0, callsUsedAfterThisCall / minCallsToFull);
  return Math.min(Math.max(0, rawScore), cap);
}

/**
 * #417 EMA blend with time-decay half-life. Pure function.
 *
 * α = 1 - exp(-ln(2) · daysSinceLastScore / halfLifeDays)
 * currentScore = α · newScore + (1 - α) · priorScore
 *
 * On first call (priorScore is null / lastScoredAt is null) returns
 * newScore verbatim — there's nothing to blend with.
 */
export function emaSkillScore(
  newScore: number,
  priorScore: number | null,
  lastScoredAt: Date | null,
  now: Date,
  halfLifeDays: number = SKILL_DEFAULTS.emaHalfLifeDays,
): number {
  if (priorScore === null || lastScoredAt === null) {
    return Math.max(0, Math.min(1, newScore));
  }
  const days = Math.max(
    0,
    (now.getTime() - lastScoredAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  const alpha = 1 - Math.exp((-Math.LN2 * days) / halfLifeDays);
  const blended = alpha * newScore + (1 - alpha) * priorScore;
  return Math.max(0, Math.min(1, blended));
}

/**
 * #417 Phase C — accumulate `skill_*` CallScores into
 * `CallerTarget.currentScore` (EMA-decayed running per-skill score).
 *
 * Idempotency guard: each parameter's CallScores after `lastScoredAt` are
 * applied in chronological order; CallScores already reflected are
 * skipped. Re-running the pipeline with `force=true` (per #405) does not
 * double-apply scores.
 *
 * Half-life is read from the SKILL_MEASURE_V1 contract; falls back to
 * the 14-day default when the contract isn't seeded.
 *
 * Per-playbook override:
 *   `playbook.config.skillScoringEmaHalfLifeDays`
 * (when the caller has a single active enrolment; otherwise contract).
 */
export async function accumulateSkillScores(callerId: string): Promise<{
  paramsProcessed: number;
  callerTargetsUpdated: number;
  scoresApplied: number;
}> {
  const result = { paramsProcessed: 0, callerTargetsUpdated: 0, scoresApplied: 0 };

  // Pull every CallScore on skill_* parameters for this caller, oldest-first.
  // Each is an independent observation to fold into the EMA.
  const callScores = await prisma.callScore.findMany({
    where: {
      callerId,
      parameterId: { startsWith: "skill_" },
    },
    select: {
      id: true,
      parameterId: true,
      score: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (callScores.length === 0) return result;

  // Group by parameterId
  const byParam = new Map<string, typeof callScores>();
  for (const cs of callScores) {
    const arr = byParam.get(cs.parameterId) ?? [];
    arr.push(cs);
    byParam.set(cs.parameterId, arr);
  }

  // Resolve half-life: per-playbook override → contract → fallback
  let halfLifeDays = SKILL_DEFAULTS.emaHalfLifeDays;
  let minCallsToFull = SKILL_DEFAULTS.minCallsToFull;
  try {
    const contract = await ContractRegistry.get("SKILL_MEASURE_V1");
    const cfg = (contract?.config ?? {}) as Record<string, unknown>;
    if (typeof cfg.emaHalfLifeDays === "number") halfLifeDays = cfg.emaHalfLifeDays;
    if (typeof cfg.minCallsToFull === "number") minCallsToFull = cfg.minCallsToFull;
  } catch {
    // Contract not seeded yet — defaults are fine.
  }
  const playbookOverride = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    select: { playbook: { select: { config: true } } },
  });
  const pbCfg = (playbookOverride?.playbook?.config ?? {}) as Record<string, unknown>;
  if (typeof pbCfg.skillScoringEmaHalfLifeDays === "number") {
    halfLifeDays = pbCfg.skillScoringEmaHalfLifeDays as number;
  }

  const now = new Date();

  for (const [parameterId, scoresForParam] of byParam) {
    result.paramsProcessed += 1;

    const existing = await prisma.callerTarget.findUnique({
      where: { callerId_parameterId: { callerId, parameterId } },
      select: {
        currentScore: true,
        lastScoredAt: true,
        callsUsed: true,
        targetValue: true,
      },
    });

    // Apply CallScores strictly newer than the high-water mark.
    const watermark = existing?.lastScoredAt ?? null;
    const fresh = watermark
      ? scoresForParam.filter((s) => s.createdAt > watermark)
      : scoresForParam;
    if (fresh.length === 0) continue;

    let runningScore = existing?.currentScore ?? null;
    let runningLast = existing?.lastScoredAt ?? null;
    let callsUsed = existing?.callsUsed ?? 0;

    for (const cs of fresh) {
      callsUsed += 1;
      const capped = capSkillScoreByCallCount(cs.score, callsUsed, minCallsToFull);
      runningScore = emaSkillScore(capped, runningScore, runningLast, cs.createdAt, halfLifeDays);
      runningLast = cs.createdAt;
      result.scoresApplied += 1;
    }

    await prisma.callerTarget.upsert({
      where: { callerId_parameterId: { callerId, parameterId } },
      create: {
        callerId,
        parameterId,
        // Default to Secure-target 1.0 — overridden by any later BehaviorTarget
        // lookup if a different value is wanted.
        targetValue: 1.0,
        currentScore: runningScore,
        lastScoredAt: runningLast,
        callsUsed,
      },
      update: {
        currentScore: runningScore,
        lastScoredAt: runningLast,
        callsUsed,
      },
    });
    result.callerTargetsUpdated += 1;
  }

  // Update the now-mutable now timestamp (used only to suppress unused-var warning).
  void now;

  return result;
}

interface AggregationRule {
  sourceParameter: string;
  targetProfileKey: string;
  method: 'threshold_mapping' | 'weighted_average' | 'consensus';
  thresholds?: Array<{
    min?: number;
    max?: number;
    value: string;
    confidence?: number;
  }>;
  windowSize?: number;
  recencyWeight?: number;
}

interface AggregateConfig {
  aggregationRules: AggregationRule[];
  windowSize?: number;
  recencyWeight?: number;
  minimumObservations?: number;
}

/**
 * Run all active AGGREGATE specs for a caller
 */
export async function runAggregateSpecs(callerId: string): Promise<{
  specsRun: number;
  profileUpdates: number;
  errors: string[];
}> {
  const results = {
    specsRun: 0,
    profileUpdates: 0,
    errors: [] as string[],
  };

  // Find all active AGGREGATE specs
  const aggregateSpecs = await prisma.analysisSpec.findMany({
    where: {
      outputType: 'AGGREGATE',
      isActive: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      config: true,
    },
  });

  console.log(`[aggregate-runner] Found ${aggregateSpecs.length} AGGREGATE specs`);

  // #417 Phase C — per-skill EMA accumulation. Runs alongside AGGREGATE
  // specs because it folds MEASURE-stage CallScores into a derived
  // running value, same conceptual stage. Logged separately so reviewers
  // can see the cross-stage CallerTarget writes documented in
  // `docs/PIPELINE.md §4.2`.
  try {
    const skillResult = await accumulateSkillScores(callerId);
    if (skillResult.scoresApplied > 0) {
      console.log(
        `[aggregate-runner] skill EMA: ${skillResult.scoresApplied} score(s) across ` +
          `${skillResult.paramsProcessed} param(s); ${skillResult.callerTargetsUpdated} CallerTarget(s) updated`,
      );
    }
  } catch (err: any) {
    const msg = `Skill EMA failed: ${err?.message ?? String(err)}`;
    console.error(`[aggregate-runner] ${msg}`);
    results.errors.push(msg);
  }

  for (const spec of aggregateSpecs) {
    try {
      console.log(`[aggregate-runner] Running ${spec.slug}...`);

      const config = (spec.config as SpecConfig) || {};
      const parameters = (config.parameters as Array<{ config?: AggregateConfig }>) || [];

      // Find the aggregate parameter with config
      const aggregateParam = parameters.find((p) =>
        p.config?.aggregationRules && p.config.aggregationRules.length > 0
      );

      if (!aggregateParam) {
        console.warn(`[aggregate-runner] ${spec.slug} has no aggregationRules, skipping`);
        continue;
      }

      const aggregateConfig = aggregateParam.config as AggregateConfig;

      // Run aggregation
      await runAggregation(callerId, spec.slug, aggregateConfig);

      results.specsRun++;

    } catch (error: any) {
      const errorMsg = `Error running ${spec.slug}: ${error.message}`;
      console.error(`[aggregate-runner] ${errorMsg}`);
      results.errors.push(errorMsg);
    }
  }

  return results;
}

/**
 * Run aggregation for a specific spec
 */
async function runAggregation(
  callerId: string,
  specSlug: string,
  config: AggregateConfig
): Promise<void> {
  const {
    aggregationRules,
    windowSize = 5,
    minimumObservations = 3,
  } = config;

  console.log(`[aggregate-runner] Processing ${aggregationRules.length} rules for ${specSlug}`);

  // Collect all profile updates
  const profileUpdates: Record<string, any> = {};
  let overallConfidence = 0;
  let ruleCount = 0;

  for (const rule of aggregationRules) {
    try {
      const result = await applyAggregationRule(
        callerId,
        rule,
        windowSize,
        minimumObservations
      );

      if (result) {
        // Convert targetProfileKey to camelCase field name
        const fieldName = toCamelCase(rule.targetProfileKey);
        profileUpdates[fieldName] = result.value;
        overallConfidence += result.confidence;
        ruleCount++;

        console.log(
          `[aggregate-runner] ${rule.sourceParameter} → ${rule.targetProfileKey} = ${result.value} ` +
          `(confidence: ${result.confidence.toFixed(2)})`
        );
      }
    } catch (error: any) {
      console.error(`[aggregate-runner] Error in rule ${rule.sourceParameter}:`, error.message);
    }
  }

  // Update profile if we have any updates
  if (Object.keys(profileUpdates).length > 0) {
    const avgConfidence = overallConfidence / ruleCount;

    // Check if this is a learner profile update (by checking target keys)
    const isLearnerProfile = aggregationRules.some(r =>
      r.targetProfileKey.includes('learning_style') ||
      r.targetProfileKey.includes('pace_preference') ||
      r.targetProfileKey.includes('interaction_style')
    );

    if (isLearnerProfile) {
      await updateLearnerProfile(callerId, profileUpdates, avgConfidence);
      console.log(`[aggregate-runner] Updated learner profile with ${Object.keys(profileUpdates).length} fields`);
    } else {
      // Generic CallerAttribute upsert for non-learner profile types
      for (const [key, value] of Object.entries(profileUpdates)) {
        await prisma.callerAttribute.upsert({
          where: { callerId_key_scope: { callerId, key, scope: specSlug } },
          update: {
            stringValue: String(value),
            valueType: "STRING",
            confidence: avgConfidence,
            sourceSpecSlug: specSlug,
          },
          create: {
            callerId,
            key,
            scope: specSlug,
            valueType: "STRING",
            stringValue: String(value),
            confidence: avgConfidence,
            sourceSpecSlug: specSlug,
          },
        });
      }
      console.log(`[aggregate-runner] Wrote ${Object.keys(profileUpdates).length} CallerAttribute(s) for ${specSlug}`);
    }
  } else {
    console.log(`[aggregate-runner] No profile updates for ${specSlug} (insufficient data)`);
  }
}

/**
 * Apply a single aggregation rule
 */
async function applyAggregationRule(
  callerId: string,
  rule: AggregationRule,
  windowSize: number,
  minimumObservations: number
): Promise<{ value: string; confidence: number } | null> {
  // Get recent scores for the source parameter
  const scores = await prisma.callScore.findMany({
    where: {
      call: { callerId },
      parameterId: rule.sourceParameter,
    },
    orderBy: { scoredAt: 'desc' },
    take: windowSize,
    select: {
      score: true,
      confidence: true,
      scoredAt: true,
    },
  });

  if (scores.length < minimumObservations) {
    console.log(
      `[aggregate-runner] Insufficient observations for ${rule.sourceParameter}: ` +
      `${scores.length} < ${minimumObservations}`
    );
    return null;
  }

  // Apply aggregation method
  switch (rule.method) {
    case 'threshold_mapping':
      return applyThresholdMapping(scores, rule);

    case 'weighted_average':
      return applyWeightedAverage(scores, rule);

    case 'consensus':
      return applyConsensus(scores, rule);

    default:
      console.warn(`[aggregate-runner] Unknown aggregation method: ${rule.method}`);
      return null;
  }
}

/**
 * Apply threshold mapping: map average score to value based on thresholds
 */
function applyThresholdMapping(
  scores: Array<{ score: number; confidence: number; scoredAt: Date }>,
  rule: AggregationRule
): { value: string; confidence: number } | null {
  if (!rule.thresholds || rule.thresholds.length === 0) {
    return null;
  }

  // Compute weighted average score (recent scores weighted more)
  const totalWeight = scores.reduce((sum, _, i) => sum + (1 / (i + 1)), 0);
  const weightedScore = scores.reduce(
    (sum, s, i) => sum + (s.score * (1 / (i + 1))),
    0
  ) / totalWeight;

  // Find matching threshold
  for (const threshold of rule.thresholds) {
    const minMatch = threshold.min === undefined || weightedScore >= threshold.min;
    const maxMatch = threshold.max === undefined || weightedScore < threshold.max;

    if (minMatch && maxMatch) {
      // Compute confidence as average of score confidences
      const avgConfidence = scores.reduce((sum, s) => sum + s.confidence, 0) / scores.length;
      const thresholdConfidence = threshold.confidence || avgConfidence;

      return {
        value: threshold.value,
        confidence: Math.min(thresholdConfidence, avgConfidence),
      };
    }
  }

  console.warn(`[aggregate-runner] No threshold matched for score ${weightedScore.toFixed(2)}`);
  return null;
}

/**
 * Apply weighted average: compute weighted average and return as value
 */
function applyWeightedAverage(
  scores: Array<{ score: number; confidence: number; scoredAt: Date }>,
  rule: AggregationRule
): { value: string; confidence: number } {
  const totalWeight = scores.reduce((sum, _, i) => sum + (1 / (i + 1)), 0);
  const weightedScore = scores.reduce(
    (sum, s, i) => sum + (s.score * (1 / (i + 1))),
    0
  ) / totalWeight;

  const avgConfidence = scores.reduce((sum, s) => sum + s.confidence, 0) / scores.length;

  return {
    value: weightedScore.toFixed(2),
    confidence: avgConfidence,
  };
}

/**
 * Apply consensus: find most common value (for categorical scores)
 */
function applyConsensus(
  scores: Array<{ score: number; confidence: number; scoredAt: Date }>,
  rule: AggregationRule
): { value: string; confidence: number } | null {
  // Round scores to nearest 0.1 to group similar values
  const rounded = scores.map(s => Math.round(s.score * 10) / 10);

  // Count occurrences
  const counts = new Map<number, number>();
  for (const val of rounded) {
    counts.set(val, (counts.get(val) || 0) + 1);
  }

  // Find most common
  let maxCount = 0;
  let consensusValue = 0;
  for (const [val, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = val;
    }
  }

  // Confidence is proportion that agree
  const confidence = maxCount / scores.length;

  return {
    value: consensusValue.toString(),
    confidence,
  };
}

/**
 * Convert snake_case to camelCase
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
