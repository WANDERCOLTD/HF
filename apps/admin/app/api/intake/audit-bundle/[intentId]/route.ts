// GET /api/intake/audit-bundle/[intentId]
//
// Returns the composed AuditBundle for an intake session.
//   - default: application/json (the full bundle as a single object)
//   - ?format=jsonl: newline-delimited events + meta, suitable for
//     piping to `npx crawcus-verify` (once TKT-VERIFIER-1a ships)
//
// Public: same posture as /api/intake/session/[intentId] — the
// intentId is the bearer secret.

import { NextRequest, NextResponse } from "next/server";
import {
  composeIntakeAuditBundle,
  SessionNotFoundError,
} from "@/lib/intake/audit-bundle";
import type { IntentId } from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ intentId: string }> },
): Promise<NextResponse> {
  const { intentId } = await context.params;
  if (!intentId) {
    return NextResponse.json({ error: "missing intentId" }, { status: 400 });
  }

  let bundle;
  try {
    bundle = composeIntakeAuditBundle({ intentId: intentId as IntentId });
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    throw e;
  }

  const format = req.nextUrl.searchParams.get("format");
  if (format === "jsonl") {
    // One JSON object per line. First line is the bundle meta sans
    // events; subsequent lines are events in order. Round-trip-safe
    // with `JSON.parse` per line — matches the wire format the
    // verifier CLI will consume.
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
        "content-disposition": `attachment; filename="enrollment-${intentId}.jsonl"`,
      },
    });
  }

  return NextResponse.json(bundle);
}
