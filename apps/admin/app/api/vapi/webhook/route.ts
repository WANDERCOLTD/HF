import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { extractVapiCapture as extractCanonicalCapture } from "@/lib/voice/providers/vapi";
import { getVoiceCallSettings } from "@/lib/system-settings";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import type { NormalisedEndOfCallCapture } from "@/lib/voice/types";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/webhook
 * @visibility public
 * @scope vapi:webhook
 * @auth webhook-secret
 * @tags vapi, calls, ingest
 * @description Receives VAPI webhook events. Handles end-of-call-report to
 *   create Call records and optionally trigger the analysis pipeline.
 *   The route delegates transport parsing to the VapiProvider adapter
 *   (#1017); only DB persistence and pipeline trigger logic lives here.
 *
 *   Events handled:
 *   - end-of-call-report: Create Call record from the normalised event;
 *     persists recordingUrl, stereoRecordingUrl, voiceDurationSeconds,
 *     voiceEndedReason, voiceCostUsd, and the analysis.{summary,
 *     structuredData, successEvaluation} block when present (now
 *     stored in voiceAnalysisSummary / voiceStructuredData /
 *     voiceSuccessEvaluation columns post-#1020).
 *   - status-update: Log call status changes
 *
 *   Ref: https://docs.vapi.ai/server-url/events
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const provider = await getVoiceProvider("vapi");
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) return authError;

    const body = JSON.parse(rawBody);
    const messageType = body.message?.type || body.type;

    switch (messageType) {
      case "end-of-call-report": {
        const event = provider.normaliseEndOfCallEvent(body);
        if (!event) {
          console.warn("[vapi/webhook] end-of-call-report missing call ID");
          return NextResponse.json({ error: "Missing call ID" }, { status: 400 });
        }
        return handleEndOfCallReport(event);
      }

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
 * Persist a normalised end-of-call event. Provider-agnostic: takes the
 * canonical event shape from the adapter and writes to the Call model.
 * The vapi*-prefixed Prisma columns will rename to voice* in #1020 —
 * the mapping from `event.capture.*` to column names is the one place
 * that stays VAPI-named until that migration lands.
 */
async function handleEndOfCallReport(event: {
  externalCallId: string;
  customerPhone: string | null;
  customerName: string | null;
  transcript: string;
  capture: NormalisedEndOfCallCapture;
}) {
  const { externalCallId, customerPhone, customerName, transcript, capture } = event;

  // Check for duplicate
  const existing = await prisma.call.findFirst({
    where: { externalId: externalCallId },
  });
  if (existing) {
    console.log(`[vapi/webhook] Duplicate call ${externalCallId}, skipping`);
    return NextResponse.json({ ok: true, duplicate: true, callId: existing.id });
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

  // Map canonical capture keys to the current schema column names.
  // Post-#1020 the column names are voice*-prefixed; the mapping is
  // mostly a 1:1 prefix swap but kept explicit so the writer is
  // grep-able and future provider adapters know exactly what shape
  // the Call row expects.
  const persistableCapture: Record<string, unknown> = {};
  if (capture.recordingUrl !== undefined) persistableCapture.recordingUrl = capture.recordingUrl;
  if (capture.stereoRecordingUrl !== undefined) persistableCapture.stereoRecordingUrl = capture.stereoRecordingUrl;
  if (capture.durationSeconds !== undefined) persistableCapture.voiceDurationSeconds = capture.durationSeconds;
  if (capture.endedReason !== undefined) persistableCapture.voiceEndedReason = capture.endedReason;
  if (capture.costUsd !== undefined) persistableCapture.voiceCostUsd = capture.costUsd;
  if (capture.analysisSummary !== undefined) persistableCapture.voiceAnalysisSummary = capture.analysisSummary;
  if (capture.structuredData !== undefined) persistableCapture.voiceStructuredData = capture.structuredData as Prisma.InputJsonValue;
  if (capture.successEvaluation !== undefined) persistableCapture.voiceSuccessEvaluation = capture.successEvaluation;

  // Stamp callSequence (1, 2, 3...) so the prompt timeline can label this
  // call as "Call N". Without it, the UI shows "—" or jumps. Only meaningful
  // when callerId is known.
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
  // so this is the canonical end time. Without it the composer's
  // recentCalls / callCount loaders (filter: endedAt != null) silently
  // exclude every VAPI call.
  const endedAt = new Date();

  const newCall = await prisma.call.create({
    data: {
      externalId: externalCallId,
      source: "vapi",
      transcript: transcript || "(no transcript)",
      callerId: callerId,
      usedPromptId: usedPromptId,
      endedAt,
      ...(playbookId ? { playbookId } : {}),
      ...(nextSequence != null ? { callSequence: nextSequence } : {}),
      ...persistableCapture,
    },
  });

  console.log(
    `[vapi/webhook] Created call ${newCall.id} from VAPI ${externalCallId}` +
      (callerId ? ` for caller ${callerId}` : ""),
  );

  // Optionally trigger pipeline (DB setting overrides env var)
  const vs = await getVoiceCallSettings();
  if (vs.autoPipeline && callerId) {
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

/** Trigger the analysis pipeline for a call (fire-and-forget). */
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

/**
 * Re-export for backward compatibility — the existing test at
 * `tests/lib/vapi-extract-capture.test.ts` imports this name. The
 * canonical extractor lives at `lib/voice/providers/vapi::extractVapiCapture`
 * and returns provider-neutral key names; this shim translates those to
 * the post-#1020 Call-column names (`voice*`-prefixed). The shim now
 * exists purely to keep the test surface stable — once the test imports
 * directly from the canonical extractor + asserts canonical keys, this
 * re-export goes away.
 */
export function extractVapiCapture(message: unknown): Record<string, unknown> {
  const c = extractCanonicalCapture(message);
  const out: Record<string, unknown> = {};
  if (c.recordingUrl !== undefined) out.recordingUrl = c.recordingUrl;
  if (c.stereoRecordingUrl !== undefined) out.stereoRecordingUrl = c.stereoRecordingUrl;
  if (c.durationSeconds !== undefined) out.voiceDurationSeconds = c.durationSeconds;
  if (c.endedReason !== undefined) out.voiceEndedReason = c.endedReason;
  if (c.costUsd !== undefined) out.voiceCostUsd = c.costUsd;
  if (c.analysisSummary !== undefined) out.voiceAnalysisSummary = c.analysisSummary;
  if (c.structuredData !== undefined) out.voiceStructuredData = c.structuredData;
  if (c.successEvaluation !== undefined) out.voiceSuccessEvaluation = c.successEvaluation;
  return out;
}
