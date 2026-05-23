import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { verifyVapiRequest } from "@/lib/vapi/auth";
import { getVoiceCallSettings } from "@/lib/system-settings";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/webhook
 * @visibility public
 * @scope vapi:webhook
 * @auth webhook-secret
 * @tags vapi, calls, ingest
 * @description Receives VAPI webhook events. Handles end-of-call-report to
 *   create Call records and optionally trigger the analysis pipeline.
 *
 *   Events handled:
 *   - end-of-call-report: Create Call record from VAPI call data; persists
 *     `recordingUrl`, `stereoRecordingUrl`, `vapiDurationSeconds`,
 *     `vapiEndedReason`, `vapiCostUsd`, and the `message.analysis.{summary,
 *     structuredData, successEvaluation}` block when present (depends on
 *     the assistant's analysis plan config). All capture fields are
 *     optional — VAPI sends what its plan generates.
 *   - status-update: Log call status changes
 *
 *   Ref: https://docs.vapi.ai/server-url/events
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const authError = verifyVapiRequest(request, rawBody);
    if (authError) return authError;

    const body = JSON.parse(rawBody);
    const messageType = body.message?.type || body.type;

    switch (messageType) {
      case "end-of-call-report":
        return handleEndOfCallReport(body.message || body);

      case "status-update":
        console.log(
          `[vapi/webhook] Status update: ${body.message?.status || body.status}`,
        );
        return NextResponse.json({ ok: true });

      default:
        // Acknowledge all other events
        return NextResponse.json({ ok: true });
    }
  } catch (error: any) {
    console.error("[vapi/webhook] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Webhook processing failed" },
      { status: 500 },
    );
  }
}

/**
 * Handle VAPI end-of-call-report: create Call record, link to caller, optionally trigger pipeline.
 */
async function handleEndOfCallReport(message: any) {
  const call = message.call || message;
  const vapiCallId = call.id || call.callId || call.call_id;
  const customerPhone = call.customer?.number || null;
  const customerName = call.customer?.name || null;

  if (!vapiCallId) {
    console.warn("[vapi/webhook] end-of-call-report missing call ID");
    return NextResponse.json({ error: "Missing call ID" }, { status: 400 });
  }

  // Check for duplicate
  const existing = await prisma.call.findFirst({
    where: { externalId: vapiCallId },
  });
  if (existing) {
    console.log(`[vapi/webhook] Duplicate call ${vapiCallId}, skipping`);
    return NextResponse.json({ ok: true, duplicate: true, callId: existing.id });
  }

  // Build transcript from messages array or use raw transcript
  let transcript = call.transcript || "";
  if (!transcript && call.messages?.length) {
    transcript = call.messages
      .filter((m: any) => m.role && m.content)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n");
  }

  // Find or create caller by phone
  let callerId: string | null = null;
  if (customerPhone) {
    const normalizedPhone = customerPhone.replace(/\s+/g, "");
    const caller = await prisma.caller.findFirst({
      where: { phone: normalizedPhone },
    });

    if (caller) {
      callerId = caller.id;
    } else {
      // Create new caller
      const newCaller = await prisma.caller.create({
        data: {
          phone: normalizedPhone,
          name: customerName || `Caller ${normalizedPhone.slice(-4)}`,
        },
      });
      callerId = newCaller.id;
      console.log(
        `[vapi/webhook] Created new caller: ${newCaller.id} (***${normalizedPhone.slice(-4)})`,
      );
    }
  }

  // Find the active prompt that was used for this call
  let usedPromptId: string | null = null;
  if (callerId) {
    const activePrompt = await prisma.composedPrompt.findFirst({
      where: { callerId, status: "active" },
      orderBy: { composedAt: "desc" },
      select: { id: true },
    });
    usedPromptId = activePrompt?.id || null;
  }

  // Resolve default playbook for course-scoped calls
  const playbookId = callerId ? await resolvePlaybookId(callerId) : null;

  // Extract VAPI payload fields with optional chaining + type guards.
  // Every field is independently optional — VAPI's `message.analysis` is
  // populated only when the assistant's analysis plan has the matching
  // prompt configured. Persist what's present, leave the rest NULL.
  const capture = extractVapiCapture(message);

  // Stamp callSequence (1, 2, 3...) so the prompt timeline can label this
  // call as "Call N". Without it, the UI shows "—" or jumps. Mirrors the
  // pattern in sim-runner.ts / onboarding-call/route.ts. Only meaningful
  // when callerId is known — VAPI imports without a caller link don't get
  // a sequence (the UI doesn't show them in a per-caller timeline anyway).
  let nextSequence: number | null = null;
  if (callerId) {
    const lastCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { callSequence: "desc" },
      select: { callSequence: true },
    });
    nextSequence = (lastCall?.callSequence ?? 0) + 1;
  }

  // Stamp endedAt — `end-of-call-report` means the call has just ended,
  // so this is the canonical end time. Without it, the composer's
  // recentCalls / callCount loaders (filter: endedAt != null) silently
  // exclude every VAPI call, leaving `callNumber` stuck at 1 and session-
  // specific rules never advancing. Equivalent to `createdAt` for VAPI.
  const endedAt = new Date();

  // Create the Call record
  const newCall = await prisma.call.create({
    data: {
      externalId: vapiCallId,
      source: "vapi",
      transcript: transcript || "(no transcript)",
      callerId: callerId,
      usedPromptId: usedPromptId,
      endedAt,
      ...(playbookId ? { playbookId } : {}),
      ...(nextSequence != null ? { callSequence: nextSequence } : {}),
      ...capture,
    },
  });

  console.log(
    `[vapi/webhook] Created call ${newCall.id} from VAPI ${vapiCallId}` +
      (callerId ? ` for caller ${callerId}` : ""),
  );

  // Optionally trigger pipeline (DB setting overrides env var)
  const vs = await getVoiceCallSettings();
  if (vs.autoPipeline && callerId) {
    // Fire-and-forget pipeline trigger
    triggerPipeline(newCall.id, callerId).catch((err) => {
      console.error(`[vapi/webhook] Pipeline trigger failed for call ${newCall.id}:`, err);
    });
  }

  return NextResponse.json({
    ok: true,
    callId: newCall.id,
    callerId,
  });
}

/**
 * Extract VAPI end-of-call-report capture fields from the webhook message.
 *
 * Returns only the keys whose source values pass a runtime type guard, so the
 * Prisma create call receives exactly the columns it can persist. Every field
 * is independent — VAPI populates `message.analysis.{summary, structuredData,
 * successEvaluation}` only when the assistant's analysis plan has the
 * matching prompt configured, and `message.artifact.*` only when recording
 * is enabled. Treat all source values as untrusted (any shape).
 *
 * Ref: https://docs.vapi.ai/server-url/events
 */
type VapiCapture = {
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  vapiDurationSeconds?: number;
  vapiEndedReason?: string;
  vapiCostUsd?: number;
  vapiAnalysisSummary?: string;
  vapiStructuredData?: Prisma.InputJsonValue;
  vapiSuccessEvaluation?: string;
};

export function extractVapiCapture(message: unknown): VapiCapture {
  if (!message || typeof message !== "object") return {};
  const msg = message as Record<string, unknown>;
  const out: VapiCapture = {};

  const artifact = msg.artifact;
  if (artifact && typeof artifact === "object") {
    const art = artifact as Record<string, unknown>;
    if (typeof art.recordingUrl === "string") out.recordingUrl = art.recordingUrl;
    if (typeof art.stereoRecordingUrl === "string") out.stereoRecordingUrl = art.stereoRecordingUrl;
  }

  if (typeof msg.durationSeconds === "number" && Number.isFinite(msg.durationSeconds)) {
    out.vapiDurationSeconds = msg.durationSeconds;
  }
  if (typeof msg.endedReason === "string") out.vapiEndedReason = msg.endedReason;

  // cost is sometimes a number directly, sometimes nested under `cost.total`
  if (typeof msg.cost === "number" && Number.isFinite(msg.cost)) {
    out.vapiCostUsd = msg.cost;
  } else if (msg.cost && typeof msg.cost === "object") {
    const cost = msg.cost as Record<string, unknown>;
    if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
      out.vapiCostUsd = cost.total;
    }
  }

  const analysis = msg.analysis;
  if (analysis && typeof analysis === "object") {
    const an = analysis as Record<string, unknown>;
    if (typeof an.summary === "string") out.vapiAnalysisSummary = an.summary;
    if (an.structuredData && typeof an.structuredData === "object" && !Array.isArray(an.structuredData)) {
      out.vapiStructuredData = an.structuredData as Prisma.InputJsonValue;
    }
    // successEvaluation can be a string ("true"/"false"/"PASS"), number, or boolean
    // depending on the rubric type. Coerce to string for storage simplicity.
    const se = an.successEvaluation;
    if (typeof se === "string") out.vapiSuccessEvaluation = se;
    else if (typeof se === "boolean" || typeof se === "number") out.vapiSuccessEvaluation = String(se);
  }

  return out;
}

/**
 * Trigger the analysis pipeline for a call (fire-and-forget).
 */
async function triggerPipeline(callId: string, callerId: string) {
  const baseUrl = config.app.url;
  const response = await fetch(`${baseUrl}/api/calls/${callId}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": config.security.internalApiSecret,
    },
    body: JSON.stringify({ callerId, mode: "prompt" }),
  });

  let body: Record<string, any> | null = null;
  try { body = await response.json(); } catch { /* non-JSON response */ }

  if (!response.ok || body?.ok === false) {
    console.error(
      `[vapi/webhook] Pipeline failed for call ${callId}:`,
      body?.error || `HTTP ${response.status}`,
      body?.data?.stageErrors || [],
    );
  } else {
    console.log(
      `[vapi/webhook] Pipeline complete for call ${callId}:`,
      `scores=${body?.data?.scoresCreated ?? 0}`,
      `memories=${body?.data?.memoriesCreated ?? 0}`,
      `prompt=${body?.prompt ? "yes" : "no"}`,
    );
  }
}

