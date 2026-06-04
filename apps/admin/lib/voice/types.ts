/**
 * VoiceProvider adapter interface (AnyVoice #1017).
 *
 * Per CHAIN-CONTRACTS.md "Link 3 sub-contract — COMPOSE → VOICE PROVIDER
 * (transport adapter)", the seam between the provider-agnostic composed
 * prompt and the vendor-specific HTTP surface lives entirely behind this
 * interface. Routes under `app/api/vapi/*` (and any future
 * `app/api/<provider>/*`) delegate transport parsing and serialisation
 * to the active adapter. The pipeline, composition, and prompt layers
 * never know which provider is on the wire.
 *
 * Today's only implementation is `VapiProvider` (`lib/voice/providers/vapi`).
 * Adding a second provider = one new file under `lib/voice/providers/<slug>/`
 * + one new enum value on `VoiceProviderSlug` (#1025) + one new
 * `getVoiceProvider` case.
 *
 * Invariants (see CHAIN-CONTRACTS.md I-VP1..I-VP5):
 *   I-VP1 — Composed prompt is provider-agnostic.
 *   I-VP2 — Tool definitions are spec-driven (today violated; #1019).
 *   I-VP3 — End-of-call normalisation populates canonical Call.voice*
 *           fields (today violated; #1020).
 *   I-VP4 — Webhook auth scheme isolated per-provider in
 *           lib/voice/providers/<slug>/auth.ts (this file's auth seam).
 *   I-VP5 — Tool-call callback adapter normalises payloads to a canonical
 *           ToolExecutionContext (this file's normaliseToolCallList +
 *           buildOutboundReachInPayload seams).
 */

import type { NextRequest, NextResponse } from "next/server";

/** Caller + composed-prompt context the route resolves before delegating. */
export interface AssistantRequestContext {
  /** Caller row primary key, or null when the inbound call's customer
   *  phone doesn't resolve to an existing Caller. */
  callerId: string | null;
  /** Display name for fallback messages when the caller is unknown. */
  callerName?: string | null;
  /** Caller's phone number after normalisation (whitespace stripped). */
  customerPhone: string | null;
  /** Rendered voice-format system prompt (provider-agnostic markdown). */
  voicePrompt: string;
  /** First line for the assistant to speak, when available. */
  firstLine: string | null;
  /** Tool definitions enabled for this caller's settings. Shape is the
   *  OpenAI function-call format; the adapter converts to its provider's
   *  wire format. Will be sourced from TOOLS-001 spec post-#1019. */
  toolDefinitions: ProviderToolDefinition[];
  /** Per-turn knowledge plan enabled (RAG callback) — adapter decides
   *  how to express this in its wire format. */
  knowledgePlanEnabled: boolean;
  /** Per-turn knowledge callback URL base for the adapter to compose
   *  against (e.g. `${appUrl}/api/vapi`). */
  serverUrlBase: string;
  /** Model + provider config from system-settings. */
  modelConfig: { provider: string; model: string };
  /** Fallback prompt for unknown callers — adapter inlines as system msg. */
  unknownCallerPrompt: string;
  /** Fallback prompt when caller is known but no active ComposedPrompt
   *  exists (e.g. wizard-stage caller without a composed prompt yet). */
  noActivePromptFallback: string;
}

/** Provider tool shape — OpenAI function-call format (the lingua franca). */
export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** Provider-shaped assistant config returned to the inbound webhook.
 *  Each adapter knows what its provider expects; the route just JSONs it. */
export type ProviderAssistantConfig = Record<string, unknown>;

/** End-of-call event normalised across providers. The adapter extracts
 *  these fields from its provider's payload; downstream code writes them
 *  to canonical Call.voice* columns (#1020). */
export interface NormalisedEndOfCallEvent {
  /** Provider's own call id (becomes Call.externalId). */
  externalCallId: string;
  /** Caller phone from the customer block, or null. */
  customerPhone: string | null;
  /** Caller name if the provider passes one. */
  customerName: string | null;
  /** Transcript text or empty string. */
  transcript: string;
  /** Canonical capture fields. Keys mirror Call schema post-#1020. */
  capture: NormalisedEndOfCallCapture;
  /** Verbatim inbound body — stored to Call.voiceProviderRaw (#1021).
   *  Opaque to HF; only the provider that wrote it knows the shape.
   *  Use voiceProviderRaw for forensic debugging and one-off analytics;
   *  promote a field to a canonical capture key if shared code needs
   *  to read it. */
  providerRaw: unknown;
}

export interface NormalisedEndOfCallCapture {
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  /** Post-#1020 these write to Call.voice* columns. Names kept canonical
   *  in this type so the adapter doesn't leak vendor-specific naming. */
  durationSeconds?: number;
  endedReason?: string;
  costUsd?: number;
  analysisSummary?: string;
  /** Provider-extracted structured analysis — written to
   *  Call.voiceStructuredData (#1020). Distinct from voiceProviderRaw
   *  on the event: structuredData is the analysis-plan output (every
   *  voice provider has an analogue); providerRaw is the whole inbound
   *  message body for forensic use. */
  structuredData?: unknown;
  successEvaluation?: string;
}

/** Single tool call normalised from a provider's batched callback. */
export interface NormalisedToolCall {
  /** Provider's tool-call id to echo back in the response. */
  toolCallId: string;
  /** Tool function name (matches a `handle*` switch case). */
  funcName: string;
  /** Parsed arguments object (already JSON.parsed if provider sent a string). */
  args: Record<string, unknown>;
}

/** Full tool-call batch normalised from one inbound request. */
export interface NormalisedToolCallBatch {
  toolCalls: NormalisedToolCall[];
  /** Caller phone from the inbound payload's customer block. */
  customerPhone: string | null;
}

/** Single knowledge-base result the route produced from RAG retrieval. */
export interface KnowledgeResult {
  content: string;
  /** 0..1 similarity score (cosine distance complement). */
  similarity: number;
}

/**
 * The adapter contract. Each method is one transport seam.
 *
 * IMPORTANT: implementations MUST be stateless. The same instance is
 * reused across requests by the factory; per-request state lives on
 * the caller's `AssistantRequestContext` or `NormalisedToolCallBatch`.
 */
export interface VoiceProvider {
  /** Stable identifier matching VoiceProviderSlug + getVoiceCallSettings().provider. */
  readonly slug: string;

  /**
   * Verify inbound request signature. Returns null when valid (route
   * continues), or a 401 NextResponse when invalid (route returns it).
   * `rawBody` must be the unparsed request body — HMAC schemes hash it.
   */
  verifyInboundRequest(req: NextRequest, rawBody: string): NextResponse | null;

  /**
   * Build the provider-shaped assistant config returned at call-start.
   * The route assembles the context (caller resolution, prompt rendering,
   * settings lookup) and delegates wire-format construction here.
   */
  buildAssistantConfig(ctx: AssistantRequestContext): ProviderAssistantConfig;

  /**
   * Extract canonical end-of-call event from the provider's webhook
   * payload. Returns null when the body shape doesn't match this event
   * (e.g. provider's heartbeat ping reaches the webhook route).
   */
  normaliseEndOfCallEvent(body: unknown): NormalisedEndOfCallEvent | null;

  /**
   * Extract canonical tool-call batch from the provider's tools-route
   * payload. Returns an empty batch when no tool calls are present.
   */
  normaliseToolCallList(body: unknown): NormalisedToolCallBatch;

  /**
   * Wrap RAG results in the provider's expected response shape.
   * VAPI's Custom Knowledge Base expects `{ results: [{ content, similarity }] }`;
   * other providers may need a different envelope.
   */
  buildKnowledgeResponse(results: KnowledgeResult[]): unknown;
}
