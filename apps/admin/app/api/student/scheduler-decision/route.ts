/**
 * @api GET /api/student/scheduler-decision
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @desc Returns the most recent scheduler decision for the learner's active
 *   curriculum so the SimProgressPanel "Today's call" section can show why
 *   the next call is set to teach / review / assess / practice. Returns
 *   `{ ok: true, decision: null }` (never 404) when there is no decision yet,
 *   when the stored decision is stale relative to the most recent call, or
 *   when the learner is in 2+ active CallerPlaybook rows.
 *
 * Multi-course learners are NOT supported until #919 (writer-side fix): the
 * `CallerAttribute` unique key is `(callerId, key, scope)` with no
 * curriculumId, so two pipelines race-clobber the row. The 2+-active guard
 * below is the defensive read-side mitigation — see issue #917 Tech Lead
 * resolution (2026-05-27).
 *
 * Internal scheduler fields (`outcomeId`, `contentSourceId`,
 * `workingSetAssertionIds`) are never returned. `reason` is run through
 * `sanitizeReason()` to strip UUIDs, spec slugs, and tag-shaped content.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { readSchedulerDecision } from "@/lib/pipeline/scheduler-decision";
import { sanitizeReason } from "@/lib/scheduler/sanitize-reason";
import type { SchedulerMode } from "@/lib/pipeline/scheduler-decision";

interface PublicSchedulerDecision {
  mode: SchedulerMode;
  reason: string | null;
  callsSinceAssess: number | null;
  writtenAt: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;

  // Multi-curriculum guard: if the caller has 2+ ACTIVE CallerPlaybook rows,
  // the single `scheduler:last_decision` attribute is shared across pipelines
  // and untrustworthy until #919 lands. Hide the section.
  const activePlaybookCount = await prisma.callerPlaybook.count({
    where: { callerId, status: "ACTIVE" },
  });
  if (activePlaybookCount > 1) {
    return NextResponse.json({ ok: true, decision: null });
  }

  const decision = await readSchedulerDecision(callerId);
  if (!decision) {
    return NextResponse.json({ ok: true, decision: null });
  }

  // Stale check — if the most recent ended call is newer than the decision,
  // the scheduler hasn't written a fresh decision for this caller yet (e.g.
  // the next pipeline run is still pending). Hide rather than show stale.
  const lastCall = await prisma.call.findFirst({
    where: { callerId, endedAt: { not: null } },
    orderBy: { endedAt: "desc" },
    select: { endedAt: true },
  });
  if (lastCall?.endedAt) {
    const writtenAt = new Date(decision.writtenAt);
    if (Number.isFinite(writtenAt.getTime()) && writtenAt < lastCall.endedAt) {
      return NextResponse.json({ ok: true, decision: null });
    }
  }

  const sanitizedReason = sanitizeReason(decision.reason ?? "");

  const publicDecision: PublicSchedulerDecision = {
    mode: decision.mode,
    reason: sanitizedReason,
    callsSinceAssess:
      typeof decision.callsSinceAssess === "number"
        ? decision.callsSinceAssess
        : null,
    writtenAt: decision.writtenAt,
  };

  return NextResponse.json({ ok: true, decision: publicDecision });
}
