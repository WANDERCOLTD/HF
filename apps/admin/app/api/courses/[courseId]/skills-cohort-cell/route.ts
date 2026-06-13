/**
 * @api GET /api/courses/[courseId]/skills-cohort-cell
 *
 * Per-cell drill-in for the Cohort Heatmap lens (SP2-D-followon) — given
 * a (skillRef, tier) pair, returns the learners whose `CallerTarget` for
 * that skill buckets into the requested tier, with each learner's most
 * recent `BehaviorMeasurement` evidence excerpt for the same skill.
 *
 * Backs the click-to-drill panel on `/x/courses/[id]?tab=skills` →
 * Cohort Heatmap. Closes the AWAITING_EVIDENCE / Practitioner / etc.
 * cell-click trust gap raised in the SP3-A handoff (line 223).
 *
 * Auth: OPERATOR+ (cohort aggregation, never STUDENT). Caller-detail
 * scope lives on the sibling `/api/callers/[id]/...` family.
 *
 * Query params:
 *   - `skillRef`  (required) — SKILL-NN stable ID
 *   - `tier`      (required) — tier name from the skill's `tierScheme`,
 *                              OR the special values AWAITING_EVIDENCE /
 *                              ABOVE_TARGET
 *
 * Bucketing logic mirrors `skills-cohort-heatmap/route.ts` exactly —
 * `scoreToTier` + `getSkillTierMapping` are the single source of truth
 * for currentScore → tier. We re-derive here (instead of reading the
 * heatmap response) so the panel can be opened directly without first
 * fetching the heatmap.
 *
 * ## N+1 discipline (Tech-Lead Task #10)
 *
 * Three queries total — independent of cohort size or skill count:
 *   1. Resolve all skills for the playbook + the enrolled-caller list
 *      (already two of these for the heatmap; here we add a single
 *      `CallerTarget.findMany` filtered to (parameterId, callerId in
 *      cohort) for ONE skill).
 *   2. Bucket the rows in-process to find learners in the target tier.
 *   3. ONE `BehaviorMeasurement.findMany` filtered to (parameterId,
 *      callerId in bucket-membership) ordered by measuredAt desc + take
 *      the most-recent per learner via in-process dedup.
 *
 * For a 100-learner cohort this is ~3 round-trips total — well under
 * the existing heatmap's complexity.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";
import { getSkillTierMapping, scoreToTier } from "@/lib/goals/track-progress";
import { AWAITING_EVIDENCE, ABOVE_TARGET } from "@/lib/banding/tier-colors";

export interface CohortCellLearner {
  callerId: string;
  callerName: string | null;
  /**
   * The learner's running EMA score for this skill (0-1). Null when the
   * learner is in the AWAITING_EVIDENCE bucket — that bucket is defined
   * by "no measurement yet", not by a zero score.
   */
  currentScore: number | null;
  /**
   * Most-recent `BehaviorMeasurement` evidence for this learner + skill,
   * if any. Null in the AWAITING_EVIDENCE bucket; also null when the
   * cohort entry has a CallerTarget row but no MEASURE-stage trigger has
   * fired yet for that parameter on a real call.
   */
  lastMeasurement: {
    callId: string;
    measuredAt: string;
    score: number;
    confidence: number;
    excerpts: string[];
  } | null;
}

export interface CohortCellResponse {
  courseId: string;
  skillRef: string;
  parameterId: string;
  parameterName: string;
  tier: string;
  /** The full tier scheme this skill uses — echoed so the client can
   *  validate the requested tier without re-fetching the heatmap. */
  tierScheme: string[];
  learners: CohortCellLearner[];
  empty: boolean;
}

/**
 * Decide whether a (currentScore, callsUsed) tuple falls into the
 * requested tier bucket. Mirrors `skills-cohort-heatmap/route.ts`
 * line-for-line so the drill-in panel never disagrees with the cell
 * count above it.
 */
function bucketFor(opts: {
  currentScore: number | null;
  callsUsed: number;
  targetValue: number;
  scheme: string[];
  tierMapping: Awaited<ReturnType<typeof getSkillTierMapping>>;
}): string {
  const { currentScore, callsUsed, targetValue, scheme, tierMapping } = opts;
  if (currentScore == null || callsUsed === 0) return AWAITING_EVIDENCE;
  if (currentScore > targetValue) return ABOVE_TARGET;
  const { tier } = scoreToTier(currentScore, tierMapping);
  const normalized = tier.toLowerCase();
  if (scheme.includes(normalized)) return normalized;
  return scheme[0] ?? AWAITING_EVIDENCE;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const url = new URL(request.url);
  const skillRef = url.searchParams.get("skillRef");
  const tierParam = url.searchParams.get("tier");
  if (!skillRef || !tierParam) {
    return NextResponse.json(
      { error: "skillRef and tier query params are required" },
      { status: 400 },
    );
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const skills = await resolveAllSkillsForPlaybook(courseId);
  const skill = skills.find((s) => s.skillRef === skillRef);
  if (!skill) {
    return NextResponse.json(
      { error: `Skill ${skillRef} not found on this course` },
      { status: 404 },
    );
  }

  const scheme = [...skill.tierScheme];
  const tier = tierParam.toLowerCase();
  const acceptedTiers = [AWAITING_EVIDENCE, ABOVE_TARGET, ...scheme];
  if (!acceptedTiers.includes(tier)) {
    return NextResponse.json(
      {
        error: `tier "${tierParam}" is not part of this skill's scheme`,
        acceptedTiers,
      },
      { status: 400 },
    );
  }

  // ── Cohort + per-skill targets ──────────────────────────────────────────
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { playbookId: courseId },
    select: { callerId: true },
  });
  const callerIds = enrollments.map((e) => e.callerId);

  const tierMapping = await getSkillTierMapping(courseId);

  const targets = callerIds.length
    ? await prisma.callerTarget.findMany({
        where: {
          callerId: { in: callerIds },
          parameterId: skill.parameterId,
        },
        select: {
          callerId: true,
          currentScore: true,
          callsUsed: true,
        },
      })
    : [];

  // Index the targets so AWAITING_EVIDENCE can include enrolled callers
  // with no CallerTarget row at all (default-into-bucket behaviour, same
  // as the heatmap).
  const targetByCaller = new Map<string, (typeof targets)[number]>();
  for (const t of targets) targetByCaller.set(t.callerId, t);

  const bucketMembers: { callerId: string; currentScore: number | null }[] = [];
  for (const callerId of callerIds) {
    const t = targetByCaller.get(callerId);
    const bucket = bucketFor({
      currentScore: t?.currentScore ?? null,
      callsUsed: t?.callsUsed ?? 0,
      targetValue: skill.targetValue,
      scheme,
      tierMapping,
    });
    if (bucket === tier) {
      bucketMembers.push({
        callerId,
        currentScore: t?.currentScore ?? null,
      });
    }
  }

  if (bucketMembers.length === 0) {
    const parameter = await prisma.parameter.findUnique({
      where: { parameterId: skill.parameterId },
      select: { name: true },
    });
    const response: CohortCellResponse = {
      courseId,
      skillRef: skill.skillRef,
      parameterId: skill.parameterId,
      parameterName: parameter?.name ?? skill.parameterId,
      tier,
      tierScheme: scheme,
      learners: [],
      empty: true,
    };
    return NextResponse.json(response);
  }

  // ── Display names + last measurements ───────────────────────────────────
  const bucketCallerIds = bucketMembers.map((m) => m.callerId);

  const [parameter, callers, measurements] = await Promise.all([
    prisma.parameter.findUnique({
      where: { parameterId: skill.parameterId },
      select: { name: true },
    }),
    prisma.caller.findMany({
      where: { id: { in: bucketCallerIds } },
      select: { id: true, name: true },
    }),
    // AWAITING_EVIDENCE bucket members have no MEASURE row by definition —
    // skip the findMany entirely to save the round-trip.
    tier === AWAITING_EVIDENCE
      ? Promise.resolve([])
      : prisma.behaviorMeasurement.findMany({
          where: {
            parameterId: skill.parameterId,
            call: { callerId: { in: bucketCallerIds } },
          },
          select: {
            callId: true,
            actualValue: true,
            confidence: true,
            evidence: true,
            measuredAt: true,
            call: { select: { callerId: true } },
          },
          orderBy: { measuredAt: "desc" },
        }),
  ]);

  const nameByCaller = new Map(callers.map((c) => [c.id, c.name]));

  // In-process dedup — the orderBy desc above guarantees the FIRST entry
  // per learner is their most-recent measurement, so we take that one.
  const lastByCaller = new Map<string, (typeof measurements)[number]>();
  for (const m of measurements) {
    const cid = m.call?.callerId;
    if (cid && !lastByCaller.has(cid)) {
      lastByCaller.set(cid, m);
    }
  }

  const learners: CohortCellLearner[] = bucketMembers.map((m) => {
    const last = lastByCaller.get(m.callerId);
    return {
      callerId: m.callerId,
      callerName: nameByCaller.get(m.callerId) ?? null,
      currentScore: m.currentScore,
      lastMeasurement: last
        ? {
            callId: last.callId,
            measuredAt: last.measuredAt.toISOString(),
            score: last.actualValue,
            confidence: last.confidence,
            excerpts: last.evidence,
          }
        : null,
    };
  });

  const response: CohortCellResponse = {
    courseId,
    skillRef: skill.skillRef,
    parameterId: skill.parameterId,
    parameterName: parameter?.name ?? skill.parameterId,
    tier,
    tierScheme: scheme,
    learners,
    empty: false,
  };
  return NextResponse.json(response);
}
