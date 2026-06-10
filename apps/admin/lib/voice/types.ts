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
 * Implementations live under `lib/voice/providers/<slug>/`. Adding a new
 * provider = one new file + one new entry in `lib/voice/adapter-registry.ts`.
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
 *
 * Canonical voice cascade keys (#1334 / #1337):
 *   New adapters MUST declare the following keys in `getConfigSchema()` so
 *   the cascade (`lib/voice/config.ts::resolveVoiceConfig`) flows through
 *   to them uniformly without per-adapter special casing:
 *     - `voiceId`          — string, voice ID within the chosen TTS engine
 *     - `voiceProvider`    — enum, TTS engine slug ("11labs" / "deepgram" / "openai" / …)
 *     - `transcriber`      — enum, STT engine slug
 *     - `backgroundSound`  — enum / off, ambient sound during TTS
 *     - `recordingEnabled` — boolean, whether to capture call audio
 *   Cross-cutting safety keys (silenceTimeoutSeconds / maxDurationSeconds /
 *   maxCostPerCallUsd / voicemailDetectionEnabled / endCallPhrases /
 *   autoPipeline / pollIntervalMs) cascade from VoiceSystemSettings regardless
 *   of adapter — adapters don't need to redeclare them. See `CROSS_CUTTING_KEYS`
 *   in `lib/voice/config.ts`.
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
  /** Per-call cost-safety knobs sourced from `VoiceSystemSettings`
   *  (PR voice-cost-knobs). The adapter weaves these into the inline
   *  assistant config so a hung call dies on silence, voicemail loops
   *  end before chewing minutes, and the AI can self-terminate by
   *  recognising a goodbye phrase. */
  costSafetyKnobs?: {
    silenceTimeoutSeconds: number;
    maxDurationSeconds: number;
    voicemailDetectionEnabled: boolean;
    endCallPhrases: string[];
  };
  /** #1271 — flat resolved voice config from the 4-layer cascade
   *  (System → enabled VP → Domain → Course). Adapters read keys they
   *  care about (e.g. `voiceId`, `transcriber`, `backgroundSound`) and
   *  ignore the rest. Set by `buildAssistantConfigForCaller`; absent on
   *  legacy code paths that haven't migrated to the resolver yet. */
  voiceConfig?: Record<string, unknown>;
  /** #1185 follow-up — shared secret passed through to the `model.secret`
   *  field on `custom-llm` inline configs. VAPI POSTs this value as
   *  `x-vapi-secret` on every chat-completions request to HF's proxy,
   *  which timing-safe-compares against the same VoiceProvider's
   *  `credentials.webhookSecret`. When undefined, the custom-llm config
   *  omits `model.secret` and VAPI sends no header — fine only when the
   *  proxy is in pass-through mode (no secret configured on the provider). */
  customLlmSecret?: string;
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
  /** Provider-specific extension fields keyed by adapter slug (#1079).
   *  Passed through to the adapter at `buildAssistantConfig`; opaque
   *  to HF core. Example: `{ vapi: { async: false }, retell: {
   *  speak_during_execution: true, execution_message_type: "prompt" } }` */
  providerExtensions?: Record<string, Record<string, unknown>>;
}

/** Provider-shaped assistant config returned to the inbound webhook.
 *  Each adapter knows what its provider expects; the route just JSONs it. */
export type ProviderAssistantConfig = Record<string, unknown>;

/**
 * End-of-call event kind (AnyVoice #1079). Most providers fire a single
 * webhook with full data (`"full"`). Retell splits into two events:
 * `call_ended` ("basic" — transcript + disconnect reason) followed by
 * `call_analyzed` ("analysis" — summary + structured data + success).
 *
 * The webhook route uses this to decide whether to fire the pipeline
 * trigger now (`"full"` / `"analysis"`) or only persist basic capture
 * and wait for the analysis event (`"basic"`).
 */
export type EndOfCallEventKind = "full" | "basic" | "analysis";

/** End-of-call event normalised across providers. The adapter extracts
 *  these fields from its provider's payload; downstream code writes them
 *  to canonical Call.voice* columns (#1020). */
export interface NormalisedEndOfCallEvent {
  /** Which slice of the end-of-call data this event carries (#1079).
   *  VAPI returns `"full"` always; Retell returns `"basic"` then
   *  `"analysis"` later. */
  eventKind: EndOfCallEventKind;
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

/**
 * Mid-call transcript update normalised across providers (#1337 / #1092).
 *
 * Adapters that emit incremental transcripts (VAPI's `transcript` +
 * `conversation-update`, Retell's `transcript_updated`, LiveKit's own
 * STT callback) parse provider-specific bodies into this shape. The SSE
 * registry then broadcasts `transcript-partial` events to chat surfaces.
 *
 * Returning null means "this body isn't a transcript event for this
 * provider" — used by `parseTranscriptUpdate` on the adapter to filter
 * out non-transcript webhook payloads.
 */
export interface ParsedTranscriptUpdate {
  externalCallId: string;
  role: "learner" | "assistant";
  text: string;
  /** Optional HF placeholder Call id, surfaced via `assistant.metadata.hfCallId`
   *  in the inline assistant config (#1361). The WebRTC [Talk Here] path
   *  creates a placeholder Call row BEFORE the provider assigns its own id,
   *  so the synchronous "capture VAPI id from POST /call response" trick the
   *  PSTN path uses is unavailable. Instead we round-trip our placeholder id
   *  through the provider's metadata field; the webhook then resolves to the
   *  correct row by this id (preferred) or by `externalCallId` (legacy /
   *  PSTN fallback).
   *
   *  Absent when (a) the adapter doesn't echo metadata, (b) the inline
   *  config didn't include it, or (c) the inbound payload is a PSTN call
   *  where the placeholder was created with externalId already populated. */
  hfCallId?: string | null;
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
  /** Provider's external call id from the inbound payload (#1092). The
   *  tools handler resolves this to a local `Call.id` via
   *  `prisma.call.findFirst({externalId, source: slug})` so that rail-
   *  routing (chat-via-SSE vs SMS) can look up the SSE-subscriber
   *  registry by `Call.id`. Null when the provider didn't send one. */
  externalCallId: string | null;
}

/** Single knowledge-base result the route produced from RAG retrieval. */
export interface KnowledgeResult {
  content: string;
  /** 0..1 similarity score (cosine distance complement). */
  similarity: number;
}

/** Canonical knowledge-base request normalised from a provider's per-turn
 *  RAG callback (#1022). Different providers shape the inbound payload
 *  differently — the adapter parses to this canonical shape so the
 *  retrieval logic in the route stays provider-agnostic. */
export interface KnowledgeBaseRequest {
  /** Conversation messages so far. Route extracts the last N user
   *  messages for query context per knowledge-retrieval settings. */
  messages: Array<{ role: string; content: string }>;
  /** Provider's call id (matches Call.externalId). Used for logging. */
  callId: string | null;
  /** Caller phone from the customer block, normalised. Used to resolve
   *  per-caller scope (course/playbook sources). */
  customerPhone: string | null;
}

/**
 * Field descriptor in a provider's config schema (AnyVoice #1044).
 *
 * Drives the admin UI form: each entry becomes one form field on
 * `/x/settings/voice-providers/[id]`. `sensitive: true` routes the
 * value into `VoiceProvider.credentials` (Json, masked on read);
 * everything else routes into `VoiceProvider.config`.
 */
export interface ProviderConfigField {
  /** Storage key on credentials / config. */
  key: string;
  /** UI label. */
  label: string;
  /** Form input type. */
  type: "string" | "number" | "boolean" | "enum";
  /** Helper text rendered under the field. */
  help?: string;
  /** Allowed values for type === "enum". */
  enumValues?: string[];
  /** Pre-fill when creating a new provider row. */
  default?: unknown;
  /** Mask + route to credentials. */
  sensitive?: boolean;
  /** Required field — PATCH validation rejects empty / null. */
  required?: boolean;
}

export interface ProviderConfigSchema {
  fields: ProviderConfigField[];
}

/**
 * One entry in a TTS-voice catalog (#1421 Slice A).
 *
 * Pre-fix, `voiceId` was a free-text input in `VoiceConfigSection` and on
 * the per-VoiceProvider edit page. An educator typing a voiceId not
 * recognised by the configured `voiceProvider` ("aster" instead of
 * "asteria", "neutral-en" for a Deepgram voice slot) silently broke the
 * runtime — VAPI saw an unknown voiceId and either fell back to a default
 * or errored at call-start.
 *
 * The fix is a vendor-validated dropdown. Each adapter implements
 * `getVoiceCatalog()` returning the set of legal voiceIds per supported
 * TTS provider. The UI replaces the free-text input with a `<select>`
 * populated from this catalog, filtered by the current `voiceProvider`.
 *
 * For ElevenLabs (account-specific voices), the catalog can return an
 * empty array for the eleven labels enum entry and the UI keeps a
 * "Custom voice ID…" hatch — flagged as future scope.
 */
export interface VoiceCatalogEntry {
  /** TTS provider this voice belongs to. Mirrors the `voiceProvider`
   *  enum on the adapter's config schema (e.g. "deepgram", "openai",
   *  "11labs", "azure", "playht"). */
  voiceProvider: string;
  /** The exact voiceId string the provider expects ("asteria", "nova"). */
  voiceId: string;
  /** Display label rendered in the dropdown. Include gender/style hints
   *  so educators can pick without trial-and-error
   *  ("Asteria — Female, conversational"). */
  label: string;
  /** Optional sub-label or one-line description. */
  description?: string;
}

/**
 * Capability declaration (AnyVoice #1044, consumed by #1079 + #1080).
 *
 * Tells the route layer which HTTP/WSS surfaces this provider exposes
 * and how end-of-call events arrive. Lets the admin UI render only the
 * webhook URLs that apply and the telemetry layer apply only the
 * controls the provider supports.
 */
export interface VoiceProviderCapabilities {
  /** "single" = one end-of-call webhook (VAPI). "split" = two webhooks
   *  merged by externalCallId (Retell: call_ended + call_analyzed). */
  endOfCallEvents: "single" | "split";
  /** True when the provider fires an HTTP per-turn knowledge callback
   *  (VAPI's Custom Knowledge Base). False for providers that consume
   *  pre-uploaded knowledge IDs (Retell). Drives the knowledge route
   *  capability guard in #1079. */
  hasKnowledgeCallback: boolean;
  /** True when tool calls arrive via WebSocket (Retell custom-LLM)
   *  instead of HTTP POST (VAPI). The HTTP tools route returns 404 for
   *  WS-only providers; the WSS handler dispatches instead. */
  toolCallsOverWebSocket: boolean;
  /** Provider supports proactive end-call from server (cost-cap, abuse
   *  prevention). When false, the cost-cap watcher in #1080 logs but
   *  cannot terminate the call. */
  supportsRequestEndCall: boolean;
  /** Orchestration shape (#1337). "vendor-cloud" = provider runs the
   *  agent loop in their own cloud and calls back over HTTP/WSS (VAPI,
   *  Retell). "self-hosted-agent" = the agent loop runs INSIDE HF's
   *  process (LiveKit Agents, Pipecat) — no per-turn webhooks; tools
   *  are direct function calls; KB lookups happen inline. The
   *  `/api/voice/[slug]/{tools,knowledge,assistant-request}` routes
   *  return 404 for `self-hosted-agent` providers (those callbacks
   *  have no remote sender). Existing `endOfCallEvents`,
   *  `hasKnowledgeCallback`, and `toolCallsOverWebSocket` flags retain
   *  their fine-grained meaning for vendor-cloud providers; they're
   *  ignored on the self-hosted path. */
  orchestrationMode: "vendor-cloud" | "self-hosted-agent";
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
   *
   * For HTTP-tools providers (VAPI). WSS-tools providers should still
   * implement this — they return an empty batch when the HTTP tools
   * route receives spurious traffic (Retell does this).
   */
  normaliseToolCallList(body: unknown): NormalisedToolCallBatch;

  /**
   * Extract a single tool call from a WebSocket message (#1079, Retell
   * custom-LLM). Returns null when the message isn't a tool-call frame
   * (most messages aren't). HTTP-only adapters can omit this — the
   * WSS route checks `getCapabilities().toolCallsOverWebSocket` before
   * invoking. Optional: presence is the signal.
   */
  normaliseToolCallFromWebSocketMessage?(
    msg: unknown,
  ): NormalisedToolCall | null;

  /**
   * Extract per-call cost + duration from a mid-call status update
   * (AnyVoice #1080). VAPI fires `status-update` events with running
   * cost-so-far; the trickle handler logs the delta as a VOICE
   * UsageEvent and checks the cost cap.
   *
   * Returns null when the body isn't a status-update for this provider
   * (e.g. a ping or a non-cost-bearing status arrives). Optional: a
   * provider that doesn't emit live status events can skip this method
   * and the trickle handler short-circuits.
   */
  normaliseStatusUpdate?(body: unknown): {
    externalCallId: string;
    costSoFarUsd: number | null;
    durationSecondsSoFar: number | null;
  } | null;

  /**
   * End an in-flight call from the server (AnyVoice #1080 cost-cap).
   * VAPI: `POST https://api.vapi.ai/call/{id}/end`. Retell:
   * `POST /v2/end-call`. Optional — provider that can't terminate
   * server-side declares `supportsRequestEndCall: false` in
   * capabilities and the cost-cap watcher logs but cannot kill the
   * call. Implementation should be idempotent for already-ended calls.
   */
  requestEndCall?(externalCallId: string): Promise<void>;

  /**
   * Parse the provider's per-turn knowledge-base callback into a
   * canonical {messages, callId, customerPhone} shape. Returns null
   * when the body doesn't match this provider's knowledge-request
   * contract (e.g. wrong message type) — route returns 400.
   *
   * Added in #1022; pairs with buildKnowledgeResponse below so the
   * knowledge route owns retrieval, not transport shape.
   */
  parseKnowledgeBaseRequest(body: unknown): KnowledgeBaseRequest | null;

  /**
   * Wrap RAG results in the provider's expected response shape.
   * VAPI's Custom Knowledge Base expects `{ results: [{ content, similarity }] }`;
   * other providers may need a different envelope.
   */
  buildKnowledgeResponse(results: KnowledgeResult[]): unknown;

  /**
   * Describe this provider's credentials + config fields (AnyVoice #1044).
   * Drives the schema-form rendered at `/x/settings/voice-providers/[id]`
   * and the PATCH validation pass. Pure function — must not hit DB.
   */
  getConfigSchema(): ProviderConfigSchema;

  /**
   * Declare which HTTP/WSS surfaces this provider uses and how it emits
   * end-of-call events (AnyVoice #1044). Drives capability-aware
   * dispatch in #1079 + #1080. Pure function — must not hit DB.
   */
  getCapabilities(): VoiceProviderCapabilities;

  /**
   * Parse a mid-call transcript-update webhook into the canonical shape (#1337).
   *
   * Pre-#1337 this lived as a switch on `slug` inside
   * `lib/voice/route-handlers.ts` — only the VAPI branch was wired and
   * every other provider's transcripts silently dropped. Dispatching
   * through the adapter removes that hole and lets any adapter that
   * emits transcript webhooks (Retell `transcript_updated`, future
   * LiveKit/Pipecat) implement this method.
   *
   * Returns null when the body isn't a transcript event for this
   * provider (e.g. a status-update reaches the same webhook), or when
   * the event carries no incremental text. Optional — providers that
   * never emit transcript events (or whose transcripts arrive over a
   * different channel like WSS) can omit this method.
   *
   * Used by `processTranscriptUpdate` → `broadcastToCall` to feed the
   * `transcript-partial` SSE channel that `components/sim/SimChat.tsx`
   * subscribes to.
   */
  parseTranscriptUpdate?(body: unknown): ParsedTranscriptUpdate | null;

  /**
   * Return the catalog of legal voiceIds for every TTS provider this
   * adapter routes through (#1421 Slice A).
   *
   * The admin UI calls this to populate the voiceId dropdown — it
   * filters by the currently-selected `voiceProvider` enum value. For
   * providers with account-specific catalogs (ElevenLabs), return an
   * empty list for that voiceProvider entry and the UI shows a
   * "Custom voice ID…" hatch.
   *
   * Static lists are fine for v1 — the small enums (Deepgram Aura: 12,
   * OpenAI TTS: 6) don't justify a runtime fetch. ElevenLabs / Azure /
   * PlayHT catalogs change frequently and warrant a future API-backed
   * fetch path (out of scope for #1421).
   *
   * Optional — adapters without TTS dispatch (self-hosted or
   * STT-only) can omit; UI hides the voiceId field when absent.
   */
  getVoiceCatalog?(): VoiceCatalogEntry[];
}
