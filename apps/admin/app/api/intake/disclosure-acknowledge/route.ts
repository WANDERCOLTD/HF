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
import {
  appendEvent,
  getSession,
  PURPOSE,
} from "@/lib/intake/session-store";
import type { EventId, IntentId, SubjectId } from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  intentId: z.string().min(1),
  requirementId: z.string().min(1),
  chatSessionId: z.string().min(1).max(120),
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
    return NextResponse.json({ error: "session not found" }, { status: 404 });
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
  appendEvent(session, {
    kind: "DisclosureAcknowledged",
    payload: {
      disclosureId: `disc_${body.requirementId}`,
      subject: subjectId,
      acknowledges: delivered.id,
    },
    lawfulBasis: "contract",
    purpose: PURPOSE.courseDelivery,
    dataSubjectIds: [subjectId],
  });

  return NextResponse.json({ ok: true });
}
