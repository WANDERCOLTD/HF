/**
 * @api GET /api/callers/[callerId]/scheduler-decision
 *
 * "Why this call?" panel data for the Snapshot v3 tab — #1663 (Epic
 * #1606 Group C Phase 2). Returns the scheduler's last recorded
 * decision for the caller so the educator can see the system's
 * reasoning at a glance.
 *
 * Decision 1 (from #1663 grooming): raw `reason` only — surface
 * `{ mode, reason, writtenAt }`. We deliberately do NOT resolve
 * `workingSetAssertionIds` to human-readable LO refs in this slice
 * (that's a follow-on if educators ask). The TL flagged the
 * resolve-vs-raw tradeoff as ~2x effort; raw ships cheap and gets
 * the surface live.
 *
 * Read path: `readSchedulerDecision(callerId)` reads
 * `CallerAttribute[key=scheduler:last_decision, scope=CURRICULUM]`.
 * The decision is written by the pipeline's COMPOSE stage; the panel
 * shows the last one recorded.
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`).
 * STUDENT may read OWN data only; OPERATOR+ may read any caller.
 * Locked per master epic #1577 — Snapshot is STUDENT-readable; the
 * scheduler `reason` is system-generated (not educator-authored
 * interpretation copy) so it's safe for the learner to see.
 */

import { NextResponse } from "next/server";

import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { readSchedulerDecision } from "@/lib/pipeline/scheduler-decision";

export interface SchedulerDecisionView {
  mode: string;
  reason: string;
  writtenAt: string;
}

export interface SchedulerDecisionResponse {
  ok: boolean;
  callerId: string;
  decision: SchedulerDecisionView | null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ callerId: string }> },
): Promise<NextResponse<SchedulerDecisionResponse | { ok: false; error: string }>> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await context.params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const decision = await readSchedulerDecision(callerId);
  if (decision === null) {
    return NextResponse.json({ ok: true, callerId, decision: null });
  }

  return NextResponse.json({
    ok: true,
    callerId,
    decision: {
      mode: decision.mode,
      reason: decision.reason,
      writtenAt: decision.writtenAt,
    },
  });
}
