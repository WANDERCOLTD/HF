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
  try {
    const rawBody = await request.text();
    const provider = await getVoiceProvider(slug);
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
      endSpan({ errorMessage: "Invalid JSON body" });
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const event = provider.normaliseEndOfCallEvent(body);
    if (event) {
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

    // Unhandled event types (ping, etc.) just ack.
    endSpan({ metadata: { kind: "ignored" } });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(`[voice/${slug}/webhook] Error:`, error);
    endSpan({ errorMessage: error?.message ?? "Webhook processing failed" });
    return NextResponse.json(
      { error: error?.message || "Webhook processing failed" },
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

async function handleEndOfCallEvent(
  event: NormalisedEndOfCallEvent,
  slug: string,
): Promise<NextResponse> {
  const {
    eventKind,
    externalCallId,
    customerPhone,
    customerName,
    transcript,
    capture,
    providerRaw,
  } = event;

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
    persistableCapture.voiceProviderRaw = providerRaw as Prisma.InputJsonValue;
  }

  if (existing) {
    // Split-event merge: analysis arriving for an earlier basic write.
    const updated = await prisma.call.update({
      where: { id: existing.id },
      data: {
        // Only overwrite transcript if the new event actually carried one
        ...(transcript ? { transcript } : {}),
        ...persistableCapture,
      },
    });

    // Pipeline trigger fires only on "full" or "analysis" — never on
    // bare "basic" (the row is half-complete). For "full" we already
    // ran this branch on first arrival; this branch is duplicate-call
    // territory and we skip re-triggering.
    if (eventKind === "analysis" && updated.callerId) {
      triggerPipeline(updated.id, updated.callerId).catch((err) => {
        console.error(
          `[voice/${slug}/webhook] Pipeline trigger failed for call ${updated.id}:`,
          err,
        );
      });
    }
    return NextResponse.json({ ok: true, callId: updated.id, merged: true });
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

  // Pipeline gating per #1079: skip on bare "basic" — analysis will
  // arrive later and fire the pipeline against the merged row.
  if (eventKind !== "basic") {
    const vs = await getVoiceCallSettings();
    if (vs.autoPipeline && callerId) {
      triggerPipeline(newCall.id, callerId).catch((err) => {
        console.error(
          `[voice/${slug}/webhook] Pipeline trigger failed for call ${newCall.id}:`,
          err,
        );
      });
    }
  }

  return NextResponse.json({ ok: true, callId: newCall.id, callerId });
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
  let body: Record<string, any> | null = null;
  try {
    body = await response.json();
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

    const { toolCalls, customerPhone } = provider.normaliseToolCallList(body);

    let callerId: string | null = null;
    if (customerPhone) {
      const caller = await prisma.caller.findFirst({
        where: { phone: customerPhone.replace(/\s+/g, "") },
        select: { id: true },
      });
      callerId = caller?.id || null;
    }

    const results = [];
    for (const toolCall of toolCalls) {
      const toolStart = Date.now();
      const out = await routeToolCall(toolCall, { callerId, customerPhone });
      const actualMs = Date.now() - toolStart;
      logVoiceEvent({
        slug,
        operation: `voice:${slug}:tool:${toolCall.funcName}`,
        durationMs: actualMs,
        callerId,
        metadata: {
          actualMs,
          toolCallId: toolCall.toolCallId,
          // budgetExceeded flag wired in once TOOLS-001 entries
          // carry maxLatencyMs (#1080 acceptance criterion).
        },
      });
      results.push({ toolCallId: toolCall.toolCallId, result: out.raw });
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error(`[voice/${slug}/tools] Error:`, error);
    return NextResponse.json(
      { error: error?.message || "Tool dispatch failed" },
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

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const messageType = body.message?.type || body.type;
    if (messageType && messageType !== "assistant-request") {
      return NextResponse.json({ ok: true });
    }

    const customerPhone =
      body.message?.call?.customer?.number ||
      body.call?.customer?.number ||
      null;
    if (!customerPhone) {
      return NextResponse.json(
        { error: "No customer phone number provided" },
        { status: 400 },
      );
    }

    const vs = await getVoiceCallSettings();
    const serverUrlBase = `${config.app.url}/api/voice/${slug}`;
    const enabledTools = await loadToolDefinitions();

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
        }),
      );
    }

    const voicePrompt = renderProviderPrompt(composedPrompt.llmPrompt as any);
    const firstLine =
      (composedPrompt.llmPrompt as any)?._quickStart?.first_line ?? null;

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
  } catch (error: any) {
    console.error(`[voice/${slug}/assistant-request] Error:`, error);
    endSpan({ errorMessage: error?.message ?? "Internal error" });
    return NextResponse.json(
      { error: error?.message || "Internal error" },
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
      .filter((m: any) => m.role === "user" && m.content)
      .slice(-ks.queryMessageCount);
    const queryText = userMessages.map((m: any) => m.content).join(" ");

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
  } catch (error: any) {
    console.error(`[voice/${slug}/knowledge] Error:`, error);
    endSpan({ errorMessage: error?.message ?? "Knowledge error" });
    try {
      const provider = await getVoiceProvider(slug);
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    } catch {
      return NextResponse.json({ results: [] });
    }
  }
}
