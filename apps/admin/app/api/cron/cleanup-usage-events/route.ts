import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { cleanupOldUsageData } from "@/lib/metering/rollup";

export const runtime = "nodejs";

/**
 * @api POST /api/cron/cleanup-usage-events
 * @visibility internal
 * @auth session ADMIN OR x-internal-secret (dual path)
 * @tags cron, metering
 * @description A7 / audit-fix Track A — nightly cleanup of stale UsageEvent
 *   rows (default 30d retention) and hourly rollups (default 90d). The
 *   underlying `cleanupOldUsageData` function existed in
 *   `lib/metering/rollup.ts` but was never invoked from anywhere; per
 *   the data-explosion audit, UsageEvent projects to ~30M rows / ~12 GB
 *   at 10K learners × 12 months unless pruned.
 *
 *   **Triggering:** Cloud Scheduler → POST here once daily at 03:00 UTC
 *   with header `x-internal-secret: $INTERNAL_API_SECRET`. See
 *   `docs/audit/track-a-deployment-handoff.md` for the gcloud commands.
 *
 *   **Auth:** dual-path — either an ADMIN session cookie (manual
 *   operator run for ad-hoc cleanup) OR an `x-internal-secret` header
 *   matching `process.env.INTERNAL_API_SECRET`. Mirrors the existing
 *   `voice/poll-stale-calls/route.ts` pattern.
 * @body eventRetentionDays number - optional override for raw event TTL (default 30)
 * @body hourlyRetentionDays number - optional override for hourly rollup TTL (default 90)
 * @response 200 { ok: true, summary: { eventsDeleted, hourlyRollupsDeleted } }
 * @response 401 { error: "Unauthorized" }
 */
export async function POST(request: Request) {
  const internalSecret = request.headers.get("x-internal-secret");
  const expectedSecret = config.security.internalApiSecret;
  if (!(internalSecret && expectedSecret && internalSecret === expectedSecret)) {
    const auth = await requireAuth("ADMIN");
    if (isAuthError(auth)) return auth.error;
  }

  let body: { eventRetentionDays?: number; hourlyRetentionDays?: number } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    // No body → defaults apply.
  }

  const summary = await cleanupOldUsageData({
    eventRetentionDays: body.eventRetentionDays,
    hourlyRetentionDays: body.hourlyRetentionDays,
    verbose: false,
  });

  return NextResponse.json({ ok: true, summary });
}
