// POST /api/intake/chat
//
// Phase 1.5 chat turn — appends a CapturedTurn for the user's message,
// calls the Anthropic AIPort for the assistant reply, records the
// assistant turn with full AIProvenance (model + token counts + cost
// + input/output hashes), and updates the session snapshot.
//
// Value extraction (firstName / lastName / email) stays deterministic
// so the contract gates are preserved: the AI handles conversation
// quality + politeness while the state machine guarantees field-key
// integrity. A later iteration can move extraction to AI tool-use.
//
// When ANTHROPIC_API_KEY is missing (CI / tests / no-key dev),
// getIntakeAIPort() returns null and the route falls back to the
// deterministic interview stub — same behaviour as Phase 1 ship.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSession,
  appendEvent,
  appendMessage,
  setValue,
  PURPOSE,
  type IntakeSession,
} from "@/lib/intake/session-store";
import { getIntakeAIPort } from "@/lib/intake/hf-adapter/ai";
import type {
  AIPort,
  EventAIProvenance,
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

// Anthropic model used for the intake chat. Sonnet 4.6 is cheap, fast,
// fine for short conversational turns. Compliance manifest permits
// claude-opus-4-7 + claude-sonnet-4-6 — keep this list in step with
// lib/intake/compliance.ts ai.allowedModels.
const INTAKE_MODEL = "claude-sonnet-4-6";
const INTAKE_PROMPT_VERSION = "intake/v0.1.0-DRAFT";
const INTAKE_MAX_COST_USD = 0.5; // == compliance.ai.costCeilingPerIntent

const SYSTEM_PROMPT = `You are HumanFirst Foundation's enrolment assistant. Your only job is to politely capture three details from the learner: first name, last name, and email address.

Rules:
- Ask one thing at a time. Be brief — one short sentence per reply.
- Order: first name, then last name, then email.
- If the learner replies with a greeting or affirmation ("hi", "ok", "yes") when you have just asked for a name, re-prompt for that name. Do not capture greetings as names.
- When the learner provides what looks like an email, validate it has the basic shape X@Y.Z. If it doesn't, ask them to try again.
- Once you have all three details, confirm the enrolment is submitted and tell them they'll get a confirmation email shortly.
- Never say "submitted" until you have a valid email.

Tone: warm, concise, professional. No emoji. No filler.`;

const AFFIRMATION_RE = /^(hi|hello|hey|yo|ok|okay|sure|yes|yeah|yep|y|n|no|nope|start)\b[!.,? ]*$/i;

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
    purpose: PURPOSE.courseDelivery,
    dataSubjectIds: [subjectId],
  });
  appendMessage(session, "user", userMessage);

  // 2. Deterministic value extraction — runs BEFORE the AI call so
  //    the session.values snapshot is current. Keeps the contract
  //    gates honest regardless of what the AI says.
  const extraction = extractValues(session, userMessage);

  // 3. Assistant reply — AIPort if key present, deterministic stub otherwise.
  const aiPort = getIntakeAIPort();
  let assistantReply: string;
  let provenance: EventAIProvenance | undefined;
  if (aiPort) {
    const result = await callAI(aiPort, session, userMessage);
    assistantReply = result.text;
    provenance = result.provenance;
  } else {
    assistantReply = stubReply(session.values, userMessage, extraction);
  }

  appendEvent(session, {
    kind: "CapturedTurn",
    payload: { role: "assistant", content: assistantReply },
    lawfulBasis: "contract",
    purpose: PURPOSE.courseDelivery,
    dataSubjectIds: [subjectId],
    ai: provenance,
  });
  appendMessage(session, "assistant", assistantReply);

  // 4. If interview reached terminal state, emit ProjectionCommit.
  if (extraction.commit) {
    appendEvent(session, {
      kind: "ProjectionCommit",
      payload: { projection: session.projection, snapshot: session.values },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
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

// ── Extraction state machine — deterministic, contract-honest ───────

interface ExtractionResult {
  readonly captured: ReadonlyArray<{ field: string; value: unknown }>;
  readonly commit: boolean;
}

function extractValues(
  session: { values: Record<string, unknown> },
  userMessage: string,
): ExtractionResult {
  const v = session.values;
  const captured: Array<{ field: string; value: unknown }> = [];

  if (!v.firstName) {
    if (AFFIRMATION_RE.test(userMessage)) {
      return { captured: [], commit: false };
    }
    const firstName = userMessage.split(/\s+/)[0] ?? userMessage;
    setValue(session as unknown as IntakeSession, "firstName", firstName);
    captured.push({ field: "firstName", value: firstName });
    return { captured, commit: false };
  }
  if (!v.lastName) {
    const lastName = userMessage.split(/\s+/)[0] ?? userMessage;
    setValue(session as unknown as IntakeSession, "lastName", lastName);
    captured.push({ field: "lastName", value: lastName });
    return { captured, commit: false };
  }
  if (!v.email) {
    if (!EMAIL_RE.test(userMessage)) {
      return { captured: [], commit: false };
    }
    setValue(session as unknown as IntakeSession, "email", userMessage);
    captured.push({ field: "email", value: userMessage });
    return { captured, commit: true };
  }
  return { captured, commit: false };
}

// ── AI call ────────────────────────────────────────────────────────

interface AICallResult {
  readonly text: string;
  readonly provenance: EventAIProvenance;
}

async function callAI(
  aiPort: AIPort,
  session: IntakeSession,
  latestUserMessage: string,
): Promise<AICallResult> {
  // Compose a single prompt: system + conversation history + the
  // latest user turn. AIRequest is single-prompt by design (not a
  // message array); the adapter handles transport-level shaping
  // for the underlying provider.
  const transcript = session.messages
    .map((m) => `${roleLabel(m.role)}: ${m.content}`)
    .join("\n");
  const valuesSummary = summariseValues(session.values);
  const prompt = [
    SYSTEM_PROMPT,
    "",
    "Captured so far:",
    valuesSummary,
    "",
    "Conversation so far:",
    transcript,
    "",
    `Learner just said: "${latestUserMessage}"`,
    "",
    "Your reply (one sentence):",
  ].join("\n");

  const response = await aiPort.call(
    {
      model: INTAKE_MODEL,
      prompt,
      promptTemplateVersion: INTAKE_PROMPT_VERSION,
      purpose: PURPOSE.courseDelivery,
      maxCostUsd: INTAKE_MAX_COST_USD,
    },
    {
      tenant: session.tenant,
      actor: session.actor,
    },
  );

  return {
    text: response.text.trim(),
    provenance: {
      model: response.model,
      promptTemplateVersion: INTAKE_PROMPT_VERSION,
      inputHash: response.inputHash,
      outputHash: response.outputHash,
      latencyMs: response.latencyMs,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      costUsd: response.costUsd,
    },
  };
}

function roleLabel(role: "user" | "assistant" | "system"): string {
  switch (role) {
    case "user":
      return "Learner";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
  }
}

function summariseValues(values: Record<string, unknown>): string {
  const lines: string[] = [];
  if (values.firstName) lines.push(`- firstName: ${String(values.firstName)}`);
  if (values.lastName) lines.push(`- lastName: ${String(values.lastName)}`);
  if (values.email) lines.push(`- email: ${String(values.email)}`);
  if (values.classroomName) lines.push(`- classroom: ${String(values.classroomName)}`);
  return lines.length === 0 ? "- (nothing yet)" : lines.join("\n");
}

// ── Stub fallback — used when ANTHROPIC_API_KEY is missing ─────────

function stubReply(
  values: Record<string, unknown>,
  userMessage: string,
  extraction: ExtractionResult,
): string {
  // Mirror the prior Phase 1 deterministic-stub flow so behaviour with
  // no API key is identical to the original ship — keeps tests +
  // audit-bundle fixture reproducible.
  if (extraction.commit) {
    return "Got it. That's everything I need — submitting your enrolment now. You'll get a confirmation email shortly.";
  }
  if (!values.firstName) {
    if (AFFIRMATION_RE.test(userMessage)) {
      return "Great — what's your first name?";
    }
    // shouldn't reach here — extraction would have captured firstName
    return "Thanks. And your last name?";
  }
  if (!values.lastName) {
    return "What email should we use for this enrolment?";
  }
  if (!values.email) {
    if (!EMAIL_RE.test(userMessage)) {
      return "That doesn't look like an email. Could you try again?";
    }
    return "Got it. That's everything I need — submitting your enrolment now. You'll get a confirmation email shortly.";
  }
  return "Your enrolment is already submitted. If you need to update anything, please contact support.";
}
