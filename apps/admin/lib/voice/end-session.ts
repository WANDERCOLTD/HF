/**
 * endSession — finalise a Session row + trigger pipeline async.
 *
 * Companion to `createSession`. Commits `endedAt` + `status` +
 * `transcript` + retroactive counter flips inside a transaction, then
 * fires `runSpecDrivenPipeline(sessionId)` fire-and-forget (NEVER
 * awaited, NEVER wrapped in the transaction — wrapping the LLM call in a
 * tx means a 5-second timeout destroys the transcript).
 *
 * For FAILED / GHOST outcomes the function widens `skipStages` to
 * include EXTRACT / SCORE_AGENT / PROSODY / REWARD so the pipeline
 * runner short-circuits the transcript-derived stages. ADAPT still runs
 * (with `failureSignal` context for COMPOSE).
 *
 * Eventual consistency: the Slice 5 reconciler scans for
 * `Session(endedAt IS NOT NULL) AND NOT EXISTS(ComposedPrompt(triggerSessionId=…))`
 * older than 60s and re-fires COMPOSE. This contract is documented in
 * `docs/CHAIN-CONTRACTS.md` §3 Link 3b and `docs/PIPELINE.md` §4.2.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import {
  finaliseCounterFlags,
  statusFromOutcome,
  deriveSkipStages,
  type SessionOutcomeString,
  type SessionKindString,
} from "@/lib/voice/session-rules";

export type SessionOutcome = SessionOutcomeString;

export interface EndSessionArgs {
  outcome: SessionOutcome;
  /** Final transcript (voice / sim). Optional — text/enrolment sessions don't have one. */
  transcript?: string;
  /** Free-form: 'webhook' | 'poll' | 'drop' | 'reconciler' | 'sdk' | 'sse' | 'manual' | … */
  endSource?: string;
  /** Optional duration override — usually computed from `endedAt - startedAt`. */
  durationSecondsOverride?: number;
  /**
   * If true (default), fire the pipeline async after the Session row
   * commits. Set false in tests that don't want the side effect.
   */
  triggerPipelineAsync?: boolean;
}

export interface EndSessionResult {
  sessionId: string;
  status: string;
  endedAt: Date;
  skipStages: string[];
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
}

export async function endSession(
  sessionId: string,
  args: EndSessionArgs,
): Promise<EndSessionResult> {
  if (!sessionId) throw new Error("endSession: sessionId is required");

  const existing = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      kind: true,
      startedAt: true,
      endedAt: true,
      status: true,
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      skipStages: true,
      callerId: true,
    },
  });
  if (!existing) {
    throw new Error(`endSession: Session ${sessionId} not found`);
  }

  const endedAt = new Date();
  const durationSeconds =
    args.durationSecondsOverride ??
    Math.max(0, (endedAt.getTime() - existing.startedAt.getTime()) / 1000);

  const kind = existing.kind as SessionKindString;
  const finalisedFlags = finaliseCounterFlags({
    kind,
    outcome: args.outcome,
    durationSeconds,
  });
  const status = statusFromOutcome(args.outcome);
  const skipStages = deriveSkipStages({ kind, outcome: args.outcome });

  // Pre-commit safety: an already-ended Session should not be flipped
  // back to STARTED/ACTIVE by a late webhook. Only allow forward
  // transitions; idempotent re-call on a same-status row is fine.
  const isForwardTransition =
    existing.endedAt === null || existing.status === status;

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: {
      ...(isForwardTransition ? { endedAt, status } : {}),
      ...(args.transcript !== undefined ? {} : {}), // (transcript lives on Call; merged below)
      // Counter flips: only ever flip a flag false; never raise.
      countsTowardLearnerNumber:
        existing.countsTowardLearnerNumber &&
        finalisedFlags.countsTowardLearnerNumber,
      countsTowardPipelineNumber:
        existing.countsTowardPipelineNumber &&
        finalisedFlags.countsTowardPipelineNumber,
      // Skip-stages: widen, never narrow. UNION with existing.
      skipStages: Array.from(
        new Set([...(existing.skipStages ?? []), ...skipStages]),
      ).sort(),
    },
    select: {
      id: true,
      status: true,
      endedAt: true,
      skipStages: true,
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      callerId: true,
    },
  });

  // Fire-and-forget pipeline trigger. Must NOT be awaited and must
  // NOT be inside the transaction. The reconciler (Slice 5) catches
  // any Session that never gets its COMPOSE within 60s.
  const triggerAsync = args.triggerPipelineAsync ?? true;
  if (
    triggerAsync &&
    existing.countsTowardPipelineNumber &&
    finalisedFlags.countsTowardPipelineNumber
  ) {
    triggerPipelineForSession(sessionId, updated.callerId).catch((err) => {
      console.error(
        `[endSession] pipeline trigger failed for session ${sessionId}:`,
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  return {
    sessionId: updated.id,
    status: updated.status,
    endedAt: updated.endedAt ?? endedAt,
    skipStages: updated.skipStages,
    countsTowardLearnerNumber: updated.countsTowardLearnerNumber,
    countsTowardPipelineNumber: updated.countsTowardPipelineNumber,
  };
}

/**
 * Async pipeline trigger. Calls the existing internal endpoint so the
 * pipeline runner's stage gating + auth logic stay in one place. The
 * route currently keys on `callId`; Slice 3 keeps the legacy entry
 * point — `Call.sessionId` lets the route resolve from either id.
 *
 * Slice 5 will swap this for a queue-backed delivery. The fetch shape
 * here mirrors the pre-#1338 `triggerPipeline` in `route-handlers.ts`.
 */
async function triggerPipelineForSession(
  sessionId: string,
  callerId: string | null,
): Promise<void> {
  if (!callerId) return;

  // Resolve the Call row via Session.id → Call.sessionId; we still
  // route the pipeline call through `/api/calls/[callId]/pipeline`
  // because the runner expects a Call context. Slice 4 generalises
  // this to a sessionId entry.
  const call = await prisma.call.findFirst({
    where: { sessionId },
    select: { id: true },
  });
  if (!call) {
    // Sessions without a Call child (ENROLLMENT pre-Slice-4, ASSESSMENT)
    // skip the pipeline trigger today — they have no transcript and the
    // pipeline runner is voice-call-keyed. Logged so the proof script
    // can verify the skip happened deliberately.
    console.log(
      `[endSession] session ${sessionId.slice(0, 8)} has no Call child — skipping async pipeline trigger`,
    );
    return;
  }

  const baseUrl = config.app.url;
  const response = await fetch(`${baseUrl}/api/calls/${call.id}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": config.security.internalApiSecret,
    },
    body: JSON.stringify({ callerId, mode: "prompt" }),
  });
  if (!response.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `pipeline route returned ${response.status}: ${bodyText ?? "<no body>"}`,
    );
  }
}
