// POST /api/intake/disclosure-acknowledge
//
// Affirmative acknowledgement of a delivered disclosure — the
// learner clicked "I have read this". Distinct from the passive
// DisclosureSignal (scroll-read evidence): this event is the
// canonical "subject confirmed receipt" record.
//
// Emits a DisclosureAcknowledged event linked by `acknowledges` to
// the DisclosureDelivered event the controller wrote at bootstrap
// time for the matching requirementId. Idempotent — re-clicking
// returns 200 with `alreadyAcknowledged: true` and does not write
// a duplicate event.
//
// IMPORTANT: this is NOT consent. The Art 13 disclosure is purely
// informational (controller obligation under contract lawful basis).
// Acknowledgement is additional audit evidence the subject saw the
// notice; it does not change the lawful basis.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveDisclosureId } from "@/lib/intake/hf-adapter/disclosure-store";
import { markDisclosureAcknowledged } from "@/lib/intake/hf-adapter/record-disclosure-with-tx";
import {
  appendEvent,
  getSession,
  PURPOSE,
} from "@/lib/intake/session-store";
import { readIntakeSid } from "@/lib/intake/intake-session-cookie";
import type { EventId, IntentId, SubjectId } from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

// HF-D P1 #3 (issue #1542): `intentId` removed from the body schema —
// it now travels as the `__hf_intake_sid` cookie.
const BodySchema = z.object({
  requirementId: z.string().min(1),
  chatSessionId: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  const intentId = readIntakeSid(req);
  if (!intentId) {
    return NextResponse.json(
      { error: "no_intake_session", message: "No in-flight intake session." },
      { status: 401 },
    );
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
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

  // Find the DisclosureDelivered event we're acknowledging — the
  // most recent one matching this requirementId.
  const delivered = [...session.events]
    .reverse()
    .find((e) => {
      if (e.kind !== "DisclosureDelivered") return false;
      const payload = (e as { payload?: { requirementId?: string } }).payload;
      return payload?.requirementId === body.requirementId;
    }) as { id: EventId; payload?: { requirementId?: string } } | undefined;

  if (!delivered) {
    return NextResponse.json(
      { error: "no DisclosureDelivered event for that requirementId" },
      { status: 409 },
    );
  }

  // Idempotency: if an Acknowledged event already exists for this
  // delivered.id, return it without writing a duplicate.
  const existingAck = session.events.find((e) => {
    if (e.kind !== "DisclosureAcknowledged") return false;
    const payload = (e as { payload?: { acknowledges?: string } }).payload;
    return payload?.acknowledges === delivered.id;
  });
  if (existingAck) {
    return NextResponse.json({ ok: true, alreadyAcknowledged: true });
  }

  const subjectId = `intake-subject-${body.chatSessionId}` as SubjectId;
  // Derive the canonical disclosureId using the same algorithm as
  // bootstrap (Q-CR9 write-path coherence; both routes must agree on
  // the typed-table row identity).
  const disclosureId = deriveDisclosureId(intentId, body.requirementId);
  const acknowledgedAt = new Date();

  appendEvent(session, {
    kind: "DisclosureAcknowledged",
    payload: {
      disclosureId,
      subject: subjectId,
      acknowledges: delivered.id,
    },
    lawfulBasis: "contract",
    purpose: PURPOSE.courseDelivery,
    dataSubjectIds: [subjectId],
  });

  // Q-CR9 write-path: stamp tallyseal_disclosure.acknowledged_at
  // alongside the in-memory event. Best-effort — failure logs but
  // doesn't block the learner (Q2 founder guidance).
  //
  // #1919 — routed through `markDisclosureAcknowledged(...)` wrapper
  // so the future Tallyseal Drop-1 tx-discipline upgrade is a one-line
  // change in the wrapper rather than a refactor here. The wrapper
  // accepts `tx?` for forward-compat (IGNORED today, used post-Drop-1).
  await markDisclosureAcknowledged({
    tenantId: session.tenant.id,
    disclosureId,
    acknowledgedAt,
  });

  return NextResponse.json({ ok: true });
}
