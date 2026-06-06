/**
 * Shared voice route handlers (AnyVoice #1079).
 *
 * All four voice routes (`webhook`, `tools`, `assistant-request`,
 * `knowledge`) used to live as VAPI-specific POST functions under
 * `app/api/vapi/*`. This file extracts them into slug-parameterised
 * handlers so the new `app/api/voice/[slug]/*` routes can dispatch by
 * slug without duplicating the business logic.
 *
 * Each handler:
 *   1. Resolves the adapter via `getVoiceProvider(slug)`
 *   2. Verifies the inbound signature via the adapter
 *   3. Checks capabilities (knowledge/tools routes return 404 when
 *      the provider doesn't expose that surface)
 *   4. Delegates transport parsing to the adapter, runs DB / RAG /
 *      pipeline logic against the canonical normalised shape
 *
 * The old `app/api/vapi/*` routes are thin 307 redirects to
 * `app/api/voice/vapi/*` so HMAC verification runs exactly once on
 * the canonical route (TL revision on #1079).
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { renderProviderPrompt } from "@/lib/prompt/composition/renderPromptSummary";
import { resolveRuntimeFeatures } from "@/lib/voice/runtime-features";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { resolveVoiceProviderForCaller } from "@/lib/voice/resolve-voice-provider";
import { getVoiceCallSettings } from "@/lib/system-settings";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { loadToolDefinitions } from "@/lib/voice/load-tool-definitions";
import { routeToolCall } from "@/lib/voice/tool-router";
import { embedText } from "@/lib/embeddings";
import { retrieveKnowledgeForPrompt } from "@/lib/knowledge/retriever";
import { getKnowledgeRetrievalSettings } from "@/lib/system-settings";
import {
  getTeachingSourceIdsForDomain,
  getTeachingSourceIdsForPlaybook,
} from "@/lib/knowledge/domain-sources";
import {
  searchAssertionsHybrid,
  searchAssertions,
  searchCallerMemories,
  searchQuestions,
  searchVocabulary,
  formatAssertion,
  formatQuestion,
  formatVocabulary,
} from "@/lib/knowledge/assertions";
import type {
  EndOfCallEventKind,
  NormalisedEndOfCallCapture,
  NormalisedEndOfCallEvent,
} from "@/lib/voice/types";
import { startVoiceSpan, logVoiceEvent } from "@/lib/voice/telemetry";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { broadcastToCall } from "@/lib/voice/sse-registry";
import { log } from "@/lib/logger";

// `getVoiceSystemSettings` is imported for the existing cost-cap
// trickle below AND for the assistant-request handler's cost-safety
// knobs (PR voice-cost-knobs).

/** Extract a human-readable message from a caught unknown-typed value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// In-memory state for the trickle handler (AnyVoice #1080).
// Reset on process restart — the cold-start case logs one event with
// the full cumulative (looks like a spike) which is acceptable and
// documented behaviour. Cross-instance state is intentional: cap dedup
// works per-instance and the duplicate end-call API call is harmless
// (provider returns 4xx for already-ended calls).
const _lastCumulativeUsdByCallId = new Map<string, number>();
const _endingCalls = new Set<string>();

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a voice provider webhook event (end-of-call / status-update).
 *
 * #1079 split-event support: when the adapter declares
 * `endOfCallEvents: "split"`, the route handles two arrivals per call.
 *   eventKind === "basic"    → upsert Call row, skip pipeline trigger
 *   eventKind === "analysis" → update Call row with analysis fields,
 *                              THEN trigger pipeline
 *   eventKind === "full"     → upsert + trigger (current VAPI flow)
 *
 * Merge is by `(externalId, source=slug)` via findFirst — externalId
 * is indexed but not unique on Call, so we must scope by source.
 */
export async function handleVoiceWebhookPost(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  const endSpan = startVoiceSpan({
    slug,
    operation: `voice:${slug}:webhook`,
  });
  // #922 — every webhook arrival logs `voice.webhook.arrive` so the
  // next "end-of-call never landed" report can be answered in one
  // /x/logs query: did VAPI actually POST to us at all?
  log("api", "voice.webhook.arrive", {
    level: "info",
    slug,
    contentLength: request.headers.get("content-length") ?? null,
    hasVapiSignature: request.headers.get("x-vapi-signature") !== null,
    userAgent: request.headers.get("user-agent") ?? null,
  });
  try {
    const rawBody = await request.text();
    const provider = await getVoiceProvider(slug);
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) {
      log("system", "voice.webhook.auth_failed", {
        level: "error",
        slug,
        bodyLen: rawBody.length,
      });
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:auth:invalid-signature`,
        durationMs: 0,
      });
      endSpan({ metadata: { authFailed: true } });
      return authError;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      log("system", "voice.webhook.bad_json", {
        level: "error",
        slug,
        bodyLen: rawBody.length,
        bodyHead: rawBody.slice(0, 200),
      });
      endSpan({ errorMessage: "Invalid JSON body" });
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    // #922 — sniff event-shape hints from the body so the next "no
    // end-of-call" report shows whether VAPI sent a message-shaped
    // payload at all. VAPI nests under `message.type`.
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const msg = (bodyObj.message ?? null) as Record<string, unknown> | null;
    const sniff = {
      messageType: typeof msg?.type === "string" ? (msg.type as string) : null,
      rootType: typeof bodyObj.type === "string" ? (bodyObj.type as string) : null,
      hasCallId:
        typeof (msg?.call as Record<string, unknown> | undefined)?.id === "string" ||
        typeof bodyObj.callId === "string",
    };

    const event = provider.normaliseEndOfCallEvent(body);
    if (event) {
      log("api", "voice.webhook.end_of_call", {
        level: "info",
        slug,
        eventKind: event.eventKind,
        externalCallId: event.externalCallId,
        endedReason: event.capture?.endedReason ?? null,
        transcriptLen: event.transcript?.length ?? 0,
        ...sniff,
      });
      const resp = await handleEndOfCallEvent(event, slug);
      endSpan({
        metadata: { kind: "end-of-call", eventKind: event.eventKind },
      });
      return resp;
    }

    // Status-update trickle + cost cap (AnyVoice #1080). Adapter
    // declares the parser; if it doesn't, this branch no-ops. Response
    // returns IMMEDIATELY — the trickle/cap work runs in setImmediate
    // so we don't block VAPI's webhook timeout.
    const statusUpdate = provider.normaliseStatusUpdate?.(body);
    if (statusUpdate) {
      log("api", "voice.webhook.status_update", {
        level: "info",
        slug,
        ...sniff,
      });
      setImmediate(() => {
        processStatusUpdate(statusUpdate, slug, provider).catch((err) => {
          console.error(
            `[voice/${slug}/webhook] status-update post-process error:`,
            err,
          );
        });
      });
      endSpan({ metadata: { kind: "status-update" } });
      return NextResponse.json({ ok: true });
    }

    // #1092 — incremental transcript broadcast. VAPI fires both
    // `conversation-update` (full transcript so far) and
    // `transcript` (partial chunks). Either shape carries enough
    // for the chat surface to show the running conversation. Broadcast
    // via setImmediate so the webhook response stays inside VAPI's
    // ack budget.
    const transcriptUpdate = parseTranscriptUpdate(body, slug);
    if (transcriptUpdate) {
      log("api", "voice.webhook.transcript_update", {
        level: "info",
        slug,
        externalCallId: (transcriptUpdate as Record<string, unknown>).externalCallId ?? null,
        ...sniff,
      });
      setImmediate(() => {
        processTranscriptUpdate(transcriptUpdate, slug).catch((err) => {
          console.error(
            `[voice/${slug}/webhook] transcript broadcast failed:`,
            err,
          );
        });
      });
      endSpan({ metadata: { kind: "transcript-update" } });
      return NextResponse.json({ ok: true });
    }

    // Unhandled event types (ping, etc.) just ack.
    log("api", "voice.webhook.ignored", {
      level: "info",
      slug,
      ...sniff,
    });
    endSpan({ metadata: { kind: "ignored" } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    log("system", "voice.webhook.error", {
      level: "error",
      slug,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    console.error(`[voice/${slug}/webhook] Error:`, error);
    endSpan({ errorMessage: errorMessage(error) ?? "Webhook processing failed" });
    return NextResponse.json(
      { error: errorMessage(error) || "Webhook processing failed" },
      { status: 500 },
    );
  }
}

/**
 * Status-update post-processor (AnyVoice #1080). Runs in setImmediate
 * — must not throw past `processStatusUpdate`'s catch — and writes
 * one UsageEvent per delta-minute. Triggers requestEndCall when
 * cumulative cost crosses the system cap.
 */
async function processStatusUpdate(
  status: {
    externalCallId: string;
    costSoFarUsd: number | null;
    durationSecondsSoFar: number | null;
  },
  slug: string,
  provider: Awaited<ReturnType<typeof getVoiceProvider>>,
): Promise<void> {
  const { externalCallId, costSoFarUsd } = status;
  if (costSoFarUsd === null) return;

  const prev = _lastCumulativeUsdByCallId.get(externalCallId) ?? 0;

  // Out-of-order guard: VAPI is at-least-once delivery. If a delayed
  // earlier event arrives, skip the write — no negative deltas.
  if (costSoFarUsd <= prev) return;

  const deltaUsd = costSoFarUsd - prev;
  _lastCumulativeUsdByCallId.set(externalCallId, costSoFarUsd);

  // Resolve callId — look up the Call row by externalId + source. Best
  // effort; if no row yet (basic event still in-flight) we still log
  // the event with callId=null.
  const callRow = await prisma.call.findFirst({
    where: { externalId: externalCallId, source: slug },
    select: { id: true, callerId: true },
  });

  logVoiceEvent({
    slug,
    operation: `voice:${slug}:webhook:status-update`,
    durationMs: 0,
    costCents: Math.round(deltaUsd * 100),
    callId: callRow?.id ?? null,
    callerId: callRow?.callerId ?? null,
    metadata: {
      cumulativeUsd: costSoFarUsd,
      deltaUsd,
      durationSecondsSoFar: status.durationSecondsSoFar,
    },
  });

  // Cost-cap check
  const sys = await getVoiceSystemSettings();
  const cap = sys.maxCostPerCallUsd;
  if (cap === null || cap === undefined) return;
  if (costSoFarUsd < cap) return;

  // Cap tripped. Dedup with in-memory set.
  if (_endingCalls.has(externalCallId)) return;
  _endingCalls.add(externalCallId);

  const caps = provider.getCapabilities();
  if (!caps.supportsRequestEndCall || !provider.requestEndCall) {
    logVoiceEvent({
      slug,
      operation: `voice:${slug}:webhook:cap-tripped`,
      durationMs: 0,
      callId: callRow?.id ?? null,
      callerId: callRow?.callerId ?? null,
      metadata: {
        cumulativeUsd: costSoFarUsd,
        capUsd: cap,
        ended: false,
        reason: "provider-does-not-support-end-call",
      },
    });
    return;
  }

  try {
    await provider.requestEndCall(externalCallId);
    logVoiceEvent({
      slug,
      operation: `voice:${slug}:webhook:cap-tripped`,
      durationMs: 0,
      callId: callRow?.id ?? null,
      callerId: callRow?.callerId ?? null,
      metadata: { cumulativeUsd: costSoFarUsd, capUsd: cap, ended: true },
    });
  } catch (err) {
    console.error(
      `[voice/${slug}/webhook] requestEndCall failed for ${externalCallId}:`,
      err,
    );
  }
}

/** For tests: clear in-memory trickle/cap state between runs. */
export function _resetTrickleState(): void {
  _lastCumulativeUsdByCallId.clear();
  _endingCalls.clear();
}

// ═══════════════════════════════════════════════════════════════════
// Transcript broadcast (#1092)
// ═══════════════════════════════════════════════════════════════════

interface ParsedTranscriptUpdate {
  externalCallId: string;
  role: "learner" | "assistant";
  text: string;
}

/**
 * Parse VAPI's `conversation-update` / `transcript` event into a
 * normalised shape. Returns null when the event isn't a transcript or
 * carries no incremental text. Retell support arrives with the WSS
 * route in a follow-up story; for now this is VAPI-shaped.
 */
function parseTranscriptUpdate(
  body: unknown,
  slug: string,
): ParsedTranscriptUpdate | null {
  if (slug !== "vapi") return null;
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const message = (root.message ?? root) as Record<string, unknown>;
  const type = (message.type ?? root.type) as string | undefined;
  if (type !== "transcript" && type !== "conversation-update") return null;

  const call = (message.call ?? root.call) as
    | Record<string, unknown>
    | undefined;
  const externalCallId =
    (call?.id as string | undefined) ??
    (call?.callId as string | undefined) ??
    (call?.call_id as string | undefined);
  if (!externalCallId) return null;

  // VAPI's `transcript` event shape: { type: "transcript",
  // transcript: "...", role: "user"|"assistant", transcriptType: ... }
  const rawText =
    (message.transcript as string | undefined) ??
    (message.text as string | undefined) ??
    "";
  if (!rawText) return null;

  const rawRole = (message.role as string | undefined) ?? "user";
  const role: "learner" | "assistant" =
    rawRole === "assistant" ? "assistant" : "learner";

  return { externalCallId, role, text: rawText };
}

async function processTranscriptUpdate(
  parsed: ParsedTranscriptUpdate,
  slug: string,
): Promise<void> {
  const callRow = await prisma.call.findFirst({
    where: { externalId: parsed.externalCallId, source: slug },
    select: { id: true, callerId: true },
  });
  if (!callRow) return;

  await broadcastToCall({
    type: "transcript-partial",
    callId: callRow.id,
    role: parsed.role,
    text: parsed.text,
    timestampMs: Date.now(),
  });

  logVoiceEvent({
    slug,
    operation: `voice:${slug}:webhook:transcript-update`,
    durationMs: 0,
    callId: callRow.id,
    callerId: callRow.callerId,
    metadata: { role: parsed.role, chars: parsed.text.length },
  });
}

/** Structured result of `persistEndOfCall` — wraps the older NextResponse
 *  shape. Webhook caller re-wraps via `NextResponse.json(result)`; poll
 *  caller (#1178) reads directly. */
export interface PersistEndOfCallResult {
  ok: true;
  callId: string;
  callerId?: string | null;
  merged?: boolean;
  /** Set to true when an atomic update with `where: { id, endedAt: null }`
   *  matched zero rows — race lost to a faster writer (typically the
   *  webhook landing during the poll cycle). Caller should treat this as
   *  benign no-op success. */
  skippedRace?: boolean;
}

export interface PersistEndOfCallOptions {
  /** Where the event came from. "webhook" preserves the pre-#1178
   *  behaviour (find-or-create, no atomic guard). "fallback" forces an
   *  atomic update with `endedAt: null` guard AND tags
   *  `voiceProviderRaw.pollSource = "fallback"` for forensic
   *  distinguishability. */
  sourceTag?: "webhook" | "fallback";
}

/**
 * Persist a normalised end-of-call event to the `Call` row + downstream
 * triggers (SSE broadcast, pipeline run, caller-by-phone create).
 *
 * Exported in #1178 — the poll fallback path needs to call this without
 * an internal-fetch round-trip. The webhook handler (`handleVoiceWebhookPost`)
 * still uses it via `handleEndOfCallEvent` which re-wraps the structured
 * result as a NextResponse.
 *
 * Race safety (poll path only): `sourceTag: "fallback"` triggers an
 * atomic update with `where: { id, endedAt: null }` so a webhook that
 * lands during the poll cycle wins without producing double-writes.
 */
export async function persistEndOfCall(
  event: NormalisedEndOfCallEvent,
  slug: string,
  options: PersistEndOfCallOptions = {},
): Promise<PersistEndOfCallResult> {
  const {
    eventKind,
    externalCallId,
    customerPhone,
    customerName,
    transcript,
    capture,
    providerRaw,
  } = event;
  const sourceTag = options.sourceTag ?? "webhook";

  // Find existing Call row scoped by (externalId, source=slug). Two
  // providers could theoretically share an externalId — the source
  // tag disambiguates. Cheaper than an @@unique migration for now.
  const existing = await prisma.call.findFirst({
    where: { externalId: externalCallId, source: slug },
  });

  // Map canonical capture keys to Call columns. Same mapping as the
  // pre-#1079 VAPI route — kept explicit for grep-ability.
  const persistableCapture: Record<string, unknown> = {};
  if (capture.recordingUrl !== undefined) persistableCapture.recordingUrl = capture.recordingUrl;
  if (capture.stereoRecordingUrl !== undefined) persistableCapture.stereoRecordingUrl = capture.stereoRecordingUrl;
  if (capture.durationSeconds !== undefined) persistableCapture.voiceDurationSeconds = capture.durationSeconds;
  if (capture.endedReason !== undefined) persistableCapture.voiceEndedReason = capture.endedReason;
  if (capture.costUsd !== undefined) persistableCapture.voiceCostUsd = capture.costUsd;
  if (capture.analysisSummary !== undefined) persistableCapture.voiceAnalysisSummary = capture.analysisSummary;
  if (capture.structuredData !== undefined) persistableCapture.voiceStructuredData = capture.structuredData as Prisma.InputJsonValue;
  if (capture.successEvaluation !== undefined) persistableCapture.voiceSuccessEvaluation = capture.successEvaluation;
  if (providerRaw !== undefined && providerRaw !== null) {
    // Annotate poll-sourced raws so forensic queries can distinguish
    // them from webhook-sourced raws (#1178 TL required AC 6).
    const annotated =
      sourceTag === "fallback" && typeof providerRaw === "object" && providerRaw !== null
        ? { ...(providerRaw as Record<string, unknown>), pollSource: "fallback" }
        : providerRaw;
    persistableCapture.voiceProviderRaw = annotated as Prisma.InputJsonValue;
  }

  if (existing) {
    // Split-event merge: analysis arriving for an earlier basic write.
    // OR poll fallback: a stale row that never got its webhook.
    //
    // For sourceTag="fallback" we use an atomic update with
    // `where: { id, endedAt: null }` so a webhook that lands during
    // the poll cycle wins (the poll's update becomes a no-op via
    // P2025). For sourceTag="webhook" we keep the pre-#1178 behaviour.
    const updateWhere =
      sourceTag === "fallback"
        ? { id: existing.id, endedAt: null }
        : { id: existing.id };
    const updateData: Prisma.CallUpdateInput = {
      // Only overwrite transcript if the new event actually carried one
      ...(transcript ? { transcript } : {}),
      ...persistableCapture,
      // Poll path always stamps endedAt — the row is stale by definition.
      ...(sourceTag === "fallback" ? { endedAt: new Date() } : {}),
    };
    let updated;
    try {
      updated = await prisma.call.update({
        where: updateWhere as Prisma.CallWhereUniqueInput,
        data: updateData,
      });
    } catch (err) {
      // Prisma P2025 — record not found by the where clause. This is the
      // race-loss path for sourceTag="fallback": webhook landed between
      // our findFirst and update. Treat as benign success.
      if (
        sourceTag === "fallback" &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return {
          ok: true,
          callId: existing.id,
          merged: true,
          skippedRace: true,
        };
      }
      throw err;
    }

    // Pipeline trigger fires only on "full" or "analysis" — never on
    // bare "basic" (the row is half-complete). For "full" we already
    // ran this branch on first arrival; this branch is duplicate-call
    // territory and we skip re-triggering. Poll fallback always
    // qualifies (it's a full event by definition — VAPI's /call/{id}
    // returns the merged final state).
    const shouldTriggerPipeline =
      eventKind === "analysis" || sourceTag === "fallback";
    if (shouldTriggerPipeline && updated.callerId) {
      triggerPipeline(updated.id, updated.callerId).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] Pipeline trigger failed for call ${updated.id}:`,
          err,
        );
      });
    }
    return { ok: true, callId: updated.id, merged: true };
  }

  // First arrival: find or create caller by phone (basic + full both
  // need this; analysis-only-first is unusual but handled the same way).
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
    }
  }

  // Active prompt that was used
  let usedPromptId: string | null = null;
  if (callerId) {
    const activePrompt = await prisma.composedPrompt.findFirst({
      where: { callerId, status: "active" },
      orderBy: { composedAt: "desc" },
      select: { id: true },
    });
    usedPromptId = activePrompt?.id || null;
  }

  const playbookId = callerId ? await resolvePlaybookId(callerId) : null;

  let nextSequence: number | null = null;
  if (callerId) {
    const lastCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { callSequence: "desc" },
      select: { callSequence: true },
    });
    nextSequence = (lastCall?.callSequence ?? 0) + 1;
  }

  const endedAt = new Date();

  const newCall = await prisma.call.create({
    data: {
      externalId: externalCallId,
      source: slug,
      voiceProvider: slug,
      transcript: transcript || "(no transcript)",
      callerId,
      usedPromptId,
      endedAt,
      ...(playbookId ? { playbookId } : {}),
      ...(nextSequence != null ? { callSequence: nextSequence } : {}),
      ...persistableCapture,
    },
  });

  console.log(
    `[voice/${slug}/webhook] Created call ${newCall.id} from ${slug} ${externalCallId} (eventKind=${eventKind})` +
      (callerId ? ` for caller ${callerId}` : ""),
  );

  // #1092 — broadcast call-ended so any subscribed chat surface can
  // tear down the SSE / change its UI. Fire-and-forget so the webhook
  // response stays inside VAPI's ack budget.
  broadcastToCall({
    type: "call-ended",
    callId: newCall.id,
    reason: capture.endedReason ?? null,
    totalDurationMs:
      typeof capture.durationSeconds === "number"
        ? Math.round(capture.durationSeconds * 1000)
        : null,
    timestampMs: Date.now(),
  }).catch((err) =>
    console.warn(`[voice/${slug}/webhook] call-ended broadcast failed:`, err),
  );

  // Pipeline gating per #1079: skip on bare "basic" — analysis will
  // arrive later and fire the pipeline against the merged row.
  if (eventKind !== "basic") {
    const vs = await getVoiceCallSettings();
    if (vs.autoPipeline && callerId) {
      triggerPipeline(newCall.id, callerId).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] Pipeline trigger failed for call ${newCall.id}:`,
          err,
        );
      });
    }
  }

  return { ok: true, callId: newCall.id, callerId };
}

/**
 * Thin wrapper that preserves the pre-#1178 NextResponse-returning shape
 * for the webhook handler. The structured `persistEndOfCall` is the
 * canonical entry point — this exists only so `handleVoiceWebhookPost`
 * keeps its existing call shape.
 */
async function handleEndOfCallEvent(
  event: NormalisedEndOfCallEvent,
  slug: string,
): Promise<NextResponse> {
  const result = await persistEndOfCall(event, slug, { sourceTag: "webhook" });
  return NextResponse.json(result);
}

async function triggerPipeline(callId: string, callerId: string): Promise<void> {
  const baseUrl = config.app.url;
  const response = await fetch(`${baseUrl}/api/calls/${callId}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": config.security.internalApiSecret,
    },
    body: JSON.stringify({ callerId, mode: "prompt" }),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON response */
  }
  if (!response.ok || body?.ok === false) {
    console.error(
      `[voice/webhook] Pipeline failed for call ${callId}:`,
      body?.error || `HTTP ${response.status}`,
    );
  }
}

// Re-export EndOfCallEventKind so route files can describe what
// they pass through without re-importing from types.
export type { EndOfCallEventKind, NormalisedEndOfCallCapture };

// ═══════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Tool-call route. Returns 404 when the provider declares
 * `toolCallsOverWebSocket: true` — tools for that provider arrive on
 * the WSS handler, not this HTTP path.
 */
export async function handleVoiceToolsPost(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  try {
    const provider = await getVoiceProvider(slug);

    if (provider.getCapabilities().toolCallsOverWebSocket) {
      return NextResponse.json(
        {
          error: `Provider "${slug}" delivers tool calls over WebSocket, not HTTP. Use the WSS handler.`,
        },
        { status: 404 },
      );
    }

    const rawBody = await request.text();
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) {
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:auth:invalid-signature`,
        durationMs: 0,
      });
      return authError;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { toolCalls, customerPhone, externalCallId } =
      provider.normaliseToolCallList(body);

    let callerId: string | null = null;
    if (customerPhone) {
      const caller = await prisma.caller.findFirst({
        where: { phone: customerPhone.replace(/\s+/g, "") },
        select: { id: true },
      });
      callerId = caller?.id || null;
    }

    // #1092 — resolve local Call.id from the provider's externalCallId
    // so the rail router can check the SSE subscriber registry.
    // Scoped by source=slug per the merge invariant in #1079 (externalId
    // is indexed but not unique; two providers could share a value).
    let callId: string | null = null;
    if (externalCallId) {
      const callRow = await prisma.call.findFirst({
        where: { externalId: externalCallId, source: slug },
        select: { id: true },
      });
      callId = callRow?.id ?? null;
    }

    const results = [];
    for (const toolCall of toolCalls) {
      const toolStart = Date.now();
      const out = await routeToolCall(toolCall, {
        callerId,
        customerPhone,
        callId,
        voiceProviderSlug: slug,
      });
      const actualMs = Date.now() - toolStart;
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:tool:${toolCall.funcName}`,
        durationMs: actualMs,
        callerId,
        callId,
        metadata: {
          actualMs,
          toolCallId: toolCall.toolCallId,
          rail: out.rail ?? "inline",
          // budgetExceeded flag wired in once TOOLS-001 entries
          // carry maxLatencyMs (#1080 acceptance criterion).
        },
      });
      results.push({ toolCallId: toolCall.toolCallId, result: out.raw });
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    console.error(`[voice/${slug}/tools] Error:`, error);
    return NextResponse.json(
      { error: errorMessage(error) || "Tool dispatch failed" },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// ASSISTANT-REQUEST
// ═══════════════════════════════════════════════════════════════════

/**
 * Call-start route. Builds the provider-shaped assistant config from
 * the caller's active ComposedPrompt + TOOLS-001 enabled tools.
 */
export async function handleVoiceAssistantRequestPost(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  const endSpan = startVoiceSpan({
    slug,
    operation: `voice:${slug}:assistant-request`,
  });
  try {
    const rawBody = await request.text();
    const inbound = await getVoiceProvider(slug);
    const authError = inbound.verifyInboundRequest(request, rawBody);
    if (authError) {
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:auth:invalid-signature`,
        durationMs: 0,
      });
      endSpan({ metadata: { authFailed: true } });
      return authError;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const messageType =
      (body.message as Record<string, unknown> | undefined)?.type ?? body.type;
    if (messageType && messageType !== "assistant-request") {
      return NextResponse.json({ ok: true });
    }

    const message = body.message as Record<string, unknown> | undefined;
    const messageCall = message?.call as Record<string, unknown> | undefined;
    const messageCallCustomer = messageCall?.customer as
      | Record<string, unknown>
      | undefined;
    const rootCall = body.call as Record<string, unknown> | undefined;
    const rootCallCustomer = rootCall?.customer as
      | Record<string, unknown>
      | undefined;
    const customerPhone =
      (messageCallCustomer?.number as string | undefined) ??
      (rootCallCustomer?.number as string | undefined) ??
      null;
    if (!customerPhone) {
      return NextResponse.json(
        { error: "No customer phone number provided" },
        { status: 400 },
      );
    }

    const vs = await getVoiceCallSettings();
    const sys = await getVoiceSystemSettings();
    const serverUrlBase = `${config.app.url}/api/voice/${slug}`;
    const enabledTools = await loadToolDefinitions();
    // Per-call cost-safety knobs (PR voice-cost-knobs) — same for every
    // call regardless of which fallback branch we hit below.
    const costSafetyKnobs = {
      silenceTimeoutSeconds: sys.silenceTimeoutSeconds,
      maxDurationSeconds: sys.maxDurationSeconds,
      voicemailDetectionEnabled: sys.voicemailDetectionEnabled,
      endCallPhrases: sys.endCallPhrases,
    };

    const normalizedPhone = customerPhone.replace(/\s+/g, "");
    const caller = await prisma.caller.findFirst({
      where: { phone: normalizedPhone },
      select: { id: true, name: true, phone: true },
    });

    if (!caller) {
      return NextResponse.json(
        inbound.buildAssistantConfig({
          callerId: null,
          callerName: null,
          customerPhone: normalizedPhone,
          voicePrompt: vs.unknownCallerPrompt,
          firstLine: "Hello! I don't think we've spoken before. What's your name?",
          toolDefinitions: [],
          knowledgePlanEnabled: false,
          serverUrlBase,
          modelConfig: { provider: vs.provider, model: vs.model },
          unknownCallerPrompt: vs.unknownCallerPrompt,
          noActivePromptFallback: vs.noActivePromptFallback,
          costSafetyKnobs,
        }),
      );
    }

    // Resolve per-caller provider cascade. If the resolver returns a
    // different slug than the inbound URL, log and fall back to the
    // URL-bound adapter — keeps the in-flight call working. Per-caller
    // routing matters at outbound-dial time, not for inbound webhooks.
    const resolved = await resolveVoiceProviderForCaller(caller.id);
    let responseProvider = inbound;
    if (resolved.slug === slug) {
      responseProvider = await getVoiceProvider(resolved.slug);
    } else {
      console.warn(
        `[voice/${slug}/assistant-request] Caller ${caller.id} configured for provider "${resolved.slug}" (source=${resolved.source}) but inbound is via /api/voice/${slug}; serving via ${slug} adapter to keep the in-flight call working.`,
      );
    }

    const defaultPlaybookId = await resolvePlaybookId(caller.id);
    const composedPrompt = await prisma.composedPrompt.findFirst({
      where: {
        callerId: caller.id,
        status: "active",
        ...(defaultPlaybookId ? { playbookId: defaultPlaybookId } : {}),
      },
      orderBy: { composedAt: "desc" },
      select: { id: true, llmPrompt: true, prompt: true },
    });

    if (!composedPrompt?.llmPrompt) {
      const callerLabel = caller.name || "a returning caller";
      return NextResponse.json(
        responseProvider.buildAssistantConfig({
          callerId: caller.id,
          callerName: caller.name,
          customerPhone: normalizedPhone,
          voicePrompt: `${vs.noActivePromptFallback} The caller is ${callerLabel}.`,
          firstLine: `Hi${caller.name ? ` ${caller.name}` : ""}! Good to hear from you.`,
          toolDefinitions: [],
          knowledgePlanEnabled: false,
          serverUrlBase,
          modelConfig: { provider: vs.provider, model: vs.model },
          unknownCallerPrompt: vs.unknownCallerPrompt,
          noActivePromptFallback: vs.noActivePromptFallback,
          costSafetyKnobs,
        }),
      );
    }

    const llmPrompt = composedPrompt.llmPrompt as Record<string, unknown>;
    // #1093 — pass the resolved provider capabilities + runtime rail
    // snapshot into the renderer so the same ComposedPrompt produces
    // the correct text for VAPI vs Retell vs (no chat rail) etc.
    // `responseProvider` is the cascade-resolved adapter; its
    // capability set is the right source of truth here.
    const responseCaps = responseProvider.getCapabilities();
    const runtime = await resolveRuntimeFeatures({
      callId: null,
      callerId: caller.id,
      intent: "chat",
    });
    const voicePrompt = renderProviderPrompt(
      llmPrompt as Parameters<typeof renderProviderPrompt>[0],
      responseCaps,
      runtime,
    );
    const firstLine =
      ((llmPrompt._quickStart as Record<string, unknown> | undefined)
        ?.first_line as string | null | undefined) ?? null;

    const response = NextResponse.json(
      responseProvider.buildAssistantConfig({
        callerId: caller.id,
        callerName: caller.name,
        customerPhone: normalizedPhone,
        voicePrompt,
        firstLine,
        toolDefinitions: enabledTools,
        knowledgePlanEnabled: vs.knowledgePlanEnabled,
        serverUrlBase,
        modelConfig: { provider: vs.provider, model: vs.model },
        unknownCallerPrompt: vs.unknownCallerPrompt,
        noActivePromptFallback: vs.noActivePromptFallback,
        costSafetyKnobs,
      }),
    );
    endSpan({
      callerId: caller.id,
      metadata: {
        promptChars: voicePrompt.length,
        toolCount: enabledTools.length,
      },
    });
    return response;
  } catch (error: unknown) {
    console.error(`[voice/${slug}/assistant-request] Error:`, error);
    endSpan({ errorMessage: errorMessage(error) ?? "Internal error" });
    return NextResponse.json(
      { error: errorMessage(error) || "Internal error" },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-turn knowledge callback. Returns 404 when the provider declares
 * `hasKnowledgeCallback: false` — that provider uses pre-uploaded IDs
 * and never POSTs here (Retell). Without this guard the route would
 * crash on `buildKnowledgeResponse` (which Retell throws on by design).
 */
export async function handleVoiceKnowledgePost(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  const endSpan = startVoiceSpan({
    slug,
    operation: `voice:${slug}:knowledge-base-request`,
  });
  try {
    const provider = await getVoiceProvider(slug);

    if (!provider.getCapabilities().hasKnowledgeCallback) {
      endSpan({ metadata: { noKnowledgeCallback: true } });
      return NextResponse.json(
        {
          error: `Provider "${slug}" does not expose an HTTP knowledge callback. Configure knowledge via the provider's own mechanism (e.g. pre-uploaded knowledge_base_ids).`,
        },
        { status: 404 },
      );
    }

    const rawBody = await request.text();
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) {
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:auth:invalid-signature`,
        durationMs: 0,
      });
      endSpan({ metadata: { authFailed: true } });
      return authError;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    }

    const parsed = provider.parseKnowledgeBaseRequest(body);
    if (!parsed) {
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    }
    const { messages, customerPhone } = parsed;

    const ks = await getKnowledgeRetrievalSettings();

    const userMessages = messages
      .filter((m) => m.role === "user" && m.content)
      .slice(-ks.queryMessageCount);
    const queryText = userMessages.map((m) => m.content).join(" ");

    if (!queryText) {
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    }

    let callerId: string | null = null;
    let sourceIds: string[] | undefined;
    if (customerPhone) {
      const caller = await prisma.caller.findFirst({
        where: { phone: customerPhone.replace(/\s+/g, "") },
        select: { id: true, domainId: true },
      });
      callerId = caller?.id || null;
      if (callerId) {
        const playbookId = await resolvePlaybookId(callerId);
        if (playbookId) {
          sourceIds = await getTeachingSourceIdsForPlaybook(playbookId);
        } else if (caller?.domainId) {
          sourceIds = await getTeachingSourceIdsForDomain(caller.domainId);
        }
      }
    }

    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await embedText(queryText);
    } catch (err) {
      console.warn(
        `[voice/${slug}/knowledge] Embedding failed, falling back to keyword search:`,
        err,
      );
    }

    const [
      knowledgeResults,
      assertionResults,
      memoryResults,
      questionResults,
      vocabularyResults,
    ] = await Promise.all([
      retrieveKnowledgeForPrompt({
        queryText,
        queryEmbedding,
        callerId: callerId || undefined,
        limit: ks.chunkLimit,
        minRelevance: ks.minRelevance,
      }),
      queryEmbedding
        ? searchAssertionsHybrid(
            queryText,
            queryEmbedding,
            ks.assertionLimit,
            ks.minRelevance,
            sourceIds,
          )
        : searchAssertions(queryText, ks.assertionLimit, sourceIds),
      callerId
        ? searchCallerMemories(callerId, queryText, ks.memoryLimit)
        : Promise.resolve([]),
      searchQuestions(queryText, 5, sourceIds),
      searchVocabulary(queryText, 5, sourceIds),
    ]);

    const results: Array<{ content: string; similarity: number }> = [];
    for (const a of assertionResults) {
      results.push({ content: formatAssertion(a), similarity: a.relevanceScore });
    }
    for (const k of knowledgeResults) {
      results.push({
        content: k.title ? `[${k.title}] ${k.content}` : k.content,
        similarity: k.relevanceScore,
      });
    }
    for (const m of memoryResults) {
      results.push({
        content: `[Caller Memory] ${m.key}: ${m.value}`,
        similarity: m.relevanceScore,
      });
    }
    for (const q of questionResults) {
      results.push({ content: formatQuestion(q), similarity: q.relevanceScore * 0.9 });
    }
    for (const v of vocabularyResults) {
      results.push({ content: formatVocabulary(v), similarity: v.relevanceScore * 0.85 });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, ks.topResults);

    endSpan({ metadata: { resultCount: topResults.length, callerId } });
    return NextResponse.json(provider.buildKnowledgeResponse(topResults));
  } catch (error: unknown) {
    console.error(`[voice/${slug}/knowledge] Error:`, error);
    endSpan({ errorMessage: errorMessage(error) ?? "Knowledge error" });
    try {
      const provider = await getVoiceProvider(slug);
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    } catch {
      return NextResponse.json({ results: [] });
    }
  }
}
