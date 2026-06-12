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

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getDisclosureStore,
  deriveDisclosureId,
} from "@/lib/intake/hf-adapter/disclosure-store";
import {
  appendEvent,
  getSession,
  PURPOSE,
} from "@/lib/intake/session-store";
import { readIntakeSid } from "@/lib/intake/intake-session-cookie";
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

// HF-D P1 #3 (issue #1542): `intentId` removed from the body schema —
// it now travels as the `__hf_intake_sid` cookie.
const BodySchema = z.object({
  signal: SignalSchema,
});

export async function POST(req: NextRequest) {
  const intentId = readIntakeSid(req);
  // SIGNAL not gate: a signal arriving without an active intake
  // session is a no-op, not an error — preserves pre-fix quiet-200
  // semantics so a client banner that fires after a tab refresh
  // doesn't surface a scary 401.
  if (!intentId) {
    return NextResponse.json({ ok: false, reason: "no-intake-session" }, { status: 200 });
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const session = getSession(intentId as IntentId);
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

  // Q-CR9 write-path: record the signal into tallyseal_disclosure_signal
  // (separate table from tallyseal_disclosure — the SDK's structural
  // SIGNAL-not-gate guarantee). Server derives the canonical
  // disclosureId so a tampered client payload can't redirect the
  // signal to a different disclosure row. Best-effort — failure logs
  // but doesn't block the learner.
  try {
    const store = await getDisclosureStore();
    const observedAt = new Date(body.signal.observedAt);
    await store.recordSignal({
      id: `sig_${randomUUID()}`,
      tenantId: session.tenant.id,
      disclosureId: deriveDisclosureId(intentId, body.signal.requirementId),
      requirementId: body.signal.requirementId,
      signalType: body.signal.signalType,
      contentHash: body.signal.contentHash,
      observedAt,
      ...(body.signal.viewMs !== undefined ? { viewMs: body.signal.viewMs } : {}),
    } as never);
  } catch (err) {
    console.error(
      "[intake/disclosure-signal] disclosureStore.recordSignal failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}
