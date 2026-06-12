// GET /api/intake/audit-bundle/[intentId]
//
// Returns the composed AuditBundle for an intake session.
//   - default: application/json (the full bundle as a single object)
//   - ?format=jsonl: newline-delimited events + meta, suitable for
//     piping to `npx crawcus-verify` (once TKT-VERIFIER-1a ships)
//
// Public: same posture as /api/intake/session/[intentId] — the
// intentId is the bearer secret.
//
// HF-D P0 hardening (2026-06-12):
//   - rate-limited per IP under the "intake-pii-read" key.
//   - JSONL download filename redacted — was
//     `enrollment-${intentId}.jsonl` (the saved file's name IS the bearer
//     credential; leaks via email attachments, file-share links, archived
//     backups). Now uses a short non-secret prefix + a timestamp so the
//     filename is still unique per download but carries zero leakage value.
// See docs/audit/HF-D-evidence-pii-intentid-bearer.md.

import { NextRequest, NextResponse } from "next/server";
import {
  composeIntakeAuditBundle,
  SessionNotFoundError,
} from "@/lib/intake/audit-bundle";
import type { IntentId } from "@/lib/intake/tallyseal";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ intentId: string }> },
): Promise<NextResponse> {
  const rl = checkRateLimit(getClientIP(req), "intake-pii-read");
  if (!rl.ok) return rl.error;

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
    // HF-D P0: filename carries a short non-secret prefix + epoch ms.
    // The intentId stays in the URL (the larger leak surface; structural fix is P1)
    // but no longer ends up baked into the saved file's name.
    const stamp = Date.now();
    return new NextResponse(lines.join("\n") + "\n", {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson",
        "content-disposition": `attachment; filename="enrollment-${stamp}.jsonl"`,
      },
    });
  }

  return NextResponse.json(bundle);
}
