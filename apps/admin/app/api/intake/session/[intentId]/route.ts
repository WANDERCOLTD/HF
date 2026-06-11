// GET /api/intake/session/[intentId]
//
// Read-only snapshot of an intake session for the post-commit recap
// page. Returns events, values, messages — same shape the bootstrap
// + chat-turn responses carry, so the consumer (e.g. /intake/done)
// can render the full CoC without holding a chat connection.
//
// Public: the intake surface is pre-auth. The intentId acts as a
// random-secret bearer; lookup-by-id is the only way to read.
//
// HF-D P0 hardening (2026-06-12): rate-limited per IP under the
// "intake-pii-read" key — the bearer posture itself isn't changing,
// but bulk scraping of a leaked-intentId batch is now bounded. See
// docs/audit/HF-D-evidence-pii-intentid-bearer.md.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/intake/session-store";
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
  const session = getSession(intentId as IntentId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
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
