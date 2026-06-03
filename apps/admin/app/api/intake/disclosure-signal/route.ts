// POST /api/intake/disclosure-signal
//
// Receives a DisclosureSignal event from the client banner (Q-CR9 LOCKED
// 2026-06-02 — SIGNAL not gate). The TallysealBanner IntersectionObserver
// fires onReadSignal once the notice has been fully visible for the
// configured threshold (default 1500 ms per ICO "opportunity to read"
// framing). HF persists the event to the session log so it appears in
// the audit bundle — but does NOT treat it as consent.
//
// Best-effort write: missing session or malformed payload returns 4xx
// without disturbing enrolment progress. The signal is evidence the
// data subject had an opportunity to perceive the notice, never
// affirmative acknowledgment.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  appendEvent,
  getSession,
  PURPOSE,
} from "@/lib/intake/session-store";
import type { IntentId } from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

const SignalSchema = z.object({
  kind: z.literal("DisclosureSignal"),
  disclosureId: z.string(),
  requirementId: z.string(),
  contentHash: z.string(),
  signalType: z.enum(["read", "click", "dwell", "replay"]),
  observedAt: z.union([z.string(), z.number(), z.date()]),
  viewMs: z.number().optional(),
});

const BodySchema = z.object({
  intentId: z.string().min(1),
  signal: SignalSchema,
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const session = getSession(body.intentId as IntentId);
  if (!session) {
    // Quiet 200: SIGNAL not gate — signal arriving after session GC
    // shouldn't break the client. Audit-trail-wise this is a no-op.
    return NextResponse.json({ ok: false, reason: "session-not-found" }, { status: 200 });
  }

  appendEvent(session, {
    kind: "DisclosureSignal",
    payload: {
      disclosureId: body.signal.disclosureId,
      requirementId: body.signal.requirementId,
      contentHash: body.signal.contentHash,
      signalType: body.signal.signalType,
      observedAt: body.signal.observedAt,
      ...(body.signal.viewMs !== undefined ? { viewMs: body.signal.viewMs } : {}),
    },
    lawfulBasis: "contract",
    purpose: PURPOSE.courseDelivery,
    dataSubjectIds: [],
  });

  return NextResponse.json({ ok: true });
}
