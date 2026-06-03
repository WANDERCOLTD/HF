// GET /api/intake/session/[intentId]
//
// Read-only snapshot of an intake session for the post-commit recap
// page. Returns events, values, messages — same shape the bootstrap
// + chat-turn responses carry, so the consumer (e.g. /intake/done)
// can render the full CoC without holding a chat connection.
//
// Public: the intake surface is pre-auth. The intentId acts as a
// random-secret bearer; lookup-by-id is the only way to read.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/intake/session-store";
import type { IntentId } from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ intentId: string }> },
): Promise<NextResponse> {
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
