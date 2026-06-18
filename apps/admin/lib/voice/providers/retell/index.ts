/**
 * RetellProvider — VoiceProvider adapter skeleton for retellai.com
 * (introduced AnyVoice #1079).
 *
 * SKELETON ONLY. This adapter proves the contract holds for a
 * second provider with a different transport shape:
 *   - End-of-call is split into `call_ended` + `call_analyzed`
 *   - Tool calls arrive over a WebSocket (`wss://…/llm-websocket`)
 *   - Knowledge is pre-uploaded by ID, not a per-turn HTTP callback
 *   - The provider sends `x-retell-signature` (not `x-vapi-signature`)
 *
 * Full transport implementation (auth, buildAssistantConfig,
 * WSS handler) is a follow-up story — this file's job is for the
 * route layer + capability declaration to compile and dispatch
 * correctly with `RetellProvider` as a registered adapter.
 *
 * Retell HTTP contract reference:
 *   https://docs.retellai.com/api-references/create-web-call
 *   https://docs.retellai.com/api-references/create-agent
 *   https://docs.retellai.com/api-references/create-retell-llm
 *   https://docs.retellai.com/features/webhook
 *   https://docs.retellai.com/api-references/llm-websocket
 */

import type { NextRequest, NextResponse } from "next/server";
import type {
  AssistantRequestContext,
  KnowledgeBaseRequest,
  KnowledgeResult,
  NormalisedEndOfCallCapture,
  NormalisedEndOfCallEvent,
  NormalisedToolCall,
  NormalisedToolCallBatch,
  ParsedTranscriptUpdate,
  ProviderAssistantConfig,
  ProviderConfigSchema,
  VoiceProvider,
  VoiceProviderCapabilities,
} from "../../types";
import { verifyRetellRequest } from "./auth";

interface RetellCredentials {
  apiKey?: string;
  webhookSecret?: string;
}

export class RetellProvider implements VoiceProvider {
  readonly slug = "retell";

  // Stashed for the follow-up story that wires real verification and
  // outbound REST calls (start-call, end-call). Stored on construction
  // so the same adapter instance can be reused per request.
  private readonly _apiKey: string | undefined;
  private readonly _webhookSecret: string | undefined;

  constructor(
    credentials: Record<string, unknown>,
    _config: Record<string, unknown>,
  ) {
    void _config;
    const creds = credentials as RetellCredentials;
    this._apiKey = creds.apiKey;
    this._webhookSecret = creds.webhookSecret;
  }

  /**
   * Verify the inbound Retell webhook via the `x-retell-signature` HMAC.
   * Prefers a dedicated `webhookSecret`, falling back to the API key
   * (Retell's default signing key). Pass-through when neither is set, to
   * preserve local-dev ergonomics — same posture as the VAPI verifier.
   */
  verifyInboundRequest(
    req: NextRequest,
    rawBody: string,
  ): NextResponse | null {
    return verifyRetellRequest(req, rawBody, this._webhookSecret ?? this._apiKey);
  }

  /**
   * Stub: returns an empty assistant config. The real implementation
   * shapes a Retell `agent_override` body or a Create Web Call
   * response, depending on whether HF acts as the assistant-request
   * webhook (agent-override mode) or as the Retell-LLM endpoint
   * (WSS mode).
   */
  buildAssistantConfig(_ctx: AssistantRequestContext): ProviderAssistantConfig {
    void _ctx;
    return {};
  }

  /**
   * Distinguishes Retell's two end-of-call events by `event` field.
   * `call_ended` carries the basic capture; `call_analyzed` carries
   * the analysis fields. Returns null when the event isn't one of the
   * two (e.g. `call_started`, `transcript_updated`).
   *
   * The webhook route merges by `externalCallId` — the basic event
   * writes/updates the Call row with eventKind="basic" and skips the
   * pipeline trigger; the analysis event writes the analysis fields
   * and runs the pipeline.
   */
  normaliseEndOfCallEvent(body: unknown): NormalisedEndOfCallEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const event = root.event as string | undefined;
    if (event !== "call_ended" && event !== "call_analyzed") return null;

    const call = (root.call ?? root) as Record<string, unknown>;
    const externalCallId = call.call_id as string | undefined;
    if (!externalCallId) return null;

    const startMs = call.start_timestamp as number | undefined;
    const endMs = call.end_timestamp as number | undefined;
    const durationSeconds =
      typeof startMs === "number" && typeof endMs === "number"
        ? Math.max(0, (endMs - startMs) / 1000)
        : undefined;

    const customerPhone = (call.from_number as string | undefined) ?? null;
    const customerName = null; // Retell doesn't pass a display name

    const transcript = (call.transcript as string | undefined) ?? "";

    const capture: NormalisedEndOfCallCapture = {};
    if (typeof call.recording_url === "string") {
      capture.recordingUrl = call.recording_url;
    }
    if (durationSeconds !== undefined) {
      capture.durationSeconds = durationSeconds;
    }
    if (typeof call.disconnect_reason === "string") {
      capture.endedReason = call.disconnect_reason;
    }

    if (event === "call_analyzed") {
      const analysis = call.call_analysis as Record<string, unknown> | undefined;
      if (analysis) {
        if (typeof analysis.call_summary === "string") {
          capture.analysisSummary = analysis.call_summary;
        }
        if (
          analysis.custom_analysis_data &&
          typeof analysis.custom_analysis_data === "object"
        ) {
          capture.structuredData = analysis.custom_analysis_data;
        }
        const success = analysis.call_successful;
        if (typeof success === "string") {
          capture.successEvaluation = success;
        } else if (typeof success === "boolean") {
          capture.successEvaluation = String(success);
        }
      }
    }

    return {
      eventKind: event === "call_ended" ? "basic" : "analysis",
      externalCallId,
      customerPhone,
      customerName,
      transcript,
      capture,
      providerRaw: root,
    };
  }

  /**
   * Retell tools arrive over WebSocket (custom-LLM mode). The HTTP
   * tools route returns 404 for retell — but we still implement the
   * method so the contract holds. An empty batch is the right answer
   * for "this HTTP route should not have been called for me".
   */
  normaliseToolCallList(_body: unknown): NormalisedToolCallBatch {
    void _body;
    return { toolCalls: [], customerPhone: null, externalCallId: null };
  }

  /**
   * Stub for the WSS tool-call seam. Real implementation extracts
   * function-call frames from Retell's LLM-websocket protocol
   * (specifically the LLM-response messages that carry tool_calls).
   */
  normaliseToolCallFromWebSocketMessage(
    _msg: unknown,
  ): NormalisedToolCall | null {
    void _msg;
    return null;
  }

  /** Retell has no HTTP knowledge callback — knowledge is configured
   *  by uploading documents and referencing knowledge_base_ids on the
   *  agent. Returning null is the contract for "not applicable"; the
   *  knowledge route's capability guard returns 404 before this is
   *  invoked in practice. */
  parseKnowledgeBaseRequest(_body: unknown): KnowledgeBaseRequest | null {
    void _body;
    return null;
  }

  /** Never called (capability says no knowledge callback). Throwing
   *  here is a fail-loud assertion that the capability guard worked. */
  buildKnowledgeResponse(_results: KnowledgeResult[]): unknown {
    void _results;
    throw new Error(
      "Retell has no HTTP knowledge callback — knowledge_base_ids on the agent are the path.",
    );
  }

  getConfigSchema(): ProviderConfigSchema {
    return {
      fields: [
        {
          key: "apiKey",
          label: "Retell API key",
          type: "string",
          help: "Bearer token used for outbound REST calls (create-call, end-call) and to verify x-retell-signature on inbound webhooks.",
          sensitive: true,
          required: false,
        },
        {
          key: "webhookSecret",
          label: "Webhook secret (HMAC)",
          type: "string",
          help: "Optional alternate secret if separate from the API key. Leave blank to verify with the API key.",
          sensitive: true,
          required: false,
        },
        {
          key: "agentId",
          label: "Default agent ID",
          type: "string",
          help: "Retell agent_id used at call-start. Required to start calls; can be overridden per call by the caller's routing.",
          required: false,
        },
        {
          key: "voiceId",
          label: "Voice ID",
          type: "string",
          help: "Default voice_id passed in agent_override. Override on a per-caller basis if needed.",
          required: false,
        },
      ],
    };
  }

  getCapabilities(): VoiceProviderCapabilities {
    return {
      endOfCallEvents: "split",
      hasKnowledgeCallback: false,
      toolCallsOverWebSocket: true,
      supportsRequestEndCall: true,
      // #1742 — Retell's proactive-speech path is the LLM-WSS
      // `agent_interrupt` frame, which requires an HF-side WSS handler
      // queue. That handler is out of scope for the #1742 primitive;
      // until the LLM-WSS-side enqueue lands, the cue scheduler treats
      // Retell calls as no-capability and emits
      // `voice.cue_scheduler.skipped_no_capability` instead of attempting
      // a dispatch.
      supportsProactiveSpeech: false,
      // #1337 — Retell runs its agent loop in their cloud (custom-LLM
      // mode still delegates to a Retell-managed orchestrator via WSS),
      // so it's "vendor-cloud" — same dispatch class as VAPI.
      orchestrationMode: "vendor-cloud",
      // #1908 — Retell's custom-LLM path is WSS-based, not the
      // OpenAI-compatible HTTP `chat/completions` shape HF's LLM proxy
      // expects. TODO(#1079 follow-on): wire Retell's WSS handler into
      // the proxy + flip this true.
      supportsCustomLLMProxy: false,
      // #1908 — Retell does not expose a documented HTTP `add-message`
      // op equivalent to VAPI's controlUrl. Server-injected system
      // messages would need a separate primitive.
      supportsInBandSystemMessage: false,
      // #1908 — Retell does not document a mid-call assistant-handoff
      // primitive equivalent to VAPI's `handoff` op.
      supportsHandoff: false,
    };
  }

  /**
   * Stub: Retell emits `transcript_updated` events (#1337). Real parser
   * lands with the rest of the Retell transport story. Until then,
   * returning null preserves the pre-#1337 behaviour — the route layer
   * used to early-exit on `slug !== "vapi"`, dropping the same data on
   * the floor. Filing this stub means future-Retell-work is one method
   * implementation away, not a `route-handlers.ts` edit.
   *
   * TODO(retell-transport-followup): parse `event === "transcript_updated"`
   * messages from the Retell webhook payload — see
   * https://docs.retellai.com/features/webhook for the wire format.
   */
  parseTranscriptUpdate(_body: unknown): ParsedTranscriptUpdate | null {
    void _body;
    return null;
  }
}
