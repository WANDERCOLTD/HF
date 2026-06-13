/**
 * @api GET /api/courses/[courseId]/skills-cohort-heatmap
 *
 * Per-skill × per-tier cohort distribution for the Skills Framework
 * Inspector's Cohort Heatmap lens (SP2-D).
 *
 * Auth: OPERATOR+ (educator-scope — STUDENT never sees cohort aggregates).
 *
 * ## Why a single aggregation query
 *
 * Tech-Lead audit (Task #10) flagged the obvious N+1: with N learners x
 * M skills x T tiers, a naive implementation hits Prisma `findFirst`
 * for every cell — 100 learners x 4 skills x 4 tiers = 1600 round-trips
 * and a timeout on any real cohort. This route mandates a SINGLE
 * `groupBy` against `CallerTarget` filtered to:
 *
 *   - The playbook's enrolled callers (`CallerPlaybook`)
 *   - The course's `skill_*` parameters (matched against
 *     `resolveAllSkillsForPlaybook` output)
 *
 * The banding (currentScore → tier) happens in-process from the grouped
 * rows — `scoreToTier` is a pure function, so we never re-query.
 *
 * ## Response shape
 *
 *   {
 *     courseId: "…",
 *     totalLearners: 47,
 *     rows: [
 *       {
 *         skillRef: "SKILL-01",
 *         parameterName: "Stakeholder anticipation",
 *         tierScheme: ["foundation", "developing", "practitioner", "distinction"],
 *         targetTier: "practitioner",
 *         buckets: {
 *           awaiting_evidence: 18,
 *           foundation: 4,
 *           developing: 8,
 *           practitioner: 12,
 *           distinction: 5,
 *           above_target: 0
 *         }
 *       },
 *       …
 *     ]
 *   }
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";
import { getSkillTierMapping, scoreToTier } from "@/lib/goals/track-progress";
import { AWAITING_EVIDENCE, ABOVE_TARGET } from "@/lib/banding/tier-colors";

export interface CohortHeatmapRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  tierScheme: string[];
  targetTier: string | null;
  targetValue: number;
  /** Map of tier name (or AWAITING_EVIDENCE / ABOVE_TARGET) → learner count. */
  buckets: Record<string, number>;
}

export interface CohortHeatmapResponse {
  courseId: string;
  totalLearners: number;
  rows: CohortHeatmapRow[];
  empty: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // ── Skills for this playbook ────────────────────────────────────────────
  const skills = await resolveAllSkillsForPlaybook(courseId);
  if (skills.length === 0) {
    const response: CohortHeatmapResponse = {
      courseId,
      totalLearners: 0,
      rows: [],
      empty: true,
    };
    return NextResponse.json(response);
  }
  const parameterIds = skills.map((s) => s.parameterId);

  // ── Cohort scope: who's enrolled on this playbook ────────────────────────
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { playbookId: courseId },
    select: { callerId: true },
  });
  const callerIds = enrollments.map((e) => e.callerId);
  const totalLearners = callerIds.length;

  if (totalLearners === 0) {
    // Pre-populate rows with all learners in the awaiting_evidence bucket so
    // the empty-cohort case is visually obvious without a separate UI branch.
    const response: CohortHeatmapResponse = {
      courseId,
      totalLearners: 0,
      rows: skills.map((s) => ({
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: s.parameterId,
        tierScheme: [...s.tierScheme],
        targetTier: null,
        targetValue: s.targetValue,
        buckets: { [AWAITING_EVIDENCE]: 0 },
      })),
      empty: false,
    };
    return NextResponse.json(response);
  }

  // ── SINGLE aggregation query (Task #10 — avoid N+1) ─────────────────────
  // One findMany returns every (callerId, parameterId, currentScore) tuple
  // for the cohort × skill matrix. Banding + bucket counts happen in-process.
  const rows = await prisma.callerTarget.findMany({
    where: {
      callerId: { in: callerIds },
      parameterId: { in: parameterIds },
    },
    select: {
      callerId: true,
      parameterId: true,
      currentScore: true,
      callsUsed: true,
    },
  });

  // Parameter display names + targetValues (for the ABOVE_TARGET buckets).
  const parameters = await prisma.parameter.findMany({
    where: { parameterId: { in: parameterIds } },
    select: { parameterId: true, name: true },
  });
  const nameByParam = new Map(parameters.map((p) => [p.parameterId, p.name]));

  // Tier mapping — same source the BandChip uses on the Caller Detail surfaces.
  const tierMapping = await getSkillTierMapping(courseId);

  // ── Banding ─────────────────────────────────────────────────────────────
  // For each skill, walk its tierScheme and bucket every learner.
  const rowsByParam = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!rowsByParam.has(r.parameterId)) rowsByParam.set(r.parameterId, []);
    rowsByParam.get(r.parameterId)!.push(r);
  }

  const heatmapRows: CohortHeatmapRow[] = skills.map((s) => {
    const scheme = [...s.tierScheme];
    const buckets: Record<string, number> = { [AWAITING_EVIDENCE]: 0 };
    for (const tier of scheme) buckets[tier] = 0;
    buckets[ABOVE_TARGET] = 0;

    const skillRows = rowsByParam.get(s.parameterId) ?? [];
    const measuredCallerIds = new Set<string>();

    for (const r of skillRows) {
      if (r.currentScore == null || (r.callsUsed ?? 0) === 0) continue;
      measuredCallerIds.add(r.callerId);

      // ABOVE_TARGET wins when score exceeds the educator's target.
      if (r.currentScore > s.targetValue) {
        buckets[ABOVE_TARGET]++;
        continue;
      }

      // Bucket by tier name returned from scoreToTier — fall back to lowest
      // scheme entry when the mapping returns something the scheme doesn't
      // know (e.g. CEFR vs 4-tier mismatch).
      const { tier: tierName } = scoreToTier(r.currentScore, tierMapping);
      const normalized = tierName.toLowerCase();
      if (buckets[normalized] !== undefined) {
        buckets[normalized]++;
      } else {
        // Unknown tier from mapping — bucket into the closest scheme entry.
        buckets[scheme[0] ?? AWAITING_EVIDENCE]++;
      }
    }

    // Everyone not in `measuredCallerIds` is awaiting evidence.
    buckets[AWAITING_EVIDENCE] = callerIds.length - measuredCallerIds.size;

    // Target tier — proportional mapping of the (0–1) targetValue onto the
    // scheme. Matches the Framework Map's `tierForTargetValue` helper.
    const idx = Math.min(
      Math.max(Math.floor(s.targetValue * scheme.length), 0),
      scheme.length - 1,
    );
    const targetTier = scheme[idx] ?? null;

    return {
      skillRef: s.skillRef,
      parameterId: s.parameterId,
      parameterName: nameByParam.get(s.parameterId) ?? s.parameterId,
      tierScheme: scheme,
      targetTier,
      targetValue: s.targetValue,
      buckets,
    };
  });

  const response: CohortHeatmapResponse = {
    courseId,
    totalLearners,
    rows: heatmapRows,
    empty: false,
  };
  return NextResponse.json(response);
}
