/**
 * @api GET /api/system/pipeline-health
 * @visibility internal
 * @scope system:read
 * @auth session (OPERATOR+)
 * @tags pipeline, writer-completeness, observability
 * @description Returns the silent-writer-detector findings for a rolling
 *   N-hour window (default 24h). Each finding is one (stage, table) pair
 *   with `samplesInWindow`, `totalWrites`, `lastNonZeroAt`, and a `silent`
 *   verdict (true when samplesInWindow > 0 AND totalWrites === 0).
 *   Calling this route ALSO fires `pipeline.stage.silent_writer` alarm
 *   rows for every silent pair — the detector is idempotent on findings
 *   but emits a fresh alarm row on every call. Cron jobs can poll this
 *   route; the admin UI tile at `/x/system/pipeline-health` reads it
 *   on page-load.
 * @query windowHours: number (default 24, range 1..168)
 * @response 200 { ok: true, windowHours, rowsScanned, alarmsFired, findings }
 *
 * #1622 / Epic #1618 Slice 1.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { detectSilentWriters } from "@/lib/pipeline/detect-silent-writers";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const windowParam = new URL(req.url).searchParams.get("windowHours");
  const windowHours = windowParam ? Math.min(168, Math.max(1, parseInt(windowParam, 10) || 24)) : 24;

  try {
    const result = await detectSilentWriters({ windowHours });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "detector failed" },
      { status: 500 },
    );
  }
}
