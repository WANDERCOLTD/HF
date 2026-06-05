// #1078 — V6 wizard Phase 1 spike.
//
// POST /api/wizard-v6/field-answered
//   { sessionId, fieldKey, fieldValue } → { eventId, eventVersion, nextSnapshot, elapsedMs }
//
// Single-write boundary for "the learner answered a field". Wraps the
// `recordFieldAnswered` helper which does event append + snapshot
// projection inside one transaction.

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordFieldAnswered } from "@/lib/wizard-v6/record-field-answered";

export async function POST(request: Request) {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) return auth.error;

  let body: { sessionId?: string; fieldKey?: string; fieldValue?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, fieldKey, fieldValue } = body;
  if (!sessionId || !fieldKey) {
    return NextResponse.json(
      { error: "sessionId and fieldKey required" },
      { status: 400 },
    );
  }

  const session = await prisma.wizardSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      playbookId: true,
      specKey: true,
      specVersion: true,
      status: true,
      Playbook: { select: { config: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `Session is ${session.status}, not ACTIVE` },
      { status: 409 },
    );
  }

  // Pull prior snapshot from Playbook.config.__v6.answeredFields.
  const v6 = (session.Playbook.config as { __v6?: { answeredFields?: Record<string, unknown> } } | null)
    ?.__v6;
  const priorAnsweredFields = v6?.answeredFields ?? {};

  try {
    const result = await recordFieldAnswered({
      playbookId: session.playbookId,
      sessionId: session.id,
      specKey: session.specKey,
      specVersion: session.specVersion,
      fieldKey,
      fieldValue,
      actorId: auth.session.user.id,
      priorAnsweredFields,
    });
    return NextResponse.json({
      eventId: result.eventId,
      eventVersion: result.eventVersion,
      nextSnapshot: result.nextSnapshot,
      elapsedMs: result.elapsedMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The DB trigger raises with `check_violation` ERRCODE when the
    // projector marker is missing. Surface that distinctly so the test
    // assertion can flag CHAIN violations.
    return NextResponse.json(
      { error: message, kind: "wizard-v6:write-rejected" },
      { status: 500 },
    );
  }
}
