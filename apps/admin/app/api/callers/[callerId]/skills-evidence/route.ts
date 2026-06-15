/**
 * @api GET /api/callers/[callerId]/skills-evidence
 *
 * Per-learner sibling to `/api/courses/[courseId]/skills-evidence` (PR #1576).
 * Returns the most recent N `BehaviorMeasurement.evidence` excerpts per
 * skill for ONE learner across all their calls.
 *
 * Powers SP4-B Attainment tab's per-skill evidence expand: educator clicks
 * a skill row → sees 3 most-recent transcript excerpts the AI tutor cited
 * when scoring that learner on that skill.
 *
 * Auth: VIEWER + path-param scope guard. STUDENT may read OWN data only
 * via `studentAllowedToReadCaller` (mirrors `snapshot/route.ts:30-32`).
 * OPERATOR+ may read any caller.
 *
 * Resolves the learner's playbook via the most-recent `CallerPlaybook`
 * enrolment, then runs the same per-skill bounded query as the cohort
 * route but filtered to `call.callerId = ?`. Hard limit cap of 10 keeps
 * fanout bounded.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";

export interface CallerSkillEvidenceItem {
  callId: string;
  measuredAt: string;
  score: number;
  confidence: number;
  excerpts: string[];
  // Wave A2 — score-provenance fields lifted from the sibling CallScore
  // row via (callId, parameterId). Surfaces what ProgressTab v1's
  // ScoresSection used to show in its score-detail expander, so the
  // Attainment Evidence Panel can replace it before that legacy tab
  // retires. All optional — legacy paths (mock engine, manual scoring)
  // may not have CallScore rows or may leave individual fields null.
  reasoning: string | null;
  analysisSpecName: string | null;
  hasLearnerEvidence: boolean | null;
  evidenceQuality: number | null;
  scoredBy: string | null;
}

export interface CallerSkillEvidenceRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  evidence: CallerSkillEvidenceItem[];
}

export interface CallerSkillEvidenceResponse {
  callerId: string;
  playbookId: string | null;
  limit: number;
  rows: CallerSkillEvidenceRow[];
  empty: boolean;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;

  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  // STUDENT may read own data only; OPERATOR+ passes through.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Most-recent enrolment is the playbook scope. If the learner is on
  // multiple, callers can pass `?playbookId=...` to disambiguate.
  const requestedPlaybookId = url.searchParams.get("playbookId");
  const enrolment = requestedPlaybookId
    ? await prisma.callerPlaybook.findFirst({
        where: { callerId, playbookId: requestedPlaybookId },
        select: { playbookId: true },
      })
    : await prisma.callerPlaybook.findFirst({
        where: { callerId },
        select: { playbookId: true },
        orderBy: { createdAt: "desc" },
      });

  if (!enrolment) {
    const response: CallerSkillEvidenceResponse = {
      callerId,
      playbookId: null,
      limit,
      rows: [],
      empty: true,
    };
    return NextResponse.json(response);
  }

  const playbookId = enrolment.playbookId;
  const skills = await resolveAllSkillsForPlaybook(playbookId);
  if (skills.length === 0) {
    return NextResponse.json({
      callerId,
      playbookId,
      limit,
      rows: [],
      empty: true,
    } satisfies CallerSkillEvidenceResponse);
  }

  const parameters = await prisma.parameter.findMany({
    where: { parameterId: { in: skills.map((s) => s.parameterId) } },
    select: { parameterId: true, name: true },
  });
  const paramName = new Map(parameters.map((p) => [p.parameterId, p.name]));

  // Per-skill bounded fetch — uses @@index([parameterId]) + @@index([measuredAt]).
  // N skills × 1 indexed seek = small even when called repeatedly.
  // Wave A2 — also pulls the sibling CallScore row for each
  // (callId, parameterId) so the Evidence Panel can render reasoning +
  // analysisSpec provenance + #566 hasLearnerEvidence/evidenceQuality
  // badges in place of the now-retiring ProgressTab v1 ScoresSection.
  const rows: CallerSkillEvidenceRow[] = await Promise.all(
    skills.map(async (s) => {
      const measurements = await prisma.behaviorMeasurement.findMany({
        where: {
          parameterId: s.parameterId,
          call: { callerId },
        },
        select: {
          actualValue: true,
          confidence: true,
          evidence: true,
          measuredAt: true,
          callId: true,
        },
        orderBy: { measuredAt: "desc" },
        take: limit,
      });
      const callIds = measurements.map((m) => m.callId);
      const callScores =
        callIds.length === 0
          ? []
          : await prisma.callScore.findMany({
              where: {
                callId: { in: callIds },
                parameterId: s.parameterId,
              },
              select: {
                callId: true,
                reasoning: true,
                hasLearnerEvidence: true,
                evidenceQuality: true,
                scoredBy: true,
                analysisSpec: { select: { name: true } },
              },
            });
      const scoreByCall = new Map(callScores.map((cs) => [cs.callId, cs]));
      return {
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: paramName.get(s.parameterId) ?? s.parameterId,
        evidence: measurements.map((m) => {
          const cs = scoreByCall.get(m.callId);
          return {
            callId: m.callId,
            measuredAt: m.measuredAt.toISOString(),
            score: m.actualValue,
            confidence: m.confidence,
            excerpts: m.evidence,
            reasoning: cs?.reasoning ?? null,
            analysisSpecName: cs?.analysisSpec?.name ?? null,
            hasLearnerEvidence: cs?.hasLearnerEvidence ?? null,
            evidenceQuality: cs?.evidenceQuality ?? null,
            scoredBy: cs?.scoredBy ?? null,
          };
        }),
      };
    }),
  );

  return NextResponse.json({
    callerId,
    playbookId,
    limit,
    rows,
    empty: false,
  } satisfies CallerSkillEvidenceResponse);
}
