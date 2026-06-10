// KB: catalogued in docs/kb/guard-registry.md (#1420 — bootstrap-compose at enrollment).
/**
 * reconcileMissingBootstrap — Slice 5-adjacent enrollment-bootstrap scan.
 *
 * Sister to `reconcileCarryThrough` (`lib/voice/reconciler.ts`). Both run
 * from the same `/api/voice/reconcile-carry-through` cron route, both
 * fire every 60s, but they detect DIFFERENT failure modes:
 *
 *   - `reconcileCarryThrough` — ENDED Session with no produced prompt
 *     (post-session COMPOSE crashed). Re-fires the cascade via
 *     `carryThroughCompose`.
 *
 *   - `reconcileMissingBootstrap` (THIS FILE) — ACTIVE `CallerPlaybook`
 *     enrollment with no `ComposedPrompt(status='active')`. Means the
 *     post-tx auto-compose hook (in `/api/join/[token]` / `/api/invite/accept`)
 *     failed to fire — process crash between enrolment commit and the
 *     fire-and-forget hook, timeout in compose, etc. Re-fires
 *     `autoComposeForCaller`.
 *
 * Per TL revision #1420: this scan is a SEPARATELY-NAMED export, NOT
 * inlined into `reconcileCarryThrough`. The two queries have different
 * triggering conditions and live in their own files for clarity. Both
 * are wired into the same 60s cron handler so a single Cloud Scheduler
 * job covers both backstops.
 *
 * Staleness window: 5 minutes by default (vs 60s for carry-through).
 * Rationale: post-tx auto-compose itself takes 1-3s; calling within the
 * first 60s would race a legitimately-in-flight first compose. Five
 * minutes is conservative — a caller who hits "call now" inside that
 * window still gets the `[CRITICAL]` log + `build-assistant-config.ts`
 * fallback safety net.
 *
 * @see lib/enrollment/auto-compose.ts (the helper this reconciler fires)
 * @see lib/voice/reconciler.ts (sister scan, runs from same cron)
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b (I-CT2 invariant)
 * @see github.com/.../issues/1420 (this story)
 */

import { prisma } from "@/lib/prisma";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";

/**
 * Minimum age of an ACTIVE enrollment before it's considered a candidate
 * for the bootstrap reconciler. 5 minutes — long enough for the post-tx
 * auto-compose to have run + persisted; short enough to repair the gap
 * before the caller dials.
 */
export const DEFAULT_MISSING_BOOTSTRAP_BUDGET_MS = 5 * 60 * 1000;

/**
 * Max enrollments processed per cycle. Cron runs every 60s; 50 is plenty
 * of headroom — at scale the post-tx hook does the real work, and this
 * scan only catches the edge cases.
 */
export const DEFAULT_BOOTSTRAP_BATCH_LIMIT = 50;

export interface BootstrapReconcileBatchResult {
  /** Total ACTIVE enrollments scanned this cycle. */
  scanned: number;
  /** Enrollments that triggered an autoCompose fire. */
  composed: number;
  /** Enrollments whose autoCompose call rejected. */
  failed: number;
  /** Wall-clock duration of the batch in ms. */
  durationMs: number;
  /** First few failure reasons for ops debug — capped at 5. */
  failureSamples: Array<{ callerId: string; playbookId: string; reason: string }>;
}

export interface BootstrapReconcileOptions {
  /** Override the staleness budget (mostly for tests). */
  staleAfterMs?: number;
  /** Override the batch limit (mostly for tests). */
  batchLimit?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/**
 * Run one bootstrap-reconciliation pass. Idempotent + race-safe.
 *
 * Find every ACTIVE `CallerPlaybook` enrolled longer than the budget
 * which has NO `ComposedPrompt(callerId, playbookId, status='active')`.
 * For each match, fire `autoComposeForCaller(callerId, playbookId)`
 * inline (NOT fire-and-forget — we want the success/failure counts in
 * the batch result for ops observability).
 *
 * `autoComposeForCaller` has its own staleness short-circuit, so a
 * concurrent reconciler run that beat us here is harmless.
 */
export async function reconcileMissingBootstrap(
  options: BootstrapReconcileOptions = {},
): Promise<BootstrapReconcileBatchResult> {
  const startMs = Date.now();
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_MISSING_BOOTSTRAP_BUDGET_MS;
  const batchLimit = options.batchLimit ?? DEFAULT_BOOTSTRAP_BATCH_LIMIT;

  const cutoff = new Date(now().getTime() - staleAfterMs);

  // Find ACTIVE enrollments older than the cutoff. Then filter against
  // ComposedPrompt to find the ones with no active prompt. We do this in
  // two queries (vs a NOT EXISTS subquery) for portability — Prisma's
  // raw-query support varies and the population is small at the scales
  // this scan operates at.
  const enrollments = await prisma.callerPlaybook.findMany({
    where: {
      status: "ACTIVE",
      enrolledAt: { lt: cutoff },
    },
    select: {
      callerId: true,
      playbookId: true,
    },
    orderBy: { enrolledAt: "asc" },
    take: batchLimit * 4, // overshoot — many will have prompts already
  });

  const result: BootstrapReconcileBatchResult = {
    scanned: 0,
    composed: 0,
    failed: 0,
    durationMs: 0,
    failureSamples: [],
  };

  // Filter: keep only enrollments with no ACTIVE composed prompt.
  const missing: typeof enrollments = [];
  for (const e of enrollments) {
    if (missing.length >= batchLimit) break;
    const hasPrompt = await prisma.composedPrompt.findFirst({
      where: { callerId: e.callerId, playbookId: e.playbookId, status: "active" },
      select: { id: true },
    });
    if (!hasPrompt) missing.push(e);
  }

  result.scanned = missing.length;

  for (const e of missing) {
    try {
      await autoComposeForCaller(e.callerId, e.playbookId);
      result.composed += 1;
    } catch (err) {
      result.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      if (result.failureSamples.length < 5) {
        result.failureSamples.push({
          callerId: e.callerId,
          playbookId: e.playbookId,
          reason,
        });
      }
      console.error(
        `[reconcile-missing-bootstrap] autoCompose failed for caller=${e.callerId.slice(0, 8)} ` +
          `playbook=${e.playbookId.slice(0, 8)}: ${reason}`,
      );
    }
  }

  result.durationMs = Date.now() - startMs;
  return result;
}
