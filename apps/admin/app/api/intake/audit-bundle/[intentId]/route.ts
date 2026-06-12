// GET /api/intake/audit-bundle/[intentId] — REMOVED
//
// HF-D P1 #3 (issue #1542) moved the JSON bundle to
// `GET /api/intake/audit-bundle` reading the `__hf_intake_sid` cookie
// and split the JSONL download to `POST /api/intake/audit-bundle/download`
// streaming the file (no URL path param, no filename leak). This
// route is now a 410 Gone tombstone so stale bookmarks surface a
// clear removal message rather than leaking through to the in-memory
// store.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "route_removed",
      message:
        "Use GET /api/intake/audit-bundle (JSON) or POST /api/intake/audit-bundle/download (JSONL) — the bearer now travels as the __hf_intake_sid cookie.",
    },
    { status: 410 },
  );
}
