import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  reconcileCarryThrough,
  DEFAULT_BATCH_LIMIT,
  DEFAULT_CARRY_THROUGH_BUDGET_MS,
} from "@/lib/voice/reconciler";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/reconcile-carry-through
 * @visibility internal
 * @auth session ADMIN OR x-internal-secret (dual path)
 * @tags voice, cron, session, reconciler
 * @description Run one carry-through reconciliation cycle (Slice 5 of
 *   epic #1338). Scans for ended Sessions whose pipeline never wrote a
 *   `producedComposedPromptId` and re-fires COMPOSE with
 *   `partialFailureMode: "minimal"`. Returns the batch summary. Safe to
 *   call repeatedly — every internal write uses an atomic guard so a
 *   live pipeline run landing during the cycle wins cleanly.
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
 * @body staleAfterMs number - Optional override; defaults to 60_000 ms
 * @body batchLimit number - Optional override; defaults to 50
 * @response 200 { ok: true, summary: ReconcileBatchResult }
 * @response 401 { error: "Unauthorized" }
 */
export async function POST(request: Request) {
  const internalSecret = request.headers.get("x-internal-secret");
  const expectedSecret = config.security.internalApiSecret;
  if (!internalSecret || !expectedSecret || internalSecret !== expectedSecret) {
    const auth = await requireAuth("ADMIN");
    if (isAuthError(auth)) return auth.error;
  }

  let body: { staleAfterMs?: number; batchLimit?: number } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    // No body is fine — defaults apply.
  }

  const summary = await reconcileCarryThrough({
    staleAfterMs: body.staleAfterMs ?? DEFAULT_CARRY_THROUGH_BUDGET_MS,
    batchLimit: body.batchLimit ?? DEFAULT_BATCH_LIMIT,
  });

  return NextResponse.json({ ok: true, summary });
}
