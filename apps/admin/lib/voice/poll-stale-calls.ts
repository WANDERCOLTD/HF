/**
 * Poll fallback for missing voice-call end-of-call webhooks (#1178).
 *
 * Some VAPI calls fail on VAPI's side without emitting the normal
 * end-of-call webhook — `pipeline-error-openai-llm-failed`, network
 * blips, infra hiccups. HF stays at `endedAt: null` indefinitely; the
 * dev log shows nothing; the operator has no signal. This job closes
 * the loop:
 *
 *   1. Find `Call` rows where `externalId IS NOT NULL`, `endedAt IS NULL`,
 *      and the row is at least 90 seconds old (webhook budget).
 *   2. For each, call VAPI's `GET /call/{externalId}` using the VAPI
 *      provider's apiKey.
 *   3. If VAPI reports the call as `ended`, normalise via the VAPI
 *      adapter's `normaliseEndOfCallEvent` (same path the webhook
 *      uses), then persist via `persistEndOfCall(event, slug, { sourceTag:
 *      "fallback" })`. Sets `voiceProviderRaw.pollSource = "fallback"`
 *      and uses an atomic update so a webhook racing the poll wins.
 *   4. On VAPI 429: abort the batch early — backoff is the next
 *      batch's concern. Returns `abortedOn429: true`.
 *   5. On VAPI 404 (call genuinely doesn't exist) or persistent auth
 *      errors: mark the Call with `voiceEndedReason: "vapi_poll_failed"`
 *      and `endedAt: NOW` so the row stops re-polling forever.
 *
 * Concurrency: `p-limit(3)` — VAPI's documented rate limit is 100 RPM;
 * with batch-aborts on 429 we stay well below. `getSpeechAssessmentProvider`
 * isn't called here — this is pure end-of-call merge.
 *
 * Idempotency: every persistence path uses `where: { id, endedAt: null }`
 * via `persistEndOfCall(..., {sourceTag:"fallback"})` so a webhook
 * landing during the poll cycle wins cleanly. `skippedRace: true` on
 * the result means "webhook beat us, no-op success".
 *
 * Telemetry: per-call → `logVoiceEvent({slug:"vapi", operation:"poll_stale_call"})`.
 * Batch summary → `logVoiceEvent({slug:"vapi", operation:"poll_batch"})`.
 *
 * Out of scope here: scheduling. Run via the API route at
 * `app/api/voice/poll-stale-calls/route.ts` from Cloud Scheduler or
 * cron — see `docs/CLOUD-DEPLOYMENT.md` for setup.
 */

import pLimit from "p-limit";

import { prisma } from "@/lib/prisma";

import { persistEndOfCall } from "@/lib/voice/route-handlers";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { logVoiceEvent } from "@/lib/voice/telemetry";

export interface PollBatchResult {
  /** Total stale rows considered for polling this cycle. */
  stale: number;
  /** Rows we attempted to fetch from VAPI. */
  attempted: number;
  /** Rows successfully merged (poll-derived persistence). */
  recovered: number;
  /** Rows that lost the race to a webhook landing during the cycle. */
  racedAgainstWebhook: number;
  /** Rows VAPI couldn't find (404) — marked `vapi_poll_failed`. */
  notFound: number;
  /** Rows where VAPI returned auth error (401/403). */
  authFailed: number;
  /** Rows where VAPI returned 5xx — kept for next batch. */
  upstreamErrors: number;
  /** True when a 429 caused us to bail mid-batch. */
  abortedOn429: boolean;
  /** Calls actually attempted before the abort. */
  pollsCompleted: number;
  /** #1340 — FailureLog rows written by ghost detection this cycle. */
  failureLogsWritten: number;
  /** #1340 — Session(status=GHOST) rows minted this cycle (Call had no parent). */
  ghostSessionsCreated: number;
  durationMs: number;
}

interface PollOptions {
  /** How long the row must have been stale before we poll. Default 90s. */
  staleAfterMs?: number;
  /** Max rows in a single batch. Default 50. */
  batchLimit?: number;
  /** Concurrent VAPI fetches. Default 3. */
  concurrency?: number;
  /** Provider slug to poll (only `"vapi"` today). Future-proofs the
   *  shape so a Retell poll can reuse the same orchestration. */
  slug?: string;
}

const DEFAULT_STALE_AFTER_MS = 90 * 1000;
const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_CONCURRENCY = 3;
const VAPI_BASE_URL = "https://api.vapi.ai";

// #1340 — pipeline stages that have no usable input on a ghost Session.
// Set at Session-create time so Slice 5's read-side gate can short-circuit
// the stage runners. The list mirrors §4.2's "FAILURE → skip" column:
// EXTRACT/SCORE_AGENT/PROSODY/REWARD all require a transcript that a
// ghost (never connected) Session never produced.
const FAILURE_SESSION_SKIP_STAGES: readonly string[] = [
  "EXTRACT",
  "SCORE_AGENT",
  "PROSODY",
  "REWARD",
];

/**
 * Run one polling pass. Idempotent + race-safe.
 */
export async function pollStaleVoiceCalls(
  options: PollOptions = {},
): Promise<PollBatchResult> {
  const startMs = Date.now();
  const slug = options.slug ?? "vapi";
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const cutoff = new Date(Date.now() - staleAfterMs);

  const staleRows = await prisma.call.findMany({
    where: {
      externalId: { not: null },
      endedAt: null,
      source: slug,
      createdAt: { lt: cutoff },
    },
    // #1340 — `callerId`, `sessionId`, `createdAt`, `playbookId` added so
    // the ghost-detection branch can attach a FailureLog to the parent
    // Session (or mint one if missing).
    select: {
      id: true,
      externalId: true,
      callerId: true,
      sessionId: true,
      createdAt: true,
      playbookId: true,
    },
    take: batchLimit,
    orderBy: { createdAt: "asc" },
  });

  const result: PollBatchResult = {
    stale: staleRows.length,
    attempted: 0,
    recovered: 0,
    racedAgainstWebhook: 0,
    notFound: 0,
    authFailed: 0,
    upstreamErrors: 0,
    abortedOn429: false,
    pollsCompleted: 0,
    failureLogsWritten: 0,
    ghostSessionsCreated: 0,
    durationMs: 0,
  };

  if (staleRows.length === 0) {
    result.durationMs = Date.now() - startMs;
    void logVoiceEvent({
      slug,
      operation: "poll_batch",
      durationMs: result.durationMs,
      metadata: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  // Resolve VAPI apiKey + adapter once per batch.
  const providerRow = await prisma.voiceProvider.findUnique({
    where: { slug },
    select: { credentials: true, enabled: true },
  });
  if (!providerRow || !providerRow.enabled) {
    result.durationMs = Date.now() - startMs;
    void logVoiceEvent({
      slug,
      operation: "poll_batch",
      durationMs: result.durationMs,
      errorMessage: `provider ${slug} not enabled`,
      metadata: result as unknown as Record<string, unknown>,
    });
    return result;
  }
  const creds = (providerRow.credentials ?? {}) as Record<string, unknown>;
  const apiKey = typeof creds.apiKey === "string" ? creds.apiKey : "";
  if (!apiKey) {
    result.durationMs = Date.now() - startMs;
    void logVoiceEvent({
      slug,
      operation: "poll_batch",
      durationMs: result.durationMs,
      errorMessage: "apiKey missing",
      metadata: result as unknown as Record<string, unknown>,
    });
    return result;
  }
  const adapter = await getVoiceProvider(slug);

  const limit = pLimit(concurrency);
  let aborted = false;

  const tasks = staleRows.map((row) =>
    limit(async () => {
      if (aborted) return;
      result.attempted += 1;
      const perStart = Date.now();

      let fetchRes: Response;
      try {
        fetchRes = await fetch(`${VAPI_BASE_URL}/call/${row.externalId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
      } catch (err) {
        result.upstreamErrors += 1;
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: { stage: "fetch", externalId: row.externalId },
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      if (fetchRes.status === 429) {
        aborted = true;
        result.abortedOn429 = true;
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: { stage: "rate_limited", externalId: row.externalId },
          errorMessage: "429 from VAPI — batch aborted",
        });
        return;
      }

      if (fetchRes.status === 404) {
        result.notFound += 1;
        // Permanent: mark the row failed so it stops polling.
        await markPollFailed(row.id, "not_found_in_vapi");

        // #1340 (epic #1338 Slice 1) — typed ghost detection.
        //
        // The Call placeholder was minted, an externalId was stamped, and
        // VAPI now reports "never heard of it" — exactly the ghost-class
        // bug from Bertie Tallstaff 10:06:02 on hf_sandbox 2026-06-08.
        // Pre-Slice 1 this row sat invisible in the Tune tab; now we
        // surface it as a typed FailureLog so the operator can see it
        // and ADAPT can soft-acknowledge.
        const ghostWrite = await writeGhostFailureLog(row, "not_found_in_vapi");
        if (ghostWrite.sessionCreated) result.ghostSessionsCreated += 1;
        if (ghostWrite.failureLogCreated) result.failureLogsWritten += 1;

        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: {
            stage: "vapi_404",
            externalId: row.externalId,
            failureLogCreated: ghostWrite.failureLogCreated,
            sessionCreated: ghostWrite.sessionCreated,
          },
          errorMessage: "VAPI returned 404",
        });
        return;
      }

      if (fetchRes.status === 401 || fetchRes.status === 403) {
        result.authFailed += 1;
        // NOT permanently marked — apiKey may be rotating. Future
        // polls will retry. Operator alert is the right signal here.
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: {
            stage: "auth_failed",
            externalId: row.externalId,
            status: fetchRes.status,
          },
          errorMessage: `VAPI ${fetchRes.status} — check apiKey`,
        });
        return;
      }

      if (!fetchRes.ok) {
        result.upstreamErrors += 1;
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: {
            stage: "vapi_5xx",
            externalId: row.externalId,
            status: fetchRes.status,
          },
          errorMessage: `VAPI ${fetchRes.status}`,
        });
        return;
      }

      const body = await fetchRes.json().catch(() => null);
      if (!body || typeof body !== "object") {
        result.upstreamErrors += 1;
        return;
      }

      // Only persist when VAPI says the call is actually over.
      const vapiStatus = (body as { status?: string }).status;
      if (vapiStatus !== "ended") {
        // Still ringing / in-progress — leave for the next batch.
        return;
      }

      const normalised = adapter.normaliseEndOfCallEvent({ message: body });
      if (!normalised) {
        result.upstreamErrors += 1;
        return;
      }

      try {
        const persistResult = await persistEndOfCall(normalised, slug, {
          sourceTag: "fallback",
        });
        if (persistResult.skippedRace) {
          result.racedAgainstWebhook += 1;
        } else {
          result.recovered += 1;
        }
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: {
            stage: "merged",
            externalId: row.externalId,
            endedReason:
              normalised.capture.endedReason ?? null,
            skippedRace: persistResult.skippedRace === true,
          },
        });
      } catch (err) {
        result.upstreamErrors += 1;
        void logVoiceEvent({
          slug,
          operation: "poll_stale_call",
          durationMs: Date.now() - perStart,
          callId: row.id,
          metadata: { stage: "persist_failed", externalId: row.externalId },
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      } finally {
        result.pollsCompleted += 1;
      }
    }),
  );

  await Promise.all(tasks);

  result.durationMs = Date.now() - startMs;
  void logVoiceEvent({
    slug,
    operation: "poll_batch",
    durationMs: result.durationMs,
    metadata: result as unknown as Record<string, unknown>,
  });
  return result;
}

/**
 * #1340 (epic #1338 Slice 1) — write a FailureLog(GHOST_NEVER_CONNECTED)
 * row attached to the Call's parent Session. Creates the Session row if
 * the Call has no `sessionId` (pre-Slice 0 backfill rows or live
 * outbound-dial placeholders pending Slice 3 wiring).
 *
 * Idempotent. Best-effort — a Postgres exception is logged but does not
 * throw upstream (the markPollFailed contract is "stop polling forever",
 * not "stop polling unless FailureLog write fails").
 *
 * Returns `{ sessionCreated, failureLogCreated }` so the batch result
 * can attribute counters honestly.
 */
async function writeGhostFailureLog(
  row: {
    id: string;
    externalId: string | null;
    callerId: string | null;
    sessionId: string | null;
    createdAt: Date;
    playbookId: string | null;
  },
  reason: "not_found_in_vapi",
): Promise<{ sessionCreated: boolean; failureLogCreated: boolean }> {
  let sessionCreated = false;
  let sessionId = row.sessionId;

  try {
    // 1. Ensure a parent Session row exists. Pre-Slice 0 backfill rows
    //    were given one by the migration; live outbound-dial placeholders
    //    do NOT have one until Slice 3 wires `createSession` into the
    //    builder. We mint a minimal Session here so the FailureLog FK
    //    can land — `kind=VOICE_CALL`, `status=GHOST`, `skipStages=[…]`.
    //
    //    `callerId` is the only hard requirement (Session.callerId is
    //    NOT NULL with onDelete: Restrict). If the Call has no caller
    //    we can't mint a Session — log and bail (no FailureLog either).
    if (!sessionId) {
      if (!row.callerId) {
        return { sessionCreated: false, failureLogCreated: false };
      }
      // Sequence number bootstrap — read MAX(sequenceNumber) for this
      // (callerId, kind) and increment. Slice 3 replaces this with the
      // atomic `CallerSequenceCounter` UPDATE RETURNING; in Slice 1 the
      // race is acceptable because the poll-cron runs serially.
      const last = await prisma.session.findFirst({
        where: { callerId: row.callerId, kind: "VOICE_CALL" },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      const nextSeq = (last?.sequenceNumber ?? 0) + 1;

      const created = await prisma.session.create({
        data: {
          callerId: row.callerId,
          playbookId: row.playbookId,
          kind: "VOICE_CALL",
          sequenceNumber: nextSeq,
          status: "GHOST",
          startedAt: row.createdAt,
          endedAt: new Date(),
          // Ghost sessions never produced a transcript — skip every
          // stage that consumes one. Slice 5 wires the read side.
          skipStages: [...FAILURE_SESSION_SKIP_STAGES],
          // Ghosts don't count toward the learner-facing call counter
          // (epic #1338 §"Class-by-class rules"); they DO count toward
          // the pipeline-number so ADAPT/COMPOSE still run.
          countsTowardLearnerNumber: false,
          countsTowardPipelineNumber: true,
        },
        select: { id: true },
      });
      sessionId = created.id;
      sessionCreated = true;

      // Link the Call back to its parent Session. updateMany so the
      // `sessionId IS NULL` guard against a webhook landing during the
      // poll cycle is enforceable in the WHERE clause (Prisma `update`
      // rejects null on nullable columns in a unique-where).
      try {
        await prisma.call.updateMany({
          where: { id: row.id, sessionId: null },
          data: { sessionId },
        });
      } catch {
        // Webhook beat us. The FailureLog still attaches to the
        // Session we just created; the Call link gets reconciled by
        // Slice 5.
      }
    }

    // 2. Write the FailureLog child. attemptNumber = (existing rows for
    //    this sessionId/kind pair) + 1, so a retry loop stacks cleanly.
    const priorFailures = await prisma.failureLog.count({
      where: { sessionId, kind: "GHOST_NEVER_CONNECTED" },
    });

    await prisma.failureLog.create({
      data: {
        sessionId,
        kind: "GHOST_NEVER_CONNECTED",
        attemptNumber: priorFailures + 1,
        errorPayload: {
          callId: row.id,
          externalId: row.externalId,
          reason,
          ageSeconds: Math.round((Date.now() - row.createdAt.getTime()) / 1000),
          detectedBy: "poll-stale-calls",
        },
      },
    });

    return { sessionCreated, failureLogCreated: true };
  } catch (err) {
    // Best-effort — don't break the poll batch.
    console.error(
      `[poll-stale-calls] failed to write ghost FailureLog for call ${row.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { sessionCreated, failureLogCreated: false };
  }
}

/**
 * Mark a Call permanently as poll-failed so it stops getting re-polled
 * every cycle. Uses the atomic guard so a winning webhook can't be
 * overwritten by this sentinel.
 */
async function markPollFailed(
  callId: string,
  reason: "not_found_in_vapi",
): Promise<void> {
  try {
    await prisma.call.update({
      where: { id: callId, endedAt: null },
      data: {
        voiceEndedReason: "vapi_poll_failed",
        endedAt: new Date(),
        // #1241 — tag the row so analytics + UI labelling can tell
        // "we found you stale on the cron" from "you hung up the phone".
        endSource: "poll",
        voiceProviderRaw: { pollSource: "fallback", pollFailureReason: reason },
      },
    });
  } catch {
    // P2025 — race lost to a webhook. Don't care.
  }
}
