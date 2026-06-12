// GET /api/intake/session/[intentId] — REMOVED
//
// HF-D P1 #3 (issue #1542) moved the bearer to the `__hf_intake_sid`
// httpOnly cookie at `/api/intake/session`. This path is kept as a
// 410 Gone tombstone so any stale bookmarks/links surface a clear
// removal message instead of leaking through to the in-memory store.
//
// See `docs/audit/HF-D-evidence-pii-intentid-bearer.md` for the full
// threat model.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "route_removed",
      message: "Use GET /api/intake/session — the bearer now travels as the __hf_intake_sid cookie.",
    },
    { status: 410 },
  );
}
