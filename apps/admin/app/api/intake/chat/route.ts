// POST /api/intake/chat
//
// Phase 1 chat turn — appends a CapturedTurn for the user's message,
// emits a deterministic stub assistant response (Phase 1.5 wires the
// real Anthropic adapter), and updates the session snapshot.
//
// The deterministic stub progresses through a minimal interview that
// captures the 3 required fields (firstName / lastName / email) so a
// happy-path session can complete + emit a ProjectionCommit event +
// produce a verifiable audit bundle without an Anthropic API key.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSession,
  appendEvent,
  appendMessage,
  setValue,
} from "@/lib/intake/session-store";
import type {
  IntentId,
  SubjectId,
} from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  intentId: z.string().min(1),
  chatSessionId: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const session = getSession(body.intentId as IntentId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const subjectId = `intake-subject-${body.chatSessionId}` as SubjectId;
  const userMessage = body.message.trim();

  // 1. CapturedTurn for the user's message.
  appendEvent(session, {
    kind: "CapturedTurn",
    payload: { role: "user", content: userMessage },
    lawfulBasis: "contract",
    purpose: "course-delivery",
    dataSubjectIds: [subjectId],
  });
  appendMessage(session, "user", userMessage);

  // 2. Deterministic interview state machine — progresses through
  //    required fields until they're filled. Extract values opportunistically
  //    from the user message; emit a CapturedTurn for the assistant
  //    response.
  const assistantReply = stepInterview(session, userMessage);
  appendEvent(session, {
    kind: "CapturedTurn",
    payload: { role: "assistant", content: assistantReply.content },
    lawfulBasis: "contract",
    purpose: "course-delivery",
    dataSubjectIds: [subjectId],
  });
  appendMessage(session, "assistant", assistantReply.content);

  // 3. If interview reached terminal state, emit ProjectionCommit.
  if (assistantReply.commit) {
    appendEvent(session, {
      kind: "ProjectionCommit",
      payload: { projection: session.projection, snapshot: session.values },
      lawfulBasis: "contract",
      purpose: "course-delivery",
      dataSubjectIds: [subjectId],
    });
    session.state = "committed";
  }

  return NextResponse.json({
    events: session.events,
    suggestions: [],
    values: session.values,
    messages: session.messages,
  });
}

interface StepResult {
  readonly content: string;
  readonly commit: boolean;
}

function stepInterview(
  session: { values: Record<string, unknown> },
  userMessage: string,
): StepResult {
  const v = session.values;
  if (!v.firstName) {
    setOnSession(session, "firstName", userMessage.split(/\s+/)[0] ?? userMessage);
    return { content: "Thanks. And your last name?", commit: false };
  }
  if (!v.lastName) {
    setOnSession(session, "lastName", userMessage.split(/\s+/)[0] ?? userMessage);
    return { content: "What email should we use for this enrolment?", commit: false };
  }
  if (!v.email) {
    if (!EMAIL_RE.test(userMessage)) {
      return {
        content: "That doesn't look like an email. Could you try again?",
        commit: false,
      };
    }
    setOnSession(session, "email", userMessage);
    return {
      content:
        "Got it. That's everything I need — submitting your enrolment now. You'll get a confirmation email shortly.",
      commit: true,
    };
  }
  return {
    content:
      "Your enrolment is already submitted. If you need to update anything, please contact support.",
    commit: false,
  };
}

// Inline setter avoids importing setValue when session has the typing
// we control here; matches setValue() semantics.
function setOnSession(
  session: { values: Record<string, unknown> },
  key: string,
  value: unknown,
): void {
  // Wrap setValue via session-store so updatedAt is bumped consistently.
  // (Imported above as `setValue`; alias re-call to satisfy strict rules.)
  setValue(session as unknown as Parameters<typeof setValue>[0], key, value);
}
