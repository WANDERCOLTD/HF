/**
 * #2176 S2 — assessment sampling engine.
 *
 * Pure, course-agnostic function that materialises an
 * `AssessmentMoment` into an ordered list of `ContentQuestion` rows.
 * Reads the declarative `CourseAssessmentPlan` from
 * `Playbook.config.assessmentPlan` (no imperative per-course branches);
 * applies the moment's `samplingPolicy` (scope + count + stratification)
 * against the playbook's content pool.
 *
 * **Why a single chokepoint:** today every assessment instance (IELTS
 * Baseline, IELTS Mock, CIO/CTO Pop Quiz, CIO/CTO Exam Assessment) is
 * hand-wired with bespoke selection logic. This engine collapses them
 * into one typed sampler — drift across courses becomes a Coverage
 * failure, not a silent runtime divergence.
 *
 * **Operator-visible signals (NEVER silent null):**
 * - `assessment.sample.empty_pool` — no ContentQuestion rows survived
 *   the scope filter
 * - `assessment.sample.missing_content` — moment cited a `contentKind`
 *   the pool can't supply (e.g. `mcq` but every question is `cue-card`)
 * - `assessment.sample.policy_unsatisfied` — pool exists but
 *   stratification rules can't be satisfied (e.g. `perCriterion: 1` on
 *   a pool with no criterion tags)
 *
 * Each surfaces an AppLog entry via `lib/logger.ts::log("system", ...)`
 * AND returns `{ok: false, reason}` so the caller (typically
 * `createSession` when an AssessmentMoment fires) can decide whether to
 * block the session entirely OR substitute a smaller-than-target sample.
 *
 * **No side effects beyond the AppLog write.** No CallScore writes; no
 * CallerAttribute writes; no Session mutation. The engine returns a list
 * of `ContentQuestion` rows; the caller orchestrates everything
 * downstream.
 *
 * See epic #2176 and `.claude/rules/course-assessment-plan-coverage.md`
 * (S7 follow-on) for the full architecture.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";
import type {
  AssessmentMoment,
  CourseAssessmentPlan,
} from "@/lib/types/json-fields";

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface SampleQuestionsArgs {
  /** The course's declarative plan (read from `Playbook.config.assessmentPlan`). */
  plan: CourseAssessmentPlan;
  /** The specific moment the caller is materialising. */
  moment: AssessmentMoment;
  /** The Playbook whose pool the engine samples from. */
  playbookId: string;
  /** The Caller whose weakest-skill / weakest-LO signal the engine reads. */
  callerId: string;
}

/**
 * Sampled question — narrow projection over the `ContentQuestion` row
 * (fields the caller / shell renderer actually needs). Sibling shape to
 * `RetrievalQuestion` in `lib/assessment/retrieval-question-selector.ts`
 * — kept distinct to avoid accidental coupling.
 */
export interface SampledQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options: unknown;
  correctAnswer: string | null;
  answerExplanation: string | null;
  learningOutcomeRef: string | null;
  skillRef: string | null;
  bloomLevel: string | null;
  difficulty: number | null;
}

export type SampleQuestionsFailureReason =
  | "empty-pool"
  | "missing-content"
  | "policy-unsatisfied";

export type SampleQuestionsResult =
  | { ok: true; questions: SampledQuestion[] }
  | { ok: false; reason: SampleQuestionsFailureReason; questions?: never };

// ────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────

/**
 * Sample N questions for the given assessment moment.
 *
 * Pure-ish function: the only side effect is an AppLog write on
 * failure paths (operator-visible signal — never silent null).
 *
 * @param args plan / moment / playbookId / callerId
 * @returns ordered list of sampled questions OR a typed failure reason
 */
export async function sampleQuestionsForMoment(
  args: SampleQuestionsArgs,
): Promise<SampleQuestionsResult> {
  const { plan, moment, playbookId, callerId } = args;

  // Defensive: an explicitly opted-out plan should never reach the
  // engine, but if it does, treat as missing-content rather than
  // crash.
  if (plan.noAssessmentPlan === true) {
    log("system", "assessment.sample.missing_content", {
      level: "warn",
      message:
        "sampleQuestionsForMoment called against a plan declaring noAssessmentPlan:true",
      playbookId,
      callerId,
      momentKind: moment.kind,
      moduleSlug: moment.moduleSlug,
    });
    return { ok: false, reason: "missing-content" };
  }

  const policy = moment.samplingPolicy;

  // For v1, only the `"mcq"` contentKind has a structural pool
  // (`ContentQuestion` rows). Other kinds (`cue-card`, `topic-prompt`,
  // `scenario-probe`) read from `ContentSource` rows resolved via
  // `resolveModuleSourceRefs`; their sampling engines are sibling
  // follow-ons. For v1 we surface missing-content so the operator
  // knows a non-MCQ moment landed but isn't wired yet.
  if (policy.contentKind !== "mcq") {
    log("system", "assessment.sample.missing_content", {
      level: "warn",
      message: `sampleQuestionsForMoment: contentKind "${policy.contentKind}" not yet wired in engine`,
      playbookId,
      callerId,
      momentKind: moment.kind,
      moduleSlug: moment.moduleSlug,
      contentKind: policy.contentKind,
    });
    return { ok: false, reason: "missing-content" };
  }

  // Resolve the source-id pool for this Playbook (modern PlaybookSource
  // attachment path — mirrors `retrieval-question-selector.ts`).
  const sourceIds = await getSourceIdsForPlaybook(playbookId);
  if (sourceIds.length === 0) {
    log("system", "assessment.sample.empty_pool", {
      level: "warn",
      message: "no ContentSource rows attached to Playbook",
      playbookId,
      callerId,
      momentKind: moment.kind,
      moduleSlug: moment.moduleSlug,
    });
    return { ok: false, reason: "empty-pool" };
  }

  // Build the scope filter. For `per-unit`, prefer questions whose
  // tags / metadata reference the moment's moduleSlug. The current
  // ContentQuestion schema doesn't carry a hard moduleSlug FK, so we
  // fall back to a tag-match heuristic. The Coverage gate enforces a
  // declared moduleSlug exists; the engine surfaces empty-pool when
  // the tag-match yields nothing.
  const baseWhere: Record<string, unknown> = {
    sourceId: { in: sourceIds },
  };
  if (policy.scope === "per-unit") {
    baseWhere.tags = { has: moment.moduleSlug };
  }

  // Pool fetch — light select projection.
  let pool = (await prisma.contentQuestion.findMany({
    where: baseWhere,
    select: {
      id: true,
      questionText: true,
      questionType: true,
      options: true,
      correctAnswer: true,
      answerExplanation: true,
      learningOutcomeRef: true,
      skillRef: true,
      bloomLevel: true,
      difficulty: true,
    },
  })) as SampledQuestion[];

  if (pool.length === 0) {
    log("system", "assessment.sample.empty_pool", {
      level: "warn",
      message: "ContentQuestion pool empty after scope filter",
      playbookId,
      callerId,
      momentKind: moment.kind,
      moduleSlug: moment.moduleSlug,
      scope: policy.scope,
    });
    return { ok: false, reason: "empty-pool" };
  }

  // Anchored scopes — bias the pool toward weakest skill / LO.
  if (policy.scope === "weakest-skill-anchored") {
    const weakest = await resolveWeakestSkillRef(callerId);
    if (weakest) {
      pool = orderByPreferredField(pool, "skillRef", weakest);
    }
  } else if (policy.scope === "weakest-lo-anchored") {
    const weakest = await resolveWeakestLoRef(callerId);
    if (weakest) {
      pool = orderByPreferredField(pool, "learningOutcomeRef", weakest);
    }
  }

  // Apply stratification — enforce minimum coverage per criterion / LO
  // BEFORE the target-count slice. If stratification can't be
  // satisfied (no rows tagged for a required criterion), surface
  // policy-unsatisfied; do NOT silently drop the rule.
  const strat = policy.stratification;
  let selected: SampledQuestion[] = [];

  if (strat?.perCriterion && strat.perCriterion > 0) {
    const stratResult = stratifyByField(pool, "skillRef", strat.perCriterion);
    if (!stratResult.ok) {
      log("system", "assessment.sample.policy_unsatisfied", {
        level: "warn",
        message: "perCriterion stratification could not be satisfied",
        playbookId,
        callerId,
        momentKind: moment.kind,
        moduleSlug: moment.moduleSlug,
        perCriterion: strat.perCriterion,
        emptyKeys: stratResult.emptyKeys,
      });
      return { ok: false, reason: "policy-unsatisfied" };
    }
    selected = stratResult.selected;
  }

  if (strat?.perLO && strat.perLO > 0) {
    const stratResult = stratifyByField(pool, "learningOutcomeRef", strat.perLO);
    if (!stratResult.ok) {
      log("system", "assessment.sample.policy_unsatisfied", {
        level: "warn",
        message: "perLO stratification could not be satisfied",
        playbookId,
        callerId,
        momentKind: moment.kind,
        moduleSlug: moment.moduleSlug,
        perLO: strat.perLO,
        emptyKeys: stratResult.emptyKeys,
      });
      return { ok: false, reason: "policy-unsatisfied" };
    }
    // Merge — perCriterion picks first, then perLO fills gaps.
    const seen = new Set(selected.map((q) => q.id));
    for (const q of stratResult.selected) {
      if (!seen.has(q.id)) {
        selected.push(q);
        seen.add(q.id);
      }
    }
  }

  // Fill up to `target` from the remainder.
  const target = policy.count.target;
  const max = policy.count.max;
  const min = policy.count.min;
  if (selected.length < target) {
    const seen = new Set(selected.map((q) => q.id));
    for (const q of pool) {
      if (selected.length >= target) break;
      if (!seen.has(q.id)) {
        selected.push(q);
        seen.add(q.id);
      }
    }
  }

  // Hard cap at `max`.
  if (selected.length > max) {
    selected = selected.slice(0, max);
  }

  // Final check against `min` — pool was non-empty but couldn't yield
  // the minimum after stratification + dedup.
  if (selected.length < min) {
    log("system", "assessment.sample.policy_unsatisfied", {
      level: "warn",
      message: `selected ${selected.length} below min ${min}`,
      playbookId,
      callerId,
      momentKind: moment.kind,
      moduleSlug: moment.moduleSlug,
      poolSize: pool.length,
      min,
      target,
      max,
    });
    return { ok: false, reason: "policy-unsatisfied" };
  }

  return { ok: true, questions: selected };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Find the caller's weakest `skill_*` parameter via `CallerTarget.currentScore`.
 * Returns the parameterId (the skillRef shape used to tag ContentQuestion rows).
 * Returns null when the caller has no scored skill targets — the engine falls
 * back to default ordering.
 */
async function resolveWeakestSkillRef(callerId: string): Promise<string | null> {
  const rows = await prisma.callerTarget.findMany({
    where: {
      callerId,
      currentScore: { not: null },
      parameterId: { startsWith: "skill_" },
    },
    select: { parameterId: true, currentScore: true },
    orderBy: { currentScore: "asc" },
    take: 1,
  });
  return rows[0]?.parameterId ?? null;
}

/**
 * Find the caller's weakest LO via `CallerAttribute` rows keyed
 * `lo_mastery:*` OR `curriculum:*:lo_mastery:*` (see #1611 / canonical
 * slug form in `lib/goals/strategies/types.ts`). Returns the `loRef`
 * suffix the canonical key carries. Returns null when no LO mastery
 * rows have been written yet.
 */
async function resolveWeakestLoRef(callerId: string): Promise<string | null> {
  const rows = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      key: { contains: "lo_mastery:" },
      valueType: "NUMBER",
      numberValue: { not: null },
    },
    select: { key: true, numberValue: true },
    orderBy: { numberValue: "asc" },
    take: 1,
  });
  const winner = rows[0];
  if (!winner) return null;
  // Canonical key shape: `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`
  // OR legacy `lo_mastery:{moduleSlug}:{loRef}`. The loRef is the trailing segment.
  const parts = winner.key.split(":");
  return parts[parts.length - 1] ?? null;
}

/**
 * Pure ordering helper — moves rows whose `field` matches `preferred`
 * to the front of the pool while preserving relative order. Does NOT
 * mutate the input array.
 */
function orderByPreferredField<T extends Record<string, unknown>>(
  pool: T[],
  field: keyof T,
  preferred: string,
): T[] {
  const preferredRows: T[] = [];
  const rest: T[] = [];
  for (const row of pool) {
    if (row[field] === preferred) preferredRows.push(row);
    else rest.push(row);
  }
  return [...preferredRows, ...rest];
}

interface StratResult {
  ok: boolean;
  selected: SampledQuestion[];
  emptyKeys?: string[];
}

/**
 * Pick at least `min` rows per distinct value of `field` from the pool.
 * Returns `{ok: false, emptyKeys}` when any seen-field value can't
 * supply `min` rows. Note: only fails when the SAME field's distinct
 * values are insufficient; it does NOT fail when no rows declare the
 * field (that's a different failure shape — pool has no criterion
 * tagging at all, which is a content-authoring gap to surface
 * separately).
 */
function stratifyByField(
  pool: SampledQuestion[],
  field: keyof SampledQuestion,
  min: number,
): StratResult {
  const byKey = new Map<string, SampledQuestion[]>();
  for (const row of pool) {
    const k = row[field];
    if (typeof k !== "string" || k.length === 0) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(row);
  }
  // No tagged rows at all — pool can't satisfy stratification of any kind.
  if (byKey.size === 0) {
    return { ok: false, selected: [], emptyKeys: ["(no tagged rows)"] };
  }
  const selected: SampledQuestion[] = [];
  const emptyKeys: string[] = [];
  for (const [key, rows] of byKey) {
    if (rows.length < min) {
      emptyKeys.push(key);
      continue;
    }
    selected.push(...rows.slice(0, min));
  }
  if (emptyKeys.length > 0) {
    return { ok: false, selected, emptyKeys };
  }
  return { ok: true, selected };
}
