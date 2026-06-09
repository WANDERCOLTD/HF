/**
 * record-call-failure.ts
 *
 * #1340 (epic #1338 Slice 1) — single chokepoint for converting a
 * mid-dial outbound failure into a typed FailureLog + FAILED Session,
 * preserving the placeholder Call row so the Tune tab can render a
 * FAILED card.
 *
 * Replaces three `prisma.call.delete` sites in
 * `app/api/voice/calls/outbound-dial/route.ts` (phone validation,
 * VAPI non-2xx response, VAPI fetch throw).
 *
 * Why a separate module:
 *   - The outbound-dial route's `try` block is long; inlining the
 *     three Session + FailureLog write sites would triple its size and
 *     hide the error-path narrative.
 *   - Slice 5 (reconciler worker) will need the same shape. Keeping
 *     the helper here lets that slice import without re-implementing.
 *   - The poll-stale-calls.ts ghost-detection branch uses a sibling
 *     pattern; both helpers may merge in Slice 5 once `createSession`
 *     lands a canonical builder.
 *
 * Contract:
 *   - Always tries to mint a Session if the Call has no `sessionId`.
 *   - Always writes a FailureLog (best-effort — DB exception logged but
 *     never thrown — the outbound-dial route is already returning an
 *     error response, throwing here would mask the original cause).
 *   - Never deletes the Call row. Slice 1 keeps the placeholder so the
 *     Tune tab can render a FAILED card. The pre-#1340 delete-and-vanish
 *     behaviour is what made Bertie's 10:06:02 ghost invisible.
 *
 * Idempotency: re-running with the same callId increments
 * `FailureLog.attemptNumber` by counting prior rows for the same
 * (sessionId, kind) pair. The Call row's `endedAt` + `endSource` are
 * set under a guard so a webhook landing during this write wins.
 */

import { prisma } from "@/lib/prisma";

const FAILURE_SESSION_SKIP_STAGES: readonly string[] = [
  "EXTRACT",
  "SCORE_AGENT",
  "PROSODY",
  "REWARD",
];

export type CallFailureKind =
  | "VAPI_502"
  | "OUTBOUND_DIAL_FAILED"
  | "GHOST_NEVER_CONNECTED"
  | "INTAKE_SCHEMA_FAIL"
  | string; // open-ended — schema column is `String`, not enum.

export interface RecordCallFailureArgs {
  callId: string;
  kind: CallFailureKind;
  errorPayload: Record<string, unknown>;
}

export interface RecordCallFailureResult {
  sessionId: string | null;
  sessionCreated: boolean;
  failureLogCreated: boolean;
}

/**
 * Record a typed failure against a Call: mark its parent Session
 * FAILED (mint one if missing) and write a FailureLog child.
 *
 * Best-effort. Returns `{ failureLogCreated: false }` rather than
 * throwing when:
 *   - Call row no longer exists (e.g., a previous cleanup beat us)
 *   - Call has no callerId (synthetic / harness Calls — can't mint a
 *     Session because Session.callerId is NOT NULL)
 *   - DB exception while writing
 */
export async function recordCallFailure(
  args: RecordCallFailureArgs,
): Promise<RecordCallFailureResult> {
  let sessionCreated = false;
  let failureLogCreated = false;
  let sessionId: string | null = null;

  try {
    const call = await prisma.call.findUnique({
      where: { id: args.callId },
      select: {
        id: true,
        callerId: true,
        sessionId: true,
        createdAt: true,
        playbookId: true,
      },
    });
    if (!call) {
      return { sessionId: null, sessionCreated: false, failureLogCreated: false };
    }

    sessionId = call.sessionId;

    // 1. Ensure a parent Session row. Mint one with status=FAILED if
    //    the Call doesn't already have a sessionId.
    if (!sessionId) {
      if (!call.callerId) {
        // Can't satisfy Session.callerId NOT NULL — bail. Mark the Call
        // ended so the Tune tab can at least show it as terminal.
        await markCallFailed(call.id, args.kind);
        return { sessionId: null, sessionCreated: false, failureLogCreated: false };
      }
      const last = await prisma.session.findFirst({
        where: { callerId: call.callerId, kind: "VOICE_CALL" },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      const nextSeq = (last?.sequenceNumber ?? 0) + 1;

      const created = await prisma.session.create({
        data: {
          callerId: call.callerId,
          playbookId: call.playbookId,
          kind: "VOICE_CALL",
          sequenceNumber: nextSeq,
          status: "FAILED",
          startedAt: call.createdAt,
          endedAt: new Date(),
          skipStages: [...FAILURE_SESSION_SKIP_STAGES],
          countsTowardLearnerNumber: false,
          countsTowardPipelineNumber: true,
        },
        select: { id: true },
      });
      sessionId = created.id;
      sessionCreated = true;

      // Link the Call back to its parent. Use updateMany so the
      // `sessionId IS NULL` guard against a webhook landing during this
      // write window is enforceable (Prisma narrow `update` rejects
      // null-valued conditions in `where`).
      try {
        await prisma.call.updateMany({
          where: { id: call.id, sessionId: null },
          data: { sessionId },
        });
      } catch {
        // P2025 — Call already linked. Fine; FailureLog still lands.
      }
    } else {
      // Session exists — flip its status to FAILED if it's still
      // STARTED/ACTIVE. Don't clobber COMPLETED (a webhook may have
      // landed late).
      try {
        await prisma.session.updateMany({
          where: {
            id: sessionId,
            status: { in: ["STARTED", "ACTIVE"] },
          },
          data: { status: "FAILED", endedAt: new Date() },
        });
      } catch (err) {
        console.error(
          `[record-call-failure] failed to mark Session ${sessionId} FAILED:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // 2. Mark the Call row terminal (preserves the placeholder so the
    //    Tune tab can render a FAILED card). Guard against a webhook
    //    that already landed during this write window.
    await markCallFailed(call.id, args.kind);

    // 3. Write the FailureLog child. attemptNumber stacks for retry
    //    loops (one Session, multiple FailureLog rows).
    const priorFailures = await prisma.failureLog.count({
      where: { sessionId, kind: args.kind },
    });
    await prisma.failureLog.create({
      data: {
        sessionId,
        kind: args.kind,
        attemptNumber: priorFailures + 1,
        errorPayload: args.errorPayload as object,
      },
    });
    failureLogCreated = true;

    return { sessionId, sessionCreated, failureLogCreated };
  } catch (err) {
    console.error(
      `[record-call-failure] best-effort write failed for call ${args.callId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { sessionId, sessionCreated, failureLogCreated };
  }
}

/**
 * Mark a Call row as terminally failed without clobbering an in-flight
 * webhook (`endedAt: null` guard). Stores the failure kind in
 * `voiceEndedReason` so analytics + the Tune tab can label the row.
 */
async function markCallFailed(
  callId: string,
  kind: CallFailureKind,
): Promise<void> {
  try {
    // updateMany so the `endedAt IS NULL` guard against an in-flight
    // webhook is enforceable in the WHERE clause (Prisma `update`
    // rejects null-valued conditions on nullable columns).
    await prisma.call.updateMany({
      where: { id: callId, endedAt: null },
      data: {
        endedAt: new Date(),
        endSource: "discard",
        voiceEndedReason: `failure:${kind.toLowerCase()}`,
      },
    });
  } catch {
    // No-op — pure best-effort sentinel.
  }
}
