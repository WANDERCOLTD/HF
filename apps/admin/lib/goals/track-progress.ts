/**
 * Goal Progress Tracking
 *
 * Updates goal progress based on call outcomes and curriculum completion.
 * Called after each call analysis to track progress toward goals.
 */

import { prisma } from "@/lib/prisma";
import { GoalType, GoalStatus } from "@prisma/client";
import { PARAMS } from "@/lib/registry";
import type { SpecConfig } from "@/lib/types/json-fields";
import { computeExamReadiness } from "@/lib/curriculum/exam-readiness";
import { ContractRegistry } from "@/lib/contracts/registry";

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
 * Track progress for all active goals after a call
 */
export async function trackGoalProgress(
  callerId: string,
  callId: string
): Promise<{ updated: number; completed: number }> {
  // Get active goals for this caller
  const goals = await prisma.goal.findMany({
    where: {
      callerId,
      status: { in: ['ACTIVE', 'PAUSED'] },
    },
    include: {
      contentSpec: true,
    },
  });

  if (goals.length === 0) {
    return { updated: 0, completed: 0 };
  }

  let updatedCount = 0;
  let completedCount = 0;

  // Track progress for each goal type
  for (const goal of goals) {
    const progressUpdate = await calculateProgressUpdate(goal, callerId, callId);

    if (progressUpdate && progressUpdate.progressDelta > 0) {
      const newProgress = Math.min(1.0, goal.progress + progressUpdate.progressDelta);

      // Assessment targets don't auto-complete — they need teacher confirmation (Story 4)
      const shouldAutoComplete = newProgress >= 1.0 && !goal.isAssessmentTarget;

      await prisma.goal.update({
        where: { id: goal.id },
        data: {
          progress: newProgress,
          updatedAt: new Date(),
          ...(shouldAutoComplete && {
            status: 'COMPLETED',
            completedAt: new Date(),
          }),
        },
      });

      updatedCount++;
      if (shouldAutoComplete) {
        completedCount++;
      }
    }
  }

  return { updated: updatedCount, completed: completedCount };
}

/**
 * Calculate progress update for a specific goal based on call outcomes.
 *
 * Routing precedence (most specific first):
 *   1. SKILL-based ACHIEVE → per-skill mastery (#417 P5b-ACHIEVE)
 *      Answers "where are you on this criterion".
 *   2. Assessment target with contentSpec → exam readiness (existing)
 *      Answers "ready for the exam" — different question, different path.
 *   3. Type-based dispatch (LEARN / CONNECT / engagement fallback)
 *
 * Skill-ACHIEVE is the FIRST branch because a goal with both
 * `ref="SKILL-NN"` AND `isAssessmentTarget=true` is asking "how good is
 * my Fluency & Coherence" — not "am I ready to take the exam".
 */
async function calculateProgressUpdate(
  goal: any,
  callerId: string,
  callId: string
): Promise<GoalProgressUpdate | null> {
  // 1. #417 — Skill-based ACHIEVE goals: per-skill mastery against the
  //    learner's running CallerTarget.currentScore.
  if (goal.type === "ACHIEVE" && typeof goal.ref === "string" && goal.ref.startsWith("SKILL-")) {
    return await calculateSkillAchieveProgress(goal, callerId);
  }

  // 2. Assessment targets with a contentSpec use exam readiness scoring
  if (goal.isAssessmentTarget && goal.contentSpec) {
    return await calculateAssessmentProgress(goal, callerId);
  }

  switch (goal.type as GoalType) {
    case 'LEARN':
      return await calculateLearnProgress(goal, callerId, callId);
    case 'CONNECT':
      return await calculateConnectProgress(goal, callerId, callId);
    case 'ACHIEVE':
    case 'CHANGE':
    case 'SUPPORT':
    case 'CREATE':
      // For other goal types, use a simple engagement-based heuristic
      return await calculateEngagementProgress(goal, callerId, callId);
    default:
      return null;
  }
}

/**
 * Calculate progress for assessment target goals using exam readiness.
 * Uses computeExamReadiness() instead of the 5%/call heuristic.
 */
async function calculateAssessmentProgress(
  goal: any,
  callerId: string,
): Promise<GoalProgressUpdate | null> {
  try {
    const readiness = await computeExamReadiness(callerId, goal.contentSpec.slug);
    const readinessScore = readiness.readinessScore;

    // Only update if readiness exceeds current progress
    if (readinessScore > goal.progress) {
      return {
        goalId: goal.id,
        progressDelta: readinessScore - goal.progress,
        evidence: `Exam readiness: ${(readinessScore * 100).toFixed(0)}% (${readiness.level})${readiness.weakModules.length > 0 ? ` | Weak: ${readiness.weakModules.join(", ")}` : ""}`,
      };
    }

    return null;
  } catch (error: any) {
    // Fallback to engagement heuristic if exam readiness fails (e.g., contract not seeded)
    console.warn(`[track-progress] computeExamReadiness failed for goal ${goal.id}, falling back to engagement heuristic:`, error.message);
    return {
      goalId: goal.id,
      progressDelta: 0.03, // Conservative fallback for assessment targets
      evidence: `Assessment target engagement (readiness computation unavailable)`,
    };
  }
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
 * Calculate progress for LEARN goals based on curriculum completion
 */
async function calculateLearnProgress(
  goal: any,
  callerId: string,
  callId: string
): Promise<GoalProgressUpdate | null> {
  // #414 P5b — per-goal LO derivation. When goal.ref is set (populated by
  // #413), the goal's progress IS the mastery of its specific LO. Read
  // `CallerModuleProgress.loScoresJson[ref].mastery` averaged across every
  // module that contains an LO with that ref.
  //
  // CRITICAL: if the goal is ref-linked we never fall through to the
  // engagement / session-embedded paths, even when no mastery has
  // accumulated yet. The engagement heuristic would assign every ref-linked
  // goal the same uniform value (averaged from COMP_/DISC_/COACH_ scores),
  // exactly the bug this story exists to fix. Absence of mastery means
  // progress stays at 0 — that is the correct answer.
  if (goal.ref && goal.playbookId) {
    const derived = await deriveLearnGoalProgressFromRef(callerId, {
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

  // Phase 2 path: spec-level avg of CallerModuleProgress.mastery.
  // Falls through to the legacy paths only when no curriculum is linked
  // to this goal's contentSpec.
  if (goal.contentSpec) {
    const derived = await deriveLearnGoalProgressFromMastery(callerId, goal.contentSpecId);
    if (derived) {
      if (derived.progress > goal.progress) {
        return {
          goalId: goal.id,
          progressDelta: derived.progress - goal.progress,
          evidence: `Curriculum mastery avg ${(derived.progress * 100).toFixed(0)}% across ${derived.touchedModules}/${derived.totalModules} modules`,
        };
      }
      // No progress to report, but the goal IS curriculum-linked — do NOT
      // fall through to the engagement heuristic, that would double-count.
      return null;
    }

    // Legacy fallback for goals whose contentSpec has no Curriculum row yet
    // (rare — only old data or specs that never instantiated a curriculum).
    const curriculumAttrs = await prisma.callerAttribute.findMany({
      where: {
        callerId,
        scope: 'CURRICULUM',
        domain: goal.contentSpec.domain,
        key: { contains: 'module_' },
      },
    });
    const completedModules = curriculumAttrs.filter(
      attr => attr.stringValue === 'completed'
    ).length;
    const totalModules = (goal.contentSpec.config as SpecConfig)?.curriculum?.modules?.length || 1;
    const curriculumProgress = completedModules / totalModules;
    if (curriculumProgress > goal.progress) {
      return {
        goalId: goal.id,
        progressDelta: curriculumProgress - goal.progress,
        evidence: `Completed ${completedModules}/${totalModules} modules (legacy attr path)`,
      };
    }
  }

  // Session-embedded learning: use COMP_/DISC_/COACH_ CallScores if available
  const outcomeScores = await prisma.callScore.findMany({
    where: {
      callId,
      parameter: {
        OR: [
          { parameterId: { startsWith: "COMP_" } },
          { parameterId: { startsWith: "DISC_" } },
          { parameterId: { startsWith: "COACH_" } },
        ],
      },
    },
    select: { score: true, parameter: { select: { parameterId: true } } },
  });

  if (outcomeScores.length > 0) {
    const avgScore = outcomeScores.reduce((sum, s) => sum + s.score, 0) / outcomeScores.length;
    if (avgScore > goal.progress) {
      const paramNames = outcomeScores.map(s => s.parameter.parameterId).join(", ");
      return {
        goalId: goal.id,
        progressDelta: avgScore - goal.progress,
        evidence: `Session-embedded learning: avg ${(avgScore * 100).toFixed(0)}% across ${outcomeScores.length} params (${paramNames})`,
      };
    }
  }

  // Fallback: small increment for engagement
  return {
    goalId: goal.id,
    progressDelta: 0.05, // 5% progress per engaged call
    evidence: `Engaged with learning content in call ${callId}`,
  };
}

/**
 * Calculate progress for CONNECT goals based on conversation quality
 */
async function calculateConnectProgress(
  goal: any,
  callerId: string,
  callId: string
): Promise<GoalProgressUpdate | null> {
  // Check for high engagement/connection scores
  const scores = await prisma.callScore.findMany({
    where: {
      callId,
      parameter: {
        parameterId: { in: [PARAMS.BEH_WARMTH, PARAMS.BEH_EMPATHY_RATE, PARAMS.BEH_INSIGHT_FREQUENCY] },
      },
    },
    include: {
      parameter: true,
    },
  });

  if (scores.length === 0) return null;

  // Average the connection-related scores
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

  // Progress based on connection quality
  // High scores (>0.7) = more progress
  if (avgScore > 0.7) {
    return {
      goalId: goal.id,
      progressDelta: 0.1, // 10% progress for strong connection
      evidence: `High connection quality (avg score: ${avgScore.toFixed(2)})`,
    };
  } else if (avgScore > 0.5) {
    return {
      goalId: goal.id,
      progressDelta: 0.05, // 5% progress for moderate connection
      evidence: `Moderate connection quality (avg score: ${avgScore.toFixed(2)})`,
    };
  }

  return null;
}

/**
 * Extract keywords (> 3 chars) from a goal's name for relevance matching.
 * Exported for testing.
 */
export function extractGoalKeywords(goalName: string | undefined | null): string[] {
  if (!goalName) return [];
  return goalName
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
}

/**
 * Generic engagement-based progress for other goal types.
 * Uses transcript length as base signal + keyword relevance bonus
 * when the goal's name terms appear in the transcript.
 */
async function calculateEngagementProgress(
  goal: any,
  callerId: string,
  callId: string
): Promise<GoalProgressUpdate | null> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { transcript: true },
  });

  if (!call?.transcript) return null;

  const transcriptLength = call.transcript.length;
  const transcriptLower = call.transcript.toLowerCase();

  // Base progress from transcript length
  let baseDelta = 0;
  if (transcriptLength > 1000) {
    baseDelta = 0.05;
  } else if (transcriptLength > 500) {
    baseDelta = 0.02;
  }

  // Keyword relevance bonus: +3% if goal name terms appear in transcript
  const keywords = extractGoalKeywords(goal.name);
  const hasRelevantMention = keywords.length > 0 &&
    keywords.some(kw => transcriptLower.includes(kw));
  const relevanceBonus = hasRelevantMention ? 0.03 : 0;

  const totalDelta = baseDelta + relevanceBonus;
  if (totalDelta === 0) return null;

  const parts: string[] = [];
  if (baseDelta > 0) parts.push(`${baseDelta === 0.05 ? "engaged" : "moderate"} conversation (${transcriptLength} chars)`);
  if (relevanceBonus > 0) parts.push("goal-relevant content discussed");

  return {
    goalId: goal.id,
    progressDelta: totalDelta,
    evidence: parts.join(", ") || `Conversation (${transcriptLength} chars)`,
  };
}

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
