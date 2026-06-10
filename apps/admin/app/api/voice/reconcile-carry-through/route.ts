import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  reconcileCarryThrough,
  DEFAULT_BATCH_LIMIT,
  DEFAULT_CARRY_THROUGH_BUDGET_MS,
} from "@/lib/voice/reconciler";
import {
  reconcileMissingBootstrap,
  DEFAULT_BOOTSTRAP_BATCH_LIMIT,
  DEFAULT_MISSING_BOOTSTRAP_BUDGET_MS,
} from "@/lib/voice/reconcile-missing-bootstrap";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/reconcile-carry-through
 * @visibility internal
 * @auth session ADMIN OR x-internal-secret (dual path)
 * @tags voice, cron, session, reconciler
 * @description Run one carry-through reconciliation cycle (Slice 5 of
 *   epic #1338) AND one enrollment-bootstrap reconciliation cycle
 *   (#1420). Both scans share the same cron schedule:
 *
 *   1. **carry-through** (`reconcileCarryThrough`) — ENDED Sessions
 *      whose pipeline never wrote a `producedComposedPromptId`. Re-fires
 *      COMPOSE with `partialFailureMode: "minimal"`.
 *
 *   2. **enrollment-bootstrap** (`reconcileMissingBootstrap`, #1420) —
 *      ACTIVE `CallerPlaybook` enrollments with no
 *      `ComposedPrompt(status='active')`. Fires `autoComposeForCaller`
 *      to close the post-tx hook gap (process crash, timeout, etc.).
 *
 *   Returns BOTH summaries. Safe to call repeatedly — every internal
 *   write uses an atomic guard.
 *
 *   **Triggering:** in prod, configure Cloud Scheduler to POST here every
 *   60 seconds with `x-internal-secret: $INTERNAL_API_SECRET`. On the
 *   sandbox VM, use a cron entry hitting the same URL (see
 *   `docs/CLOUD-DEPLOYMENT.md`).
 *
 *   **Auth:** dual-path — either an ADMIN session cookie (manual
 *   operator run) OR an `x-internal-secret` header matching
 *   `process.env.INTERNAL_API_SECRET` (Cloud Scheduler / cron). Mirrors
 *   `voice/poll-stale-calls/route.ts`.
 * @body staleAfterMs number - Optional override; defaults to 60_000 ms (carry-through)
 * @body batchLimit number - Optional override; defaults to 50 (carry-through)
 * @body bootstrapStaleAfterMs number - Optional override; defaults to 300_000 ms (enrollment-bootstrap)
 * @body bootstrapBatchLimit number - Optional override; defaults to 50 (enrollment-bootstrap)
 * @response 200 { ok: true, summary: ReconcileBatchResult, bootstrapSummary: BootstrapReconcileBatchResult }
 * @response 401 { error: "Unauthorized" }
 */
export async function POST(request: Request) {
  const internalSecret = request.headers.get("x-internal-secret");
  const expectedSecret = config.security.internalApiSecret;
  if (!internalSecret || !expectedSecret || internalSecret !== expectedSecret) {
    const auth = await requireAuth("ADMIN");
    if (isAuthError(auth)) return auth.error;
  }

  let body: {
    staleAfterMs?: number;
    batchLimit?: number;
    bootstrapStaleAfterMs?: number;
    bootstrapBatchLimit?: number;
  } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    // No body is fine — defaults apply.
  }

  // Run both scans. They scan different data + the queries don't
  // contend, so parallel is fine. If either throws, surface as 500.
  const [summary, bootstrapSummary] = await Promise.all([
    reconcileCarryThrough({
      staleAfterMs: body.staleAfterMs ?? DEFAULT_CARRY_THROUGH_BUDGET_MS,
      batchLimit: body.batchLimit ?? DEFAULT_BATCH_LIMIT,
    }),
    reconcileMissingBootstrap({
      staleAfterMs: body.bootstrapStaleAfterMs ?? DEFAULT_MISSING_BOOTSTRAP_BUDGET_MS,
      batchLimit: body.bootstrapBatchLimit ?? DEFAULT_BOOTSTRAP_BATCH_LIMIT,
    }),
  ]);

  return NextResponse.json({ ok: true, summary, bootstrapSummary });
}
