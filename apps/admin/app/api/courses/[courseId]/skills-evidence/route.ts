/**
 * @api GET /api/courses/[courseId]/skills-evidence
 *
 * Returns the most recent N `BehaviorMeasurement.evidence` excerpts per
 * skill across the playbook's cohort. Powers two upcoming lenses:
 *
 *   - SP3-A Rubric Calibration → "What the AI tutor cited last time" panel
 *     (cohort-wide; shows the educator what the model actually pulled out
 *     of recent transcripts when scoring against the rubric)
 *
 *   - SP4-B Attainment Skill Bands section → per-skill evidence expand
 *     (this route returns the cohort view; the caller-detail equivalent
 *     `/api/callers/[id]/skills-evidence` is a separate story — different
 *     auth shape, different scope)
 *
 * Auth: OPERATOR+ (cohort aggregation, never STUDENT). Per-learner
 * variants belong on the caller-detail route family.
 *
 * Cap: 3 excerpts per skill per request by default; bounded by `?limit=N`
 * with a hard ceiling of 10 so a curious operator can't issue a 100×
 * fanout against `BehaviorMeasurement`.
 *
 * ## Why a single bounded query
 *
 * For N skills × 3 excerpts at hard ceiling = 30 rows max. The straight
 * approach is one `findMany` per skill (cheap — 10 skills × 1 query = 10
 * round-trips, NOT N+1). We sort by `measuredAt desc` and `take: limit`
 * per skill. Postgres handles this in a single index seek per skill via
 * the existing `@@index([parameterId])` + `@@index([measuredAt])`.
 *
 * If a future caller needs sub-100ms p99 we can switch to one
 * `$queryRaw` window-function call; today the per-skill approach is fine
 * and trivially safe.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";

export interface SkillEvidenceItem {
  callId: string;
  callerId: string;
  callerName: string | null;
  measuredAt: string;
  /**
   * Per-call score for this skill (0-1). Same value as
   * `BehaviorMeasurement.actualValue` — surfaced so the consumer can
   * render a small tier-chip alongside each excerpt without a second
   * round-trip.
   */
  score: number;
  confidence: number;
  /** Transcript excerpts the LLM cited. Empty array when the measure has none. */
  excerpts: string[];
}

export interface SkillEvidenceRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  /**
   * Most-recent-first. Length capped to `limit` (default 3, max 10).
   * Empty when no `BehaviorMeasurement` exists yet — the consumer renders
   * "No evidence captured yet" copy.
   */
  evidence: SkillEvidenceItem[];
}

export interface SkillEvidenceResponse {
  courseId: string;
  /** The `?limit=` value applied; echoed so consumers can label "Last 3 cited". */
  limit: number;
  rows: SkillEvidenceRow[];
  empty: boolean;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const skills = await resolveAllSkillsForPlaybook(courseId);
  if (skills.length === 0) {
    const response: SkillEvidenceResponse = {
      courseId,
      limit,
      rows: [],
      empty: true,
    };
    return NextResponse.json(response);
  }

  // Cohort scope — every caller enrolled on this playbook.
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { playbookId: courseId },
    select: { callerId: true },
  });
  const callerIds = enrollments.map((e) => e.callerId);

  // Display-name lookup for the per-excerpt "Cited from <learner>" label.
  const callers = callerIds.length
    ? await prisma.caller.findMany({
        where: { id: { in: callerIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameByCaller = new Map(callers.map((c) => [c.id, c.name]));

  const parameters = await prisma.parameter.findMany({
    where: { parameterId: { in: skills.map((s) => s.parameterId) } },
    select: { parameterId: true, name: true },
  });
  const paramName = new Map(parameters.map((p) => [p.parameterId, p.name]));

  // Per-skill bounded fetch. Cheap — one indexed seek per skill, N << 100.
  const rows: SkillEvidenceRow[] = await Promise.all(
    skills.map(async (s) => {
      const measurements = callerIds.length
        ? await prisma.behaviorMeasurement.findMany({
            where: {
              parameterId: s.parameterId,
              call: { callerId: { in: callerIds } },
            },
            select: {
              actualValue: true,
              confidence: true,
              evidence: true,
              measuredAt: true,
              callId: true,
              call: { select: { callerId: true } },
            },
            orderBy: { measuredAt: "desc" },
            take: limit,
          })
        : [];

      return {
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: paramName.get(s.parameterId) ?? s.parameterId,
        evidence: measurements.map((m) => ({
          callId: m.callId,
          callerId: m.call?.callerId ?? "",
          callerName: m.call?.callerId
            ? nameByCaller.get(m.call.callerId) ?? null
            : null,
          measuredAt: m.measuredAt.toISOString(),
          score: m.actualValue,
          confidence: m.confidence,
          excerpts: m.evidence,
        })),
      };
    }),
  );

  const response: SkillEvidenceResponse = {
    courseId,
    limit,
    rows,
    empty: false,
  };
  return NextResponse.json(response);
}
