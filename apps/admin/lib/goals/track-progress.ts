/**
 * Goal Progress Tracking
 *
 * Updates goal progress based on call outcomes and curriculum completion.
 * Called after each call analysis to track progress toward goals.
 */

import { prisma } from "@/lib/prisma";
import { GoalStatus, Prisma } from "@prisma/client";
import {
  appendGoalProgressEntry,
  type GoalProgressMetricsShape,
} from "@/lib/goals/append-progress-entry";
import { PARAMS } from "@/lib/registry";
import { ContractRegistry } from "@/lib/contracts/registry";
import {
  getStrategy,
  loadGoalProgressSpec,
  resolveStrategyKey,
} from "./strategies";
import type { StrategyKey } from "./strategies/types";

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
    const contract = await ContractRegistry.getContract("SKILL_MEASURE_V1");
    const thresholds = (contract?.thresholds ?? null) as SkillTierMapping["thresholds"] | null;
    const tierBands = ((contract as any)?.tierBands ?? null) as SkillTierMapping["tierBands"] | null;
    if (thresholds && tierBands) return { thresholds, tierBands };
    // contract null (not seeded) → fall through to defaults below.
  } catch (err) {
    // Unexpected error reading the contract — log it; never silently swallow.
    console.warn("[skill-tier] SKILL_MEASURE_V1 contract read failed — using defaults:", err);
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

      // #1614 — append a per-call entry to progressMetrics so the
      // Attainment tab's goal evidence trail accumulates. Pre-fix the
      // writer only bumped `progress` (the scalar); progressMetrics
      // stayed frozen at extraction-time metadata (113 rows on hf-dev
      // sandbox) or NULL (1,000 rows), so the trail never advanced.
      // Idempotent on (goal, callId): pipeline retry against the same
      // call replays in place, never double-counts mentionCount or
      // duplicates evidence.
      const nextProgressMetrics = appendGoalProgressEntry(
        goal.progressMetrics as GoalProgressMetricsShape | null,
        {
          callId,
          at: new Date().toISOString(),
          evidence: progressUpdate.evidence,
          // strategyKey carries the resolved StrategyKey union here — the
          // `??` left-hand `goal.progressStrategy` is `string | null` from
          // Prisma but the resolver branch returns a canonical
          // StrategyKey. The cast is safe because the dispatch at
          // `getStrategy(strategyKey)` would have thrown above on an
          // invalid string before we reach this write site.
          sourceStrategy: strategyKey as StrategyKey,
        },
      );

      await prisma.goal.update({
        where: { id: goal.id },
        data: {
          progress: newProgress,
          progressMetrics: nextProgressMetrics as Prisma.InputJsonValue,
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
 * Resolve `goal.ref` to one or more `(moduleId, moduleSlug, actualLoRef)`
 * triples scoped to the goal's playbook. Three ref shapes are supported:
 *
 *   1. `<moduleSlug>::LO<n>`   — n is 1-based position within the module's
 *      LO list ordered by sortOrder. Written by
 *      `scripts/fix-cio-cto-playbooks.ts:232` and the CIO/CTO seed pass.
 *   2. `<moduleSlug>::<loRef>` — explicit LO ref (e.g. `STD-04-01`).
 *      Written by future projectors that want to scope a ref to one module.
 *   3. `<loRef>`               — bare LO ref. Original `#414 Phase 5b`
 *      behaviour — resolves across every module in the playbook that
 *      contains an LO with this ref.
 *
 * The resolver returns `moduleSlug` + `actualLoRef` separately because the
 * canonical mastery storage key in `CallerAttribute`
 * (`curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`) needs both,
 * keyed by canonical LO ref (e.g. `STD-04-01`), never by the compound or
 * positional form.
 *
 * #1205 — playbookId scoping is via `PlaybookCurriculum` primary join.
 */
async function resolveLearningObjective(
  playbookId: string,
  ref: string,
): Promise<Array<{ moduleId: string; moduleSlug: string; actualLoRef: string }>> {
  const compoundMatch = ref.match(/^(.+?)::(.+)$/);
  if (compoundMatch) {
    const moduleSlug = compoundMatch[1];
    const loToken = compoundMatch[2];
    const moduleRow = await prisma.curriculumModule.findFirst({
      where: {
        slug: moduleSlug,
        curriculum: {
          playbookLinks: { some: { playbookId, role: "primary" } },
        },
      },
      select: {
        id: true,
        slug: true,
        learningObjectives: {
          select: { ref: true, sortOrder: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!moduleRow) return [];

    const positionMatch = loToken.match(/^LO(\d+)$/i);
    if (positionMatch) {
      const index = parseInt(positionMatch[1], 10) - 1;
      const lo = moduleRow.learningObjectives[index];
      return lo
        ? [{ moduleId: moduleRow.id, moduleSlug: moduleRow.slug, actualLoRef: lo.ref }]
        : [];
    }

    const lo = moduleRow.learningObjectives.find((l) => l.ref === loToken);
    return lo
      ? [{ moduleId: moduleRow.id, moduleSlug: moduleRow.slug, actualLoRef: lo.ref }]
      : [];
  }

  const los = await prisma.learningObjective.findMany({
    where: {
      ref,
      module: {
        curriculum: {
          playbookLinks: { some: { playbookId, role: "primary" } },
        },
      },
    },
    select: { moduleId: true, module: { select: { slug: true } } },
  });
  return los.map((l) => ({
    moduleId: l.moduleId,
    moduleSlug: l.module.slug,
    actualLoRef: ref,
  }));
}

/**
 * #414 Phase 5b — derive a LEARN goal's progress from the specific LO it
 * tracks (`goal.ref`). Mean of `CallerAttribute.numberValue` for keys
 * matching `:lo_mastery:<moduleSlug>:<actualLoRef>` across every module the
 * ref resolves to. Modules where the caller has no `lo_mastery:*` row for
 * the resolved `actualLoRef` are skipped from the mean (partial coverage
 * doesn't drag a goal toward zero).
 *
 * **Read source: `CallerAttribute lo_mastery:*` (canonical educator
 * dashboard value).** The earlier implementation read from
 * `CallerModuleProgress.loScoresJson` which holds an arithmetic-mean
 * running average — divergent from the `Math.max(existing, score)`
 * monotonic ratchet at the canonical write site
 * (`lib/curriculum/track-progress.ts:343`). Goal.progress was lagging the
 * dashboard by ~6× as a result (live audit 2026-06-13: Cyrus STD-04-01 at
 * 0.70 dashboard / 0.11 loScoresJson). This read switch closes the gap.
 *
 * See `resolveLearningObjective` for the three ref shapes supported.
 *
 * Returns null when:
 *   - the ref resolves to zero LOs in the playbook's curricula, or
 *   - no `lo_mastery:*` CallerAttribute row exists for any resolved
 *     `(moduleSlug, actualLoRef)` pair.
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

  const resolved = await resolveLearningObjective(goal.playbookId, goal.ref);
  if (resolved.length === 0) return null;

  // Build the canonical key suffix per resolved (moduleSlug, loRef) pair.
  // The full key shape is `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`
  // — the suffix is fully discriminating (specSlug varies by curriculum
  // sourceSpec but the lo_mastery body is unique). We match on suffix to
  // avoid having to resolve specSlug at read time.
  const suffixes = resolved.map((r) => `:lo_mastery:${r.moduleSlug}:${r.actualLoRef}`);

  const rows = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: "CURRICULUM",
      valueType: "NUMBER",
      validUntil: null,
      OR: suffixes.map((s) => ({ key: { endsWith: s } })),
    },
    select: { key: true, numberValue: true },
  });

  const masteries: number[] = [];
  for (const row of rows) {
    if (row.numberValue == null) continue;
    masteries.push(row.numberValue);
  }
  if (masteries.length === 0) return null;

  const progress = masteries.reduce((s, v) => s + v, 0) / masteries.length;
  return {
    progress,
    totalModulesWithRef: resolved.length,
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
