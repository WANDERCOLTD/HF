// KB: catalogued in docs/kb/guard-registry.md (Slice 5 of epic #1338 — carry-through reconciler).
/**
 * reconcileCarryThrough — Slice 5 of epic #1338.
 *
 * Detects orphan Sessions where:
 *   - `endedAt IS NOT NULL` (session terminated normally — endSession ran)
 *   - `producedComposedPromptId IS NULL` (pipeline never wrote the n+1
 *     prompt — COMPOSE failed silently, the LLM crashed, the dev server
 *     restarted between commit and trigger, etc.)
 *   - the row is older than 60 seconds (the eventual-consistency budget
 *     mirrors `poll-stale-calls.ts:73` `staleAfterMs`)
 *   - `countsTowardPipelineNumber = true` (don't waste cycles on sessions
 *     the pipeline wouldn't have run for anyway — TEXT_CHAT, etc.)
 *
 * For every match the reconciler re-fires the pipeline with
 * `partialFailureMode: "minimal"`. The minimal mode (handled in the
 * pipeline COMPOSE stage runner) skips any transcript-derived stage
 * output, reads the last known `CallerMemory` / `CallerTarget` state
 * (stale OK), and ALWAYS produces a ComposedPrompt — never throws.
 *
 * The reconciler is run every 60 seconds by Cloud Scheduler via
 * `/api/voice/reconcile-carry-through`. Idempotent + best-effort: a
 * Session that's already been reconciled (producedComposedPromptId is
 * non-null) is filtered out by the WHERE clause; concurrent runs from
 * two schedulers see the same orphan set and both try to write — the
 * second write's `updateMany({where:{producedComposedPromptId:null}})`
 * is a no-op.
 *
 * Surfaces:
 *   - I-CT1 invariant (`compose-invariants.ts`) reads this same query and
 *     surfaces the orphan count on every COMPOSE; the reconciler is what
 *     drives that count to zero.
 *   - "↻ reconciled" badge on the Tune tab Session card — driven by
 *     `ComposedPrompt.inputs.partialFailureMode === "minimal"`.
 *   - `scripts/check-fk-consistency.ts` `session-without-composed-prompt`
 *     WARN-only check — forensic visibility into how many orphans survive
 *     >60s past their endedAt.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b (I-CT1 invariant)
 * @see github.com/.../issues/1338 (epic)
 * @see github.com/.../issues/1346 (this slice)
 */

import { prisma } from "@/lib/prisma";
import { carryThroughCompose } from "@/lib/voice/carry-through-compose";

/**
 * Minimum age before a Session is considered an orphan. Mirrors
 * `lib/voice/poll-stale-calls.ts::DEFAULT_STALE_AFTER_MS` so the two
 * reconcilers share a budget.
 */
export const DEFAULT_CARRY_THROUGH_BUDGET_MS = 60 * 1000;

/**
 * Max orphans pulled per cycle. Cloud Scheduler runs every 60s; 50 is
 * enough headroom for a sustained one-orphan-per-second incident without
 * a cycle backing up against itself.
 */
export const DEFAULT_BATCH_LIMIT = 50;

export interface ReconcileBatchResult {
  /** Total orphan Sessions scanned this cycle. */
  scanned: number;
  /** Sessions successfully resolved — producedComposedPromptId is now set. */
  reconciled: number;
  /** Sessions that even the minimal compose fallback failed for. */
  failed: number;
  /** Wall-clock duration of the batch in ms. */
  durationMs: number;
  /** First few failure reasons for ops debug — capped at 5. */
  failureSamples: Array<{ sessionId: string; reason: string }>;
}

export interface ReconcileOptions {
  /** Override the staleness budget (mostly for tests). */
  staleAfterMs?: number;
  /** Override the batch limit (mostly for tests). */
  batchLimit?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/**
 * Run one reconciliation pass. Idempotent + race-safe.
 *
 * The orphan-set query is the canonical I-CT1 invariant query: every
 * `Session(endedAt NOT NULL) WHERE producedComposedPromptId IS NULL AND
 *  countsTowardPipelineNumber = true` older than the budget.
 */
export async function reconcileCarryThrough(
  options: ReconcileOptions = {},
): Promise<ReconcileBatchResult> {
  const startMs = Date.now();
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_CARRY_THROUGH_BUDGET_MS;
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;

  const cutoff = new Date(now().getTime() - staleAfterMs);

  const orphans = await prisma.session.findMany({
    where: {
      endedAt: { lt: cutoff, not: null },
      producedComposedPromptId: null,
      countsTowardPipelineNumber: true,
    },
    select: {
      id: true,
      callerId: true,
      playbookId: true,
      kind: true,
      endedAt: true,
    },
    orderBy: { endedAt: "asc" },
    take: batchLimit,
  });

  const result: ReconcileBatchResult = {
    scanned: orphans.length,
    reconciled: 0,
    failed: 0,
    durationMs: 0,
    failureSamples: [],
  };

  for (const orphan of orphans) {
    try {
      await reconcileOneSession({
        sessionId: orphan.id,
        callerId: orphan.callerId,
        playbookId: orphan.playbookId,
      });
      result.reconciled += 1;
    } catch (err) {
      result.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      // Cap failureSamples so a big batch with one repeating failure mode
      // doesn't bloat the response payload to the scheduler.
      if (result.failureSamples.length < 5) {
        result.failureSamples.push({ sessionId: orphan.id, reason });
      }
      console.error(
        `[reconciler] session ${orphan.id.slice(0, 8)} (caller ${orphan.callerId.slice(0, 8)}) — reconcile failed: ${reason}`,
      );
    }
  }

  result.durationMs = Date.now() - startMs;
  return result;
}

/**
 * Reconcile a single orphan Session with the minimal compose fallback.
 *
 * Pattern: read the I-CT2 cascade (which gives us the prompt this Session
 * SHOULD have run with — or the most-recent ACTIVE for the caller) and
 * write a new `ComposedPrompt(status='active', triggerSessionId=sessionId,
 * inputs.partialFailureMode='minimal')` row carrying that prompt forward.
 * The new row supersedes the prior active for (callerId, playbookId) per
 * the existing `persistComposedPrompt` contract.
 *
 * Why carry forward rather than re-run COMPOSE? Two reasons:
 *   1. The pipeline already failed once for this Session. A second attempt
 *      from the same starting state will likely fail the same way; we'd
 *      hit the same LLM error / pg timeout / OOM that produced the orphan.
 *   2. The user-specified guarantee in #1346 is "Call 6 still uses P5 when
 *      Call 5 fails AND reconciler fails." Carrying the cascade forward is
 *      the structural way to make that guarantee — Call 6's createSession
 *      reads `producedComposedPromptId` on the orphan, finds it now non-
 *      null (pointing at P5 or earlier), and the cascade lands on the
 *      right prompt.
 *
 * The "soft-acknowledge" UI signal lives in `ComposedPrompt.inputs.partialFailureMode`
 * — the Tune tab Session card renders a "↻ reconciled" badge when set.
 *
 * Throws when even step 3 of the I-CT2 cascade (ENROLLMENT bootstrap)
 * returns null — meaning a Session somehow exists for a caller with zero
 * prompt history. The caller is logged and bubbles up to the batch
 * counter as a `failed`. This is the only path that allows a Session to
 * remain orphaned after a reconciler pass.
 */
async function reconcileOneSession(args: {
  sessionId: string;
  callerId: string;
  playbookId: string | null;
}): Promise<void> {
  // The carry-forward write logic lives in `carry-through-compose.ts` so
  // it can be reused by the live pipeline's `partialFailureMode: "minimal"`
  // branch. See that file for the I-CT2-cascade + atomic-Session-flip
  // contract.
  await carryThroughCompose({
    sessionId: args.sessionId,
    callerId: args.callerId,
    playbookId: args.playbookId,
    triggerType: "reconciler",
  });
}
