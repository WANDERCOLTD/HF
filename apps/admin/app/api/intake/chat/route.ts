// POST /api/intake/chat
//
// Phase 1.5 chat turn — appends a CapturedTurn for the user's message,
// calls the Anthropic AIPort (with the `update-setup` tool from items
// 12+13) for the assistant reply, records the assistant turn with
// full AIProvenance, applies any tool calls back into the snapshot,
// and decides commit via the spec's readiness predicate.
//
// Spec-driven tool calling means the AI captures fields atomically
// (multi-field paste captured in one tool call) instead of being
// regexed out of the assistant's free-text reply turn-by-turn.
//
// When ANTHROPIC_API_KEY is missing (CI / tests / no-key dev),
// getIntakeAIPort() returns null and the route falls back to a
// deterministic interview stub — preserves Phase 1 behaviour for
// the audit-bundle fixture + offline tests.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSession,
  appendEvent,
  appendMessage,
  PURPOSE,
  type IntakeSession,
} from "@/lib/intake/session-store";
import { getIntakeAIPort } from "@/lib/intake/hf-adapter/ai";
import {
  applyUpdateSetup,
  specToUpdateSetupTool,
  specToSystemPrompt,
  UPDATE_SETUP_TOOL_NAME,
} from "@/lib/intake/spec-tools";
import {
  EnrollmentIntake,
  INTERNAL_FIELDS,
  REQUIRED_FIELDS,
} from "@/lib/intake/specs/enrollment.intent";
import type {
  AIPort,
  EventAIProvenance,
  IntentId,
  SubjectId,
  ToolCall,
  ToolDefinition,
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
// Prompt version derives from the spec version + the generator. When the
// spec changes, the prompt regenerates and this version reflects it
// automatically — no hand-bumps. The audit chain records this string in
// every CapturedTurn's `ai.promptTemplateVersion`.
const INTAKE_PROMPT_VERSION = `intake/spec-v${EnrollmentIntake.version}-generated`;
const INTAKE_MAX_COST_USD = 0.5; // == compliance.ai.costCeilingPerIntent

const UPDATE_SETUP_TOOL: ToolDefinition = specToUpdateSetupTool(EnrollmentIntake, {
  excludeFields: INTERNAL_FIELDS,
});

// SYSTEM_PROMPT is generated from the spec. To add a field that the AI
// asks about, edit the spec at `lib/intake/specs/enrollment.intent.ts`
// — DO NOT edit a string here. To change required vs optional, toggle
// `REQUIRED_FIELDS` in the spec module. The prompt picks both up
// automatically and the version string above bumps with the spec
// version.
const SYSTEM_PROMPT = specToSystemPrompt(EnrollmentIntake, {
  excludeFields: INTERNAL_FIELDS,
  requiredFields: REQUIRED_FIELDS,
});

const AFFIRMATION_RE = /^(hi|hello|hey|yo|ok|okay|sure|yes|yeah|yep|y|n|no|nope|start)\b[!.,? ]*$/i;

interface CapturedField {
  readonly field: string;
  readonly value: unknown;
}

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

  // 2. Assistant reply + spec-driven tool calls.
  //    AIPort path (with tools): the AI calls `update-setup` to
  //    capture any fields the learner shared. Tool calls are applied
  //    via spec validation BEFORE we decide commit.
  //    Stub path (no API key): deterministic FSM kept for offline
  //    tests + audit-bundle fixture reproducibility.
  const aiPort = getIntakeAIPort();
  let assistantReply: string;
  let provenance: EventAIProvenance | undefined;
  if (aiPort) {
    const result = await callAI(aiPort, session, userMessage);
    assistantReply = result.text;
    provenance = result.provenance;
    applyToolCalls(session, result.toolCalls);
  } else {
    const stubResult = stubExtractAndReply(session, userMessage);
    assistantReply = stubResult.reply;
  }

  // Normalize email to lowercase. The spec validates format but does
  // not transform; the AI / stub paths capture whatever case the
  // learner typed. Aligns with /api/join/[token]'s `emailSchema`
  // which `.toLowerCase()`s at zod validation, so downstream
  // routes don't see case-divergent shapes for the same address.
  if (typeof session.values.email === "string") {
    const lower = session.values.email.toLowerCase();
    if (lower !== session.values.email) session.values.email = lower;
  }

  // Fallback narration. Claude commonly returns a tool call with no
  // accompanying text after `update-setup` fires; an empty assistant
  // reply makes the chat look stuck even though the fields were
  // captured. If we have no text but a required field is still
  // missing, ask for it deterministically. Idempotent — if the reply
  // already has content, this is a no-op.
  if (!assistantReply || assistantReply.trim() === "") {
    assistantReply = nextQuestionFor(session.values);
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

  // 3. Commit gate — use the spec's readiness predicate, not inline
  //    field checks. EnrollmentIntake.readiness() returns true when
  //    firstName + lastName + email are all populated.
  const commit = isReady(session.values);

  // 4. If interview reached terminal state, emit ProjectionCommit + (if
  //    classroomToken set) compute a redirectUrl that hands the learner
  //    off to HF's existing /join/[token] page with the captured values
  //    pre-filled. That page auto-submits when URL params include all
  //    three fields → calls /api/join POST → mints session → creates
  //    Caller + CallerPlaybook → redirects to the student dashboard.
  //    Zero new auth/cookie-mint logic; reuses the battle-tested join
  //    flow.
  let redirectUrl: string | null = null;
  if (commit) {
    appendEvent(session, {
      kind: "ProjectionCommit",
      payload: { projection: session.projection, snapshot: session.values },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [subjectId],
    });
    session.state = "committed";

    // Always route through /intake/done so the learner can review
    // the audit trail before continuing. /intake/done passes the
    // captured fields on to /join/[token] when a token is present
    // (preserving the existing join flow); the platform-level demo
    // path (no token) stops at /intake/done with bundle download.
    const doneParams = new URLSearchParams({ intentId: session.intentId });
    const classroomToken = session.values.classroomToken as string | undefined;
    if (classroomToken) doneParams.set("token", classroomToken);
    redirectUrl = `/intake/done?${doneParams.toString()}`;
  }

  return NextResponse.json({
    events: session.events,
    suggestions: [],
    values: session.values,
    messages: session.messages,
    redirectUrl,
  });
}

// ── Readiness gate ─────────────────────────────────────────────────

function isReady(values: Record<string, unknown>): boolean {
  // Inline mirror of EnrollmentIntake.readiness — kept inline (rather
  // than calling spec.readiness) because the spec predicate expects a
  // materialised ReadinessCtx and we have only the values snapshot.
  // The two stay in step by virtue of the field-key set being short.
  const has = (k: string): boolean => {
    const v = values[k];
    return v !== undefined && v !== null && v !== "";
  };
  return has("firstName") && has("lastName") && has("email") && has("ageRange");
}

/**
 * Deterministic next-question fallback. Mirrors the field ordering in
 * `isReady()`. Returns "" when readiness is already satisfied — the
 * commit path will redirect and the chat doesn't need to say anything.
 *
 * Used when the AI call returns a tool call with no accompanying text
 * (a common shape Claude produces after `update-setup` fires). Keeps
 * the chat visibly flowing instead of showing a blank assistant turn.
 */
function nextQuestionFor(values: Record<string, unknown>): string {
  const has = (k: string): boolean => {
    const v = values[k];
    return v !== undefined && v !== null && v !== "";
  };
  if (!has("firstName")) return "What's your first name?";
  if (!has("lastName")) return "Thanks. What's your last name?";
  if (!has("email")) return "Got it. What's your email?";
  if (!has("ageRange")) {
    return "Last one — which age band fits? Options: 18-24, 25-34, 35-44, 45-54, 55-64, 65-plus, or prefer-not-to-say. (Under-18 enrolment isn't supported via this flow.)";
  }
  return "";
}

// ── AI call — passes the `update-setup` tool ───────────────────────

interface AICallResult {
  readonly text: string;
  readonly provenance: EventAIProvenance;
  readonly toolCalls: readonly ToolCall[];
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
  ].join("\n");

  const response = await aiPort.call(
    {
      model: INTAKE_MODEL,
      prompt,
      promptTemplateVersion: INTAKE_PROMPT_VERSION,
      purpose: PURPOSE.courseDelivery,
      maxCostUsd: INTAKE_MAX_COST_USD,
      tools: [UPDATE_SETUP_TOOL],
    },
    {
      tenant: session.tenant,
      actor: session.actor,
    },
  );

  return {
    text: response.text.trim(),
    toolCalls: response.toolCalls ?? [],
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

function applyToolCalls(
  session: IntakeSession,
  toolCalls: readonly ToolCall[],
): readonly CapturedField[] {
  if (toolCalls.length === 0) return [];
  const captured: CapturedField[] = [];
  for (const call of toolCalls) {
    if (call.name !== UPDATE_SETUP_TOOL_NAME) continue;
    const applied = applyUpdateSetup(session, call, EnrollmentIntake, {
      excludeFields: INTERNAL_FIELDS,
    });
    captured.push(...applied);
  }
  return captured;
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

interface StubResult {
  readonly reply: string;
  readonly captured: readonly CapturedField[];
}

function stubExtractAndReply(session: IntakeSession, userMessage: string): StubResult {
  // Deterministic FSM preserved for offline / no-API-key paths so the
  // audit-bundle fixture remains reproducible and CI tests don't need
  // network. Uses setValue (via spec-tools' applyUpdateSetup) to keep
  // the same write path as the AI tool branch — only the source of
  // the values differs.
  const v = session.values;
  const captured: CapturedField[] = [];

  if (!v.firstName) {
    if (AFFIRMATION_RE.test(userMessage)) {
      return { reply: "Great — what's your first name?", captured };
    }
    const firstName = userMessage.split(/\s+/)[0] ?? userMessage;
    applyStubArgs(session, { firstName }, captured);
    return { reply: "Thanks. And your last name?", captured };
  }
  if (!v.lastName) {
    const lastName = userMessage.split(/\s+/)[0] ?? userMessage;
    applyStubArgs(session, { lastName }, captured);
    return { reply: "What email should we use for this enrolment?", captured };
  }
  if (!v.email) {
    if (!EMAIL_RE.test(userMessage)) {
      return { reply: "That doesn't look like an email. Could you try again?", captured };
    }
    applyStubArgs(session, { email: userMessage }, captured);
    return {
      reply:
        "Got it. That's everything I need — submitting your enrolment now. You'll get a confirmation email shortly.",
      captured,
    };
  }
  return {
    reply: "Your enrolment is already submitted. If you need to update anything, please contact support.",
    captured,
  };
}

function applyStubArgs(
  session: IntakeSession,
  args: Record<string, string>,
  out: CapturedField[],
): void {
  // Synthesise a ToolCall locally so the stub path uses the same
  // applyUpdateSetup validation as the AI path — single write path,
  // no second guard to drift.
  const stubCall: ToolCall = {
    id: `stub-${Date.now()}` as ToolCall["id"],
    name: UPDATE_SETUP_TOOL_NAME,
    args: args as unknown as ToolCall["args"],
    argsHash: "stub" as ToolCall["argsHash"],
  };
  const applied = applyUpdateSetup(session, stubCall, EnrollmentIntake, {
    excludeFields: INTERNAL_FIELDS,
  });
  out.push(...applied);
}
