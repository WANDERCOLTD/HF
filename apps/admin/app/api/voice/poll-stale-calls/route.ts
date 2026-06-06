import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { pollStaleVoiceCalls } from "@/lib/voice/poll-stale-calls";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/poll-stale-calls
 * @visibility internal
 * @auth session ADMIN OR x-internal-secret (dual path)
 * @tags voice, cron, vapi
 * @description Run one polling cycle to recover Call rows that VAPI
 *   never delivered an end-of-call webhook for. Returns the batch
 *   summary. Safe to call repeatedly — every internal write uses an
 *   atomic guard so a webhook landing during the poll cycle wins.
 *
 *   **Triggering:** in prod, configure Cloud Scheduler to POST here every
 *   60 seconds with `x-internal-secret: $INTERNAL_API_SECRET`. On the
 *   sandbox VM, use a cron entry hitting the same URL (see
 *   `docs/CLOUD-DEPLOYMENT.md`).
 *
 *   **Auth:** dual-path — either an ADMIN session cookie (manual
 *   operator run) OR an `x-internal-secret` header matching
 *   `process.env.INTERNAL_API_SECRET` (Cloud Scheduler / cron). Mirrors
 *   `voice/health/[providerId]/route.ts:36-49`.
 * @response 200 { ok: true, summary: PollBatchResult }
 * @response 401 { error: "Unauthorized" }
 */
export async function POST(request: Request) {
  const internalSecret = request.headers.get("x-internal-secret");
  const expectedSecret = config.security.internalApiSecret;
  let authed = false;
  if (internalSecret && expectedSecret && internalSecret === expectedSecret) {
    authed = true;
  } else {
    const auth = await requireAuth("ADMIN");
    if (isAuthError(auth)) return auth.error;
    authed = true;
  }
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { slug?: string; staleAfterMs?: number; batchLimit?: number; concurrency?: number } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    // No body is fine — defaults apply.
  }

  const summary = await pollStaleVoiceCalls({
    slug: body.slug,
    staleAfterMs: body.staleAfterMs,
    batchLimit: body.batchLimit,
    concurrency: body.concurrency,
  });

  return NextResponse.json({ ok: true, summary });
}
