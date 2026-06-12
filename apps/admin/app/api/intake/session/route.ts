// GET /api/intake/session
//
// Read-only snapshot of the in-flight intake session. Bearer travels
// as the `__hf_intake_sid` cookie (HF-D P1 #3 — see issue #1542,
// `docs/audit/HF-D-evidence-pii-intentid-bearer.md`). The route
// previously lived at `/api/intake/session/[intentId]` with the
// intentId in the URL path; the old path returns 410 Gone to surface
// stale bookmarks/bots.
//
// Response codes:
//   200 — cookie present, session resolved
//   401 — cookie absent (no in-flight intake on this client)
//   410 — cookie present but session evicted (container restart) —
//         distinct from 401 so the UI can prompt a restart of the
//         intake flow with a recoverable message
//
// Rate-limit `intake-pii-read` stays in place as defence-in-depth
// even though log scraping (T5) is no longer the primary threat once
// the URL bearer is gone.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/intake/session-store";
import { readIntakeSid } from "@/lib/intake/intake-session-cookie";
import type { IntentId } from "@/lib/intake/tallyseal";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = checkRateLimit(getClientIP(req), "intake-pii-read");
  if (!rl.ok) return rl.error;

  const intentId = readIntakeSid(req);
  if (!intentId) {
    return NextResponse.json(
      { error: "no_intake_session", message: "No in-flight intake session." },
      { status: 401 },
    );
  }
  const session = getSession(intentId as IntentId);
  if (!session) {
    return NextResponse.json(
      {
        error: "session_expired",
        message: "Your session has expired. Please restart the intake flow.",
      },
      { status: 410 },
    );
  }
  return NextResponse.json({
    intentId: session.intentId,
    state: session.state,
    events: session.events,
    values: session.values,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}
