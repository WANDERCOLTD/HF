// POST /api/intake/audit-bundle/download
//
// Streams the IntakeSession's audit bundle as JSONL (one event per
// line) for the `npx crawcus-verify` flow. Bearer travels as the
// `__hf_intake_sid` cookie (HF-D P1 #3 — issue #1542). Previously
// `GET /api/intake/audit-bundle/[intentId]?format=jsonl` — the URL
// path and `Content-Disposition: filename="enrollment-<intentId>.jsonl"`
// both leaked the bearer (audit T2 + T4). The cookie-bearer move
// closes T1–T4 in one change; the static filename
// `enrollment-<timestamp>.jsonl` makes intentId structurally absent
// from every part of the download.
//
// POST (not GET) because:
//   - cookies travel on POST identically to GET, so the bearer
//     transport is unchanged
//   - prevents the `<a href>` direct-link pattern that previously
//     embedded the bearer in the URL — POST forces a `fetch + Blob`
//     download path in the client (see `components/intake/IntakeDoneClient.tsx`)
//   - matches the disclosure-acknowledge / disclosure-signal POST
//     shape on this surface
//
// Rate-limit `intake-pii-read` stays in place as defence-in-depth.

import { NextRequest, NextResponse } from "next/server";
import {
  composeIntakeAuditBundle,
  SessionNotFoundError,
} from "@/lib/intake/audit-bundle";
import type { IntentId } from "@/lib/intake/tallyseal";
import { readIntakeSid } from "@/lib/intake/intake-session-cookie";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = checkRateLimit(getClientIP(req), "intake-pii-read");
  if (!rl.ok) return rl.error;

  const intentId = readIntakeSid(req);
  if (!intentId) {
    return NextResponse.json(
      { error: "no_intake_session", message: "No in-flight intake session." },
      { status: 401 },
    );
  }

  let bundle;
  try {
    bundle = composeIntakeAuditBundle({ intentId: intentId as IntentId });
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return NextResponse.json(
        {
          error: "session_expired",
          message: "Your session has expired. Please restart the intake flow.",
        },
        { status: 410 },
      );
    }
    throw e;
  }

  // One JSON object per line. First line is the bundle meta sans
  // events; subsequent lines are events in order. Round-trip-safe
  // with `JSON.parse` per line — matches the wire format the verifier
  // CLI consumes.
  const { events, ...meta } = bundle as unknown as {
    events?: unknown[];
  } & Record<string, unknown>;
  const lines = [
    JSON.stringify({ kind: "BundleMeta", ...meta }),
    ...(Array.isArray(events) ? events.map((e) => JSON.stringify(e)) : []),
  ];
  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "content-disposition": `attachment; filename="enrollment-${Date.now()}.jsonl"`,
    },
  });
}
