/**
 * @api GET /api/student/:courseId/results/:sessionId
 * @visibility public
 * @scope student:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags student, results
 * @description Mock-exam Results screen payload for `/x/student/[courseId]/results/[sessionId]`.
 *   Aggregates `CallScore` rows for every Call belonging to the Session, grouped by
 *   `segmentKey` × parameter. Computes the IELTS overall band (mean of per-criterion bands,
 *   half-band rounded) from the same rows when `Session.metadata.overallBand` is absent
 *   — the writer for that field is a producer-gap follow-on (epic #1700 Theme 11 #1749
 *   only writes `scoreDeltas`; `overallBand` declared in `lib/types/json-fields.ts:1082`
 *   but never written today).
 *
 *   STUDENT sessions are scoped to their own Caller via `studentAllowedToReadCaller`
 *   (mirrors the precedent at `/api/calls/[callId]/route.ts`). The `courseId` path
 *   param must match the Session's `playbookId` (403 mismatch otherwise) — prevents
 *   cross-course session reads.
 *
 *   While the Session is still recording (`status` in {STARTED, ACTIVE}) or before
 *   the pipeline has written CallScore rows, the response returns `processing: true`
 *   with the partial data we have. The page polls this endpoint at 5s until
 *   `processing: false`.
 *
 * @pathParam courseId string - Playbook.id
 * @pathParam sessionId string - Session.id
 * @response 200 ResultsPayload
 * @response 403 { ok: false, error: string }
 * @response 404 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { scoreToTier, getSkillTierMapping } from "@/lib/goals/track-progress";
import {
  computeOverallBandFromScores,
  roundHalfBand,
} from "@/lib/pipeline/compute-overall-band";
import type { SessionMetadata } from "@/lib/types/json-fields";

export interface ResultsScore {
  parameterId: string;
  parameterName: string;
  segmentKey: string | null;
  /** Mean of all CallScore.score values for this (parameter, segmentKey) pair. */
  score: number;
  /** Tier label from `scoreToTier`. */
  tier: string;
  /** Band number from `scoreToTier` (IELTS 0–9 / Generic 1–4 — depends on mapping). */
  band: number;
  /** Number of CallScore rows aggregated. */
  count: number;
}

export interface ResultsPayload {
  ok: true;
  /** True until the Session has ended AND CallScore rows are written. */
  processing: boolean;
  sessionId: string;
  courseId: string;
  courseTitle: string | null;
  callerId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  /** All scores grouped — segmentKey === null means session-wide / bound-module scoring. */
  scores: ResultsScore[];
  /**
   * Overall band — preferred from `Session.metadata.overallBand`; computed from
   * `scores` as mean-of-per-criterion-band, half-band rounded, when absent.
   * Null when no scores exist yet.
   */
  overallBand: number | null;
  /** Whether `overallBand` came from metadata or was computed on the fly. */
  overallBandSource: "metadata" | "computed" | null;
  /** Parameter with the highest mean band across all segments. */
  strength: { parameterId: string; parameterName: string; band: number } | null;
  /** Parameter with the lowest mean band across all segments. */
  area: { parameterId: string; parameterName: string; band: number } | null;
  /**
   * #1954 (Boaz/Eldar gap analysis Unit 1.1) — post-Assessment lesson
   * plan emitted to `Session.metadata.lessonPlan` by the AGGREGATE
   * stage when the locked module's `generateLessonPlan` toggle is on
   * AND the #1953 four-criteria gate fires "complete". Null on
   * sessions where the trigger didn't fire (most sessions).
   */
  lessonPlan: import("@/lib/types/json-fields").SessionLessonPlan | null;
}

export type ResultsResponse =
  | ResultsPayload
  | { ok: false; error: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string; sessionId: string }> },
): Promise<NextResponse<ResultsResponse>> {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId, sessionId } = await params;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        callerId: true,
        playbookId: true,
        kind: true,
        status: true,
        startedAt: true,
        endedAt: true,
        metadata: true,
        playbook: { select: { name: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
    }

    if (session.playbookId !== courseId) {
      return NextResponse.json(
        { ok: false, error: "Session does not belong to this course" },
        { status: 403 },
      );
    }

    if (!studentAllowedToReadCaller(authResult.session, session.callerId)) {
      return callerScopeMismatchResponse() as NextResponse<ResultsResponse>;
    }

    const [scores, mapping] = await Promise.all([
      prisma.callScore.findMany({
        where: { call: { sessionId } },
        select: {
          parameterId: true,
          segmentKey: true,
          score: true,
          parameter: { select: { name: true } },
        },
      }),
      getSkillTierMapping(session.playbookId),
    ]);

    type Bucket = { parameterId: string; parameterName: string; segmentKey: string | null; sum: number; count: number };
    const buckets = new Map<string, Bucket>();
    for (const row of scores) {
      const key = `${row.parameterId}::${row.segmentKey ?? ""}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.sum += row.score;
        bucket.count += 1;
      } else {
        buckets.set(key, {
          parameterId: row.parameterId,
          parameterName: row.parameter.name,
          segmentKey: row.segmentKey ?? null,
          sum: row.score,
          count: 1,
        });
      }
    }

    const aggregated: ResultsScore[] = Array.from(buckets.values()).map((b) => {
      const mean = b.sum / b.count;
      const { tier, band } = scoreToTier(mean, mapping);
      return {
        parameterId: b.parameterId,
        parameterName: b.parameterName,
        segmentKey: b.segmentKey,
        score: mean,
        tier,
        band,
        count: b.count,
      };
    });

    // Strength / area — collapse across segments, picking max / min mean band per parameter.
    const perParam = new Map<string, { name: string; bandSum: number; cellCount: number }>();
    for (const cell of aggregated) {
      const existing = perParam.get(cell.parameterId);
      if (existing) {
        existing.bandSum += cell.band;
        existing.cellCount += 1;
      } else {
        perParam.set(cell.parameterId, {
          name: cell.parameterName,
          bandSum: cell.band,
          cellCount: 1,
        });
      }
    }
    const perParamMean = Array.from(perParam.entries())
      .map(([parameterId, v]) => ({
        parameterId,
        parameterName: v.name,
        band: v.bandSum / v.cellCount,
      }))
      .sort((a, b) => b.band - a.band);

    const strength = perParamMean.length > 0 ? perParamMean[0] : null;
    const area = perParamMean.length > 0 ? perParamMean[perParamMean.length - 1] : null;

    const metadata = (session.metadata ?? {}) as SessionMetadata;
    const overallBandFromMeta = typeof metadata.overallBand === "number" ? metadata.overallBand : null;

    let overallBand: number | null = overallBandFromMeta;
    let overallBandSource: ResultsPayload["overallBandSource"] = overallBandFromMeta !== null ? "metadata" : null;
    if (overallBand === null) {
      // #1823 — fallback uses the same canonical helper the pipeline writer
      // uses, so the on-the-fly value and the eventual metadata value cannot
      // disagree on the same input.
      overallBand = computeOverallBandFromScores(
        scores.map((s) => ({ parameterId: s.parameterId, segmentKey: s.segmentKey, score: s.score })),
        mapping,
      );
      if (overallBand !== null) overallBandSource = "computed";
    }

    // `processing` is true until the pipeline has both ended the Session AND
    // landed CallScore rows. STARTED / ACTIVE sessions are always processing;
    // COMPLETED sessions without scores are also processing (pipeline is still
    // running EXTRACT → MEASURE).
    const sessionEnded =
      session.status === "COMPLETED" ||
      session.status === "FAILED" ||
      session.status === "GHOST";
    const processing = !sessionEnded || aggregated.length === 0;

    const payload: ResultsPayload = {
      ok: true,
      processing,
      sessionId: session.id,
      courseId,
      courseTitle: session.playbook?.name ?? null,
      callerId: session.callerId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      status: session.status,
      scores: aggregated,
      overallBand,
      overallBandSource,
      strength: strength
        ? {
            parameterId: strength.parameterId,
            parameterName: strength.parameterName,
            band: roundHalfBand(strength.band),
          }
        : null,
      area: area
        ? {
            parameterId: area.parameterId,
            parameterName: area.parameterName,
            band: roundHalfBand(area.band),
          }
        : null,
      // #1954 — surface the post-Assessment plan written by the
      // AGGREGATE stage. Most sessions will have this null (the
      // trigger only fires when the locked module opted in AND the
      // four-criteria gate fires "complete").
      lessonPlan: metadata.lessonPlan ?? null,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[/api/student/results] error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load results" },
      { status: 500 },
    );
  }
}
