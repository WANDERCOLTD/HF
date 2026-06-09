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
  ParsedTranscriptUpdate,
} from "@/lib/voice/types";
import { startVoiceSpan, logVoiceEvent } from "@/lib/voice/telemetry";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";
import { isSessionModelV2Enabled } from "@/lib/voice/session-flag";
import { createSession } from "@/lib/voice/create-session";
import { endSession } from "@/lib/voice/end-session";
import { broadcastToCall } from "@/lib/voice/sse-registry";
import {
  UNKNOWN_CALLER_FIRST_LINE,
  noActivePromptFirstLine,
} from "@/lib/prompt/composition/defaults/fallback-first-lines";
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

    // #1092 / #1337 — incremental transcript broadcast. Adapter parses the
    // provider-specific shape into a canonical `ParsedTranscriptUpdate`;
    // pre-#1337 this was a `slug === "vapi"` branch in this file, which
    // silently dropped any provider's transcripts that weren't VAPI.
    // Now: any adapter implementing `parseTranscriptUpdate` participates.
    // setImmediate keeps the webhook response inside the provider's
    // ack budget.
    const transcriptUpdate = provider.parseTranscriptUpdate?.(body) ?? null;
    if (transcriptUpdate) {
      log("api", "voice.webhook.transcript_update", {
        level: "info",
        slug,
        externalCallId: transcriptUpdate.externalCallId,
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
// Transcript broadcast (#1092 / #1337)
// ═══════════════════════════════════════════════════════════════════
//
// Per-provider parsing lives on the adapter — `provider.parseTranscriptUpdate(body)`.
// This file owns dispatch (in handleVoiceWebhookPost above) and post-parse
// fan-out to the SSE registry below.

async function processTranscriptUpdate(
  parsed: ParsedTranscriptUpdate,
  slug: string,
): Promise<void> {
  // #1361 — Prefer hfCallId lookup (WebRTC path round-trips our placeholder
  // id via assistant.metadata.hfCallId). Fall back to externalId for PSTN
  // and any legacy rows. Same single indexed findFirst — no perf cost.
  let callRow: { id: string; callerId: string | null; externalId: string | null } | null = null;
  if (parsed.hfCallId) {
    callRow = await prisma.call.findFirst({
      where: { id: parsed.hfCallId, source: slug },
      select: { id: true, callerId: true, externalId: true },
    });
  }
  if (!callRow) {
    callRow = await prisma.call.findFirst({
      where: { externalId: parsed.externalCallId, source: slug },
      select: { id: true, callerId: true, externalId: true },
    });
  }
  if (!callRow) return;

  // Self-heal: when matched via hfCallId AND the externalId is empty
  // (WebRTC placeholder pre-first-webhook), stamp VAPI's externalId
  // onto the row so subsequent code paths (cost-cap trickle, end-of-call
  // merge, /x/logs lookups) can still use externalId as before.
  if (!callRow.externalId && parsed.externalCallId) {
    prisma.call
      .update({
        where: { id: callRow.id },
        data: { externalId: parsed.externalCallId },
      })
      .catch((err) => {
        console.warn(
          `[voice/transcript-update] externalId backfill failed for callId=${callRow!.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
  }

  // #1373 — Cascade-aware live-bubble gate. Resolve once per call (cached
  // in-process for ~30s) so we don't pay the cascade-lookup cost on every
  // ~1Hz conversation-update event. When the cascaded value is false,
  // skip the broadcast entirely — Call.transcript still persists at
  // end-of-call so bubbles appear after the call from the saved transcript.
  const streamEnabled = await resolveTranscriptStreamEnabled({
    callId: callRow.id,
    callerId: callRow.callerId,
  });
  if (!streamEnabled) {
    logVoiceEvent({
      slug,
      operation: `voice:${slug}:webhook:transcript-update-gated`,
      durationMs: 0,
      callId: callRow.id,
      callerId: callRow.callerId,
      metadata: { reason: "transcriptStreamEnabled=false" },
    });
    return;
  }

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
    metadata: {
      role: parsed.role,
      chars: parsed.text.length,
      matchedBy: parsed.hfCallId && callRow.id === parsed.hfCallId ? "hfCallId" : "externalId",
    },
  });
}

// #1373 — Per-call in-process cache for the resolved transcriptStreamEnabled
// bool. TTL aligned with provider-factory's 5-min cache (entries get reaped
// on call-ended via SSE registry cleanup paths in a follow-up; for now,
// reasonable bounds on a single call's lifetime). Map size is the count of
// active calls; trivial memory.
const transcriptGateCache = new Map<string, { value: boolean; expiresAt: number }>();
const TRANSCRIPT_GATE_TTL_MS = 5 * 60 * 1000;

async function resolveTranscriptStreamEnabled(args: {
  callId: string;
  callerId: string | null;
}): Promise<boolean> {
  const now = Date.now();
  const cached = transcriptGateCache.get(args.callId);
  if (cached && cached.expiresAt > now) return cached.value;

  // Default = true (preserves pre-#1373 behaviour). Only flip when the
  // cascade resolves to an explicit false.
  let value = true;
  try {
    if (args.callerId) {
      const resolved = await loadResolvedVoiceConfig({ callerId: args.callerId });
      const flat = resolved.fields["transcriptStreamEnabled"];
      if (flat?.value === false) value = false;
    }
  } catch (err) {
    console.warn(
      `[voice/transcript-gate] cascade resolve failed for callId=${args.callId} — defaulting to enabled:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  transcriptGateCache.set(args.callId, { value, expiresAt: now + TRANSCRIPT_GATE_TTL_MS });
  return value;
}

/** Test/observability — clears the in-process gate cache. */
export function _resetTranscriptGateCache(): void {
  transcriptGateCache.clear();
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
    // OR (#922) the first real end-of-call landing on a placeholder
    //    pre-created by /api/voice/calls/start or /outbound-dial.
    //
    // For sourceTag="fallback" we use an atomic update with
    // `where: { id, endedAt: null }` so a webhook that lands during
    // the poll cycle wins (the poll's update becomes a no-op via
    // P2025). For sourceTag="webhook" we keep the pre-#1178 behaviour.
    const updateWhere =
      sourceTag === "fallback"
        ? { id: existing.id, endedAt: null }
        : { id: existing.id };
    // #922 — placeholder pre-creation means `existing.endedAt === null`
    // is the canonical "this is the first real end-of-call merge"
    // signal, regardless of sourceTag. Stamping endedAt here is also
    // what the downstream pipeline trigger condition checks.
    const isFirstEndOfCall = !existing.endedAt && eventKind !== "basic";

    // #1344 Slice 4 — legacy `MAX(callSequence)+1` writer DELETED.
    // Sequencing now lives on the Session parent row, assigned atomically
    // by `createSession` via `CallerSequenceCounter`. The Call.callSequence
    // column is gone; downstream readers walk `Call.sessionId →
    // Session.learnerFacingNumber` instead.
    const updateData: Prisma.CallUpdateInput = {
      // Only overwrite transcript if the new event actually carried one
      ...(transcript ? { transcript } : {}),
      ...persistableCapture,
      // Poll path always stamps endedAt — the row is stale by
      // definition. Webhook path also stamps it on the first real
      // end-of-call merge so the row exits the "in-progress" state.
      ...((sourceTag === "fallback" || isFirstEndOfCall)
        ? {
            endedAt: new Date(),
            // #1241 — stamp endSource on the merge-to-ended transition
            // so the row carries it through downstream readers. Mirror
            // the create path's source-tag → endSource mapping.
            endSource: sourceTag === "fallback" ? "poll" : "webhook",
          }
        : {}),
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

    // Pipeline trigger fires on:
    //   1. "analysis" — split-event analysis arriving after a "basic"
    //      first arrival (handled the create+autopipeline below).
    //   2. Poll fallback — by definition the row never got its webhook,
    //      so we owe it the pipeline run.
    //   3. (#922) The FIRST end-of-call merge onto a placeholder Call
    //      (created by /start or /outbound-dial). Pre-#922 this branch
    //      assumed every "full" merge was a duplicate-fire on a row that
    //      already triggered pipeline at its create path — but the
    //      placeholder pre-creation flow means the placeholder NEVER
    //      went through the create-and-autopipeline branch, so the
    //      first real end-of-call merge is the only chance the pipeline
    //      gets to run. Without this branch every PSTN/WebRTC call
    //      finished with callSequence=null, transcript+cost recorded but
    //      no scores/behaviour/adapt rows — which is why the AI greeted
    //      every "subsequent" caller as a first-time learner.
    const shouldTriggerPipeline =
      eventKind === "analysis" ||
      sourceTag === "fallback" ||
      (eventKind === "full" && isFirstEndOfCall);
    if (shouldTriggerPipeline && updated.callerId) {
      triggerPipeline(updated.id, updated.callerId).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] Pipeline trigger failed for call ${updated.id}:`,
          err,
        );
      });
    }
    // #1342 — when the Session Model V2 flag is on AND this row was
    // pre-created with a Session parent (createCallEnteringPipelineV2),
    // finalise the Session via `endSession`. Best-effort; failures log
    // but don't break the merge response. `endSession` is idempotent on
    // already-ended rows (forward-only status transition).
    if (isSessionModelV2Enabled() && existing.sessionId) {
      const outcome =
        sourceTag === "fallback" ? "FAILED" :
        capture.durationSeconds !== undefined && capture.durationSeconds < 30 ? "ABORTED" :
        "COMPLETED";
      endSession(existing.sessionId, {
        outcome,
        ...(transcript ? { transcript } : {}),
        endSource: sourceTag === "fallback" ? "poll" : "webhook",
        ...(capture.durationSeconds !== undefined
          ? { durationSecondsOverride: capture.durationSeconds }
          : {}),
        // Pipeline trigger is handled by the legacy `triggerPipeline`
        // above; don't double-fire from endSession.
        triggerPipelineAsync: false,
      }).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] endSession failed for session ${existing.sessionId}:`,
          err instanceof Error ? err.message : String(err),
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

  // #1345 — Ghost-row dedup. Before creating a fresh Call row, check for
  // a recent unended placeholder for the same caller+provider that has
  // no externalId stamped yet. Three races land us here:
  //
  //   (a) /outbound-dial pre-created the placeholder but the externalId
  //       stamp at lines 281-284 ran AFTER the first webhook arrived —
  //       so our `findFirst({externalId, source})` above missed it.
  //   (b) VAPI dialled, the first end-of-call webhook landed under a
  //       new call id we've never seen, and there's a pending placeholder
  //       waiting for any externalId at all.
  //   (c) /outbound-dial's externalId stamp threw an exception (the
  //       fix in #1345 Part B catches + deletes that placeholder
  //       explicitly, but for any historic / non-stamp exception, the
  //       placeholder is still pending here).
  //
  // Without this guard the fresh-row branch creates a duplicate Call
  // and orphans the placeholder permanently — Bertie's 10:06:02 ghost
  // (hf_sandbox 2026-06-08).
  //
  // Window invariant: GHOST_ROW_DEDUP_WINDOW_SECONDS MUST stay below
  // poll-stale-calls.ts::DEFAULT_STALE_AFTER_MS (90s, see
  // `lib/voice/poll-stale-calls.ts:84`). If they invert, the reconciler
  // could mark the placeholder as `vapi_poll_failed` (endedAt stamped)
  // while we still consider it eligible for adoption — and the merge
  // branch above would never run because our findFirst-by-externalId
  // wouldn't match. 30s is well inside the budget.
  // Read env via globalThis to dodge the codebase-wide missing
  // @types/node typing (other call-sites in lib/config.ts use the
  // same pattern under a typed wrapper; route-handlers.ts has no
  // pre-existing env read so we resolve inline).
  const envWindow =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.GHOST_ROW_DEDUP_WINDOW_SECONDS ?? "30";
  const dedupWindowSeconds = Number.parseInt(envWindow, 10);
  let adoptedPlaceholderId: string | null = null;
  let adoptedPlaceholderSessionId: string | null = null;
  if (callerId && Number.isFinite(dedupWindowSeconds) && dedupWindowSeconds > 0) {
    const cutoff = new Date(Date.now() - dedupWindowSeconds * 1000);
    const placeholder = await prisma.call.findFirst({
      where: {
        callerId,
        voiceProvider: slug,
        endedAt: null,
        externalId: null,
        createdAt: { gt: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, sessionId: true },
    });
    if (placeholder) {
      adoptedPlaceholderId = placeholder.id;
      adoptedPlaceholderSessionId = placeholder.sessionId ?? null;
    }
  }

  // #1344 Slice 4 — legacy `MAX(callSequence)+1` writer DELETED. Session
  // parent row's `learnerFacingNumber` is the canonical learner-facing
  // counter (assigned atomically by `createSession` via
  // `CallerSequenceCounter`). The Call.callSequence column is gone.
  const endedAt = new Date();

  // #1345 — Adopt the pending placeholder by UPDATE rather than CREATE.
  // Merges the webhook payload onto the existing row, stamps externalId,
  // and stamps the sequence + endSource that the create branch would
  // have set. Falls back cleanly to the original create path when no
  // placeholder is in the dedup window.
  if (adoptedPlaceholderId) {
    const adopted = await prisma.call.update({
      where: { id: adoptedPlaceholderId },
      data: {
        externalId: externalCallId,
        // Re-affirm source/voiceProvider in case the placeholder was
        // created with a different slug (defensive — the WHERE clause
        // already filters by voiceProvider).
        source: slug,
        voiceProvider: slug,
        transcript: transcript || "(no transcript)",
        usedPromptId,
        endedAt,
        endSource: sourceTag === "fallback" ? "poll" : "webhook",
        ...(playbookId ? { playbookId } : {}),
        ...persistableCapture,
      },
    });

    console.log(
      `[voice/${slug}/webhook] Adopted placeholder ${adopted.id} for ${slug} ${externalCallId} (eventKind=${eventKind}, dedupWindowSeconds=${dedupWindowSeconds})` +
        (callerId ? ` for caller ${callerId}` : ""),
    );

    broadcastToCall({
      type: "call-ended",
      callId: adopted.id,
      reason: capture.endedReason ?? null,
      totalDurationMs:
        typeof capture.durationSeconds === "number"
          ? Math.round(capture.durationSeconds * 1000)
          : null,
      timestampMs: Date.now(),
    }).catch((err) =>
      console.warn(`[voice/${slug}/webhook] call-ended broadcast failed:`, err),
    );

    // Pipeline gating identical to the fresh-create branch below — see
    // the comment block there for the #1270/#1241 cascade rationale.
    if (eventKind !== "basic" && callerId) {
      const resolved = await loadResolvedVoiceConfig({ callerId, playbookId });
      const autoPipeline = resolved.fields.autoPipeline?.value === true;
      if (autoPipeline) {
        triggerPipeline(adopted.id, callerId).catch((err) => {
          console.error(
            `[voice/${slug}/${sourceTag}] Pipeline trigger failed for adopted placeholder ${adopted.id}:`,
            err,
          );
        });
      }
    }

    // #1342 — finalise the linked Session row when V2 is on. The
    // placeholder was created by `createCallEnteringPipelineV2` with a
    // Session parent; endSession commits the outcome + skipStages.
    if (isSessionModelV2Enabled() && adoptedPlaceholderSessionId) {
      const outcome =
        sourceTag === "fallback" ? "FAILED" :
        capture.durationSeconds !== undefined && capture.durationSeconds < 30 ? "ABORTED" :
        "COMPLETED";
      endSession(adoptedPlaceholderSessionId, {
        outcome,
        ...(transcript ? { transcript } : {}),
        endSource: sourceTag === "fallback" ? "poll" : "webhook",
        ...(capture.durationSeconds !== undefined
          ? { durationSecondsOverride: capture.durationSeconds }
          : {}),
        triggerPipelineAsync: false,
      }).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] endSession failed for adopted-placeholder session ${adoptedPlaceholderSessionId}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    return { ok: true, callId: adopted.id, callerId, merged: true };
  }

  // #1342 — fresh-arrival Session row. Under V2 the Session is created
  // BEFORE the Call so the Call carries `sessionId` at insert time. The
  // Session row is created with provisional `STARTED` status and
  // immediately closed by `endSession` below — this branch handles
  // end-of-call events for calls that never went through the
  // `createCallEnteringPipeline` placeholder flow (e.g. an inbound call
  // we never pre-allocated). The dual-write may look redundant but it
  // preserves the I-CT2 cascade + voiceConfigSnapshot for these rows.
  let freshSessionId: string | null = null;
  if (isSessionModelV2Enabled() && callerId) {
    try {
      const result = await createSession({
        callerId,
        kind: "VOICE_CALL",
        source: slug,
        voiceProvider: slug,
      });
      freshSessionId = result.session.id;
    } catch (err) {
      console.error(
        `[voice/${slug}/${sourceTag}] fresh createSession failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const newCall = await prisma.call.create({
    data: {
      externalId: externalCallId,
      source: slug,
      voiceProvider: slug,
      transcript: transcript || "(no transcript)",
      callerId,
      usedPromptId,
      endedAt,
      // #1241 — server-side end-of-call writer. `sourceTag` already
      // distinguishes the webhook path from the poll-fallback path, so
      // mirror it: 'webhook' for normal end-of-call, 'poll' when the
      // 90s stale-calls cron reconciled. See lib/voice/end-source.ts.
      endSource: sourceTag === "fallback" ? "poll" : "webhook",
      ...(freshSessionId ? { sessionId: freshSessionId } : {}),
      ...(playbookId ? { playbookId } : {}),
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
  //
  // #1270 supersedes #1241 — autoPipeline now resolves through the
  // 4-layer cascade: System → enabled VoiceProvider → Domain → Course.
  // Course-level override (Playbook.config.voice.autoPipeline) wins;
  // falls through to domain / VP / system. See lib/voice/config.ts.
  // Pre-#1270 the gate hand-rolled a 2-layer system+playbook check;
  // resolveVoiceConfig generalises that without losing behaviour.
  if (eventKind !== "basic" && callerId) {
    const resolved = await loadResolvedVoiceConfig({ callerId, playbookId });
    const autoPipeline = resolved.fields.autoPipeline?.value === true;
    if (autoPipeline) {
      triggerPipeline(newCall.id, callerId).catch((err) => {
        console.error(
          `[voice/${slug}/${sourceTag}] Pipeline trigger failed for call ${newCall.id}:`,
          err,
        );
      });
    }
  }

  // #1342 — finalise the fresh Session row when V2 is on. The Session
  // was created at `STARTED`; commit the end-of-call outcome so the
  // counter flags / skipStages settle.
  if (isSessionModelV2Enabled() && freshSessionId) {
    const outcome =
      sourceTag === "fallback" ? "FAILED" :
      capture.durationSeconds !== undefined && capture.durationSeconds < 30 ? "ABORTED" :
      "COMPLETED";
    endSession(freshSessionId, {
      outcome,
      ...(transcript ? { transcript } : {}),
      endSource: sourceTag === "fallback" ? "poll" : "webhook",
      ...(capture.durationSeconds !== undefined
        ? { durationSecondsOverride: capture.durationSeconds }
        : {}),
      triggerPipelineAsync: false,
    }).catch((err) => {
      console.error(
        `[voice/${slug}/${sourceTag}] endSession failed for fresh session ${freshSessionId}:`,
        err instanceof Error ? err.message : String(err),
      );
    });
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
 * `toolCallsOverWebSocket: true` (Retell — tools arrive on WSS) OR
 * `orchestrationMode: "self-hosted-agent"` (LiveKit/Pipecat — the agent
 * loop runs inside HF's process, so there's no remote orchestrator to
 * call this endpoint at all). #1337.
 */
export async function handleVoiceToolsPost(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  try {
    const provider = await getVoiceProvider(slug);
    const caps = provider.getCapabilities();

    if (caps.orchestrationMode === "self-hosted-agent") {
      return NextResponse.json(
        {
          error: `Provider "${slug}" uses self-hosted-agent orchestration — tools are direct in-process calls, not remote callbacks.`,
        },
        { status: 404 },
      );
    }

    if (caps.toolCallsOverWebSocket) {
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

    // #1337 — self-hosted-agent providers (LiveKit/Pipecat) build the
    // assistant inline in HF's process; they never POST an
    // assistant-request to this route. Fail loud with 404 instead of
    // silently running the prompt-composition pipeline for a payload
    // that can't have legitimate origin.
    if (inbound.getCapabilities().orchestrationMode === "self-hosted-agent") {
      endSpan({ metadata: { selfHostedAgent: true } });
      return NextResponse.json(
        { error: `Provider "${slug}" uses self-hosted-agent orchestration — assistant configs are built in-process, not via this callback.` },
        { status: 404 },
      );
    }

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

    // #1187 follow-up (#922) — pull webhookSecret here too so the inline
    // assistant config returned by VAPI's assistant-request webhook
    // carries `model.secret`. Without this VAPI omits the
    // `x-vapi-secret` header on its custom-llm POSTs and the proxy
    // rejects with 401, ending the call after the first line. Parallel
    // path to `buildAssistantConfigForCaller` which already does this.
    const customLlmProviderRow = await prisma.voiceProvider.findUnique({
      where: { slug },
      select: { credentials: true },
    });
    const customLlmProviderCreds =
      (customLlmProviderRow?.credentials ?? {}) as Record<string, unknown>;
    const customLlmSecret =
      typeof customLlmProviderCreds.webhookSecret === "string" &&
      customLlmProviderCreds.webhookSecret.length > 0
        ? customLlmProviderCreds.webhookSecret
        : undefined;

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
          firstLine: UNKNOWN_CALLER_FIRST_LINE,
          toolDefinitions: [],
          knowledgePlanEnabled: false,
          serverUrlBase,
          modelConfig: { provider: vs.provider, model: vs.model },
          unknownCallerPrompt: vs.unknownCallerPrompt,
          noActivePromptFallback: vs.noActivePromptFallback,
          costSafetyKnobs,
          customLlmSecret,
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
          firstLine: noActivePromptFirstLine(caller.name),
          toolDefinitions: [],
          knowledgePlanEnabled: false,
          serverUrlBase,
          modelConfig: { provider: vs.provider, model: vs.model },
          unknownCallerPrompt: vs.unknownCallerPrompt,
          noActivePromptFallback: vs.noActivePromptFallback,
          costSafetyKnobs,
          customLlmSecret,
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
        customLlmSecret,
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
 * `hasKnowledgeCallback: false` (Retell — pre-uploaded knowledge IDs) OR
 * `orchestrationMode: "self-hosted-agent"` (LiveKit/Pipecat — KB lookups
 * happen inline in HF's process, never as a remote callback). #1337.
 * Without these guards the route would crash on `buildKnowledgeResponse`
 * (which Retell throws on by design).
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
    const caps = provider.getCapabilities();

    if (caps.orchestrationMode === "self-hosted-agent") {
      endSpan({ metadata: { selfHostedAgent: true } });
      return NextResponse.json(
        { error: `Provider "${slug}" uses self-hosted-agent orchestration — knowledge lookups are in-process, not remote callbacks.` },
        { status: 404 },
      );
    }

    if (!caps.hasKnowledgeCallback) {
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
