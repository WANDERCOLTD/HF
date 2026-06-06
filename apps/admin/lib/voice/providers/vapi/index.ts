/**
 * VapiProvider — VoiceProvider adapter for vapi.ai
 * (introduced #1017, made data-driven #1031).
 *
 * Wraps every VAPI-specific transport concern so the four routes under
 * app/api/vapi/* contain no VAPI wire-format logic of their own. The
 * factory (`lib/voice/provider-factory.ts`) instantiates one of these
 * per slug-cache-window with credentials + config from the matching
 * `VoiceProvider` DB row.
 *
 * Constructor seam (#1031): credentials.webhookSecret + config.* come
 * from the DB row, not env vars. A transient env-var fallback for
 * webhookSecret exists for the deploy-window before the seed has run;
 * it console.warns so operators see the cutover gap.
 *
 * VAPI HTTP contract reference:
 *   https://docs.vapi.ai/server-url/events
 *   https://docs.vapi.ai/tools/custom-tools
 *   https://docs.vapi.ai/knowledge-base/custom-knowledge-base
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
  ProviderAssistantConfig,
  ProviderConfigSchema,
  VoiceProvider,
  VoiceProviderCapabilities,
} from "../../types";
import { verifyVapiRequest } from "./auth";

interface VapiCredentials {
  apiKey?: string;
  webhookSecret?: string;
}

export class VapiProvider implements VoiceProvider {
  readonly slug = "vapi";

  private readonly webhookSecret: string | undefined;
  private readonly _apiKey: string | undefined;

  /**
   * Construct from DB-stored credentials + config. The factory passes
   * `VoiceProvider.credentials` (Json) and `VoiceProvider.config` (Json)
   * unchanged. Keep this cheap — no DB calls, no IO — since the factory
   * may construct one per slug per cache window.
   *
   * Transient env-var fallback for `webhookSecret`: fires only when the
   * DB row's credentials.webhookSecret is unset, which should only
   * happen in the deploy window between code deploy and seed completion.
   * Logs a console.warn so operators see the cutover gap. Remove the
   * fallback once `VAPI_WEBHOOK_SECRET` is gone from every environment
   * (the env-var line is already removed from `lib/config.ts`).
   */
  constructor(
    credentials: Record<string, unknown>,
    _config: Record<string, unknown>,
  ) {
    const creds = credentials as VapiCredentials;
    this._apiKey = creds.apiKey;
    if (creds.webhookSecret) {
      this.webhookSecret = creds.webhookSecret;
    } else if (process.env.VAPI_WEBHOOK_SECRET) {
      console.warn(
        "[vapi] VoiceProvider.credentials.webhookSecret not set — falling back to env var. Seed not yet run.",
      );
      this.webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
    } else {
      // Local-dev with no secret: leave undefined; verifyVapiRequest
      // pass-through preserves the existing no-secret ergonomics.
      this.webhookSecret = undefined;
    }
  }

  verifyInboundRequest(
    req: NextRequest,
    rawBody: string,
  ): NextResponse | null {
    return verifyVapiRequest(req, rawBody, this.webhookSecret);
  }

  buildAssistantConfig(ctx: AssistantRequestContext): ProviderAssistantConfig {
    const toolsServerUrl = `${ctx.serverUrlBase}/tools`;
    const knowledgeServerUrl = `${ctx.serverUrlBase}/knowledge`;
    const webhookUrl = `${ctx.serverUrlBase}/webhook`;

    // VAPI tools accept the OpenAI function-call format directly plus a
    // `server.url` field per tool. Map our canonical definitions to that
    // shape. Empty array → omit the `tools` key entirely (VAPI accepts
    // an assistant without tools).
    const tools = ctx.toolDefinitions.map((tool) => ({
      ...tool,
      server: { url: toolsServerUrl },
    }));

    // #1176 — custom-llm branch routes every voice turn through HF's
    // own /api/voice/llm-proxy endpoint so the LLM call flows through
    // HF's metered AI wrapper (cost tracking, prompt caching, model
    // swap via voice.model setting, audit trail). VAPI's role becomes
    // STT → HF proxy → TTS — VAPI no longer needs its own Anthropic /
    // OpenAI key.
    //
    // The shared secret is implicit: VAPI's custom-llm POSTs include an
    // `x-vapi-secret` header that the proxy verifies via timingSafeEqual
    // against VoiceProvider.credentials.webhookSecret. Same value used
    // for webhook HMAC — one credential, two purposes.
    //
    // Other providers (openai, anthropic, google, etc.) keep working
    // unchanged — VAPI's stack uses its own dashboard credentials.
    const isCustomLlm = ctx.modelConfig.provider === "custom-llm";
    // ctx.serverUrlBase is the per-provider prefix
    // ("https://<host>/api/voice/<slug>"). The llm-proxy route lives at
    // "<host>/api/voice/llm-proxy/chat/completions" — but VAPI's
    // custom-llm client APPENDS "/chat/completions" to whatever url we
    // send, so we hand it the BASE without that suffix and let VAPI
    // tack it on. Same applies to query strings: VAPI's concat is naive
    // and `?secret=abc123` becomes `?secret=abc123/chat/completions`
    // when VAPI mangles the end. So no query auth either.
    //
    // #922 lessons:
    //   1. `assistant.model.secret` — REJECTED by VAPI schema
    //      ("property secret should not exist"). #1187's assumption
    //      was wrong.
    //   2. `?secret=...` query — VAPI naively concatenates
    //      "/chat/completions" onto the END, mangling the value.
    //   3. Pass-through auth (empty webhookSecret) — works in dev.
    //      Prod will need a path-segment scheme.
    const customLlmProxyUrl = ctx.serverUrlBase
      .replace(new RegExp(`/${this.slug}$`), "")
      .concat("/llm-proxy");
    void ctx.customLlmSecret; // intentionally unused — see comment above
    const modelBlock: Record<string, unknown> = isCustomLlm
      ? {
          provider: "custom-llm",
          url: customLlmProxyUrl,
          model: ctx.modelConfig.model,
          messages: [{ role: "system", content: ctx.voicePrompt }],
          ...(tools.length > 0 ? { tools } : {}),
        }
      : {
          provider: ctx.modelConfig.provider,
          model: ctx.modelConfig.model,
          messages: [{ role: "system", content: ctx.voicePrompt }],
          ...(tools.length > 0 ? { tools } : {}),
        };

    const assistant: Record<string, unknown> = {
      model: modelBlock,
      serverUrl: webhookUrl,
    };

    if (ctx.firstLine) {
      assistant.firstMessage = ctx.firstLine;
    }

    if (ctx.knowledgePlanEnabled) {
      assistant.knowledgePlan = {
        provider: "custom-knowledge-base",
        server: { url: knowledgeServerUrl },
      };
    }

    // Cost-safety knobs (PR voice-cost-knobs). Without these VAPI's
    // defaults can run a call for up to 10 minutes of silence and never
    // catch a voicemail loop. We inject the system-settings values so
    // the runaway-call exposure stays bounded regardless of caller
    // behaviour. See VoiceSystemSettings + admin panel.
    const knobs = ctx.costSafetyKnobs;
    if (knobs) {
      assistant.silenceTimeoutSeconds = knobs.silenceTimeoutSeconds;
      assistant.maxDurationSeconds = knobs.maxDurationSeconds;
      if (knobs.voicemailDetectionEnabled) {
        assistant.voicemailDetectionEnabled = true;
      }
      if (knobs.endCallPhrases && knobs.endCallPhrases.length > 0) {
        assistant.endCallPhrases = knobs.endCallPhrases;
      }
    }

    return { assistant };
  }

  normaliseEndOfCallEvent(body: unknown): NormalisedEndOfCallEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    // VAPI nests under `message` for some events, root for others
    const message = (root.message ?? root) as Record<string, unknown>;

    // #922 — Pre-fix this returned non-null for ANY message that had a
    // call.id, which meant `conversation-update`, `speech-update`,
    // `status-update`, and `assistant.started` (all of which include the
    // call object) were misclassified as end-of-call events. That short-
    // circuited the transcript-update branch in handleVoiceWebhookPost,
    // so /sim's chat rail SSE never received broadcast events and the
    // status-update trickle never ran. Discriminate by VAPI's
    // `message.type`. Real end-of-call is `end-of-call-report`.
    const messageType = (message.type ?? root.type) as string | undefined;
    if (messageType !== "end-of-call-report") return null;

    const call = (message.call ?? message) as Record<string, unknown>;

    const externalCallId =
      (call.id as string | undefined) ??
      (call.callId as string | undefined) ??
      (call.call_id as string | undefined);
    if (!externalCallId) return null;

    const customer = call.customer as Record<string, unknown> | undefined;
    const customerPhone = (customer?.number as string | undefined) ?? null;
    const customerName = (customer?.name as string | undefined) ?? null;

    // #922 — VAPI's end-of-call-report event puts the transcript at the
    // ROOT of `message` (alongside the nested `call` object), not on
    // `call.transcript`. Pre-fix this path read `call.transcript` only —
    // which is empty/missing on a real end-of-call-report — so every
    // outbound-dial finished with Call.transcript="" despite VAPI
    // sending the full 2KB+ transcript. The "Run analysis pipeline"
    // toggle on the End Call modal then ran the pipeline against an
    // empty transcript and wrote zero scores / behaviours. Check
    // `message.transcript` first; fall back to `call.transcript`;
    // synthesise from `message.messages` last.
    let transcript =
      (message.transcript as string | undefined) ??
      (call.transcript as string | undefined) ??
      "";
    if (!transcript) {
      const msgs =
        (message.messages as Array<Record<string, unknown>> | undefined) ??
        (call.messages as Array<Record<string, unknown>> | undefined);
      if (Array.isArray(msgs)) {
        transcript = msgs
          .filter((m) => m.role && m.role !== "system" && (m.content || m.message))
          .map((m) => `${m.role}: ${(m.content ?? m.message) as string}`)
          .join("\n");
      }
    }

    return {
      // VAPI fires a single end-of-call event with everything attached
      // (#1079). Pipeline trigger always fires for "full".
      eventKind: "full",
      externalCallId,
      customerPhone,
      customerName,
      transcript,
      capture: extractVapiCapture(message),
      // Verbatim inbound message → Call.voiceProviderRaw (#1021). Stored
      // for forensic debugging and one-off analytics; do NOT read this
      // field in shared code — promote to a canonical capture key if
      // any consumer beyond a one-off needs the data.
      providerRaw: message,
    };
  }

  normaliseToolCallList(body: unknown): NormalisedToolCallBatch {
    const empty: NormalisedToolCallBatch = {
      toolCalls: [],
      customerPhone: null,
      externalCallId: null,
    };
    if (!body || typeof body !== "object") return empty;
    const root = body as Record<string, unknown>;
    const message = (root.message ?? root) as Record<string, unknown>;

    const rawList =
      (message.toolCallList as unknown[] | undefined) ??
      (root.toolCallList as unknown[] | undefined) ??
      [];

    const call = (message.call ?? root.call) as Record<string, unknown> | undefined;
    const customer = call?.customer as Record<string, unknown> | undefined;
    const customerPhone = (customer?.number as string | undefined) ?? null;
    // #1092 — externalCallId threading for rail routing. The webhook
    // route resolves this to a local Call.id via findFirst({externalId,
    // source: slug}) so the SSE registry can answer "chat surface open?"
    // for share_content / send_text / request_artifact dispatch.
    const externalCallId =
      (call?.id as string | undefined) ??
      (call?.callId as string | undefined) ??
      (call?.call_id as string | undefined) ??
      null;

    const toolCalls: NormalisedToolCall[] = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as Record<string, unknown>;
      // VAPI supports two shapes: legacy `functionCall.{name, parameters}`
      // and current `function.{name, arguments}` (OpenAI alignment).
      const fn = (t.function ?? t.functionCall) as Record<string, unknown> | undefined;
      const funcName =
        (fn?.name as string | undefined) ?? (t.name as string | undefined);
      if (!funcName) continue;

      const rawArgs =
        (fn?.arguments as unknown) ??
        (fn?.parameters as unknown) ??
        (t.parameters as unknown) ??
        {};
      const args: Record<string, unknown> =
        typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs as Record<string, unknown>);

      const toolCallId =
        (t.id as string | undefined) ?? (t.toolCallId as string | undefined) ?? "";

      toolCalls.push({ toolCallId, funcName, args });
    }

    return { toolCalls, customerPhone, externalCallId };
  }

  parseKnowledgeBaseRequest(body: unknown): KnowledgeBaseRequest | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const message = (root.message ?? root) as Record<string, unknown>;

    // VAPI's Custom KB callback uses type === "knowledge-base-request".
    // When the type is missing or mismatched, fall through to null so
    // the route can 400; we still tolerate either nesting (root vs
    // root.message) per VAPI's actual delivery quirks.
    const type = (message.type ?? root.type) as string | undefined;
    if (type !== undefined && type !== "knowledge-base-request") {
      return null;
    }

    const rawMessages =
      (message.messages as unknown) ??
      (root.messages as unknown);
    if (!Array.isArray(rawMessages)) return null;

    const messages = (rawMessages as Array<Record<string, unknown>>)
      .filter((m) => typeof m.role === "string" && typeof m.content === "string")
      .map((m) => ({ role: m.role as string, content: m.content as string }));

    const call = (message.call ?? root.call) as Record<string, unknown> | undefined;
    const callId = (call?.id as string | undefined) ?? null;
    const customer = call?.customer as Record<string, unknown> | undefined;
    const customerPhone = (customer?.number as string | undefined) ?? null;

    return { messages, callId, customerPhone };
  }

  buildKnowledgeResponse(results: KnowledgeResult[]): unknown {
    return { results };
  }

  /**
   * VAPI config schema (AnyVoice #1044). VAPI carries only two
   * credentials and no provider-specific config today — keep the
   * schema tight so the admin form stays focused. Operators changing
   * the model / voice settings do that inside the VAPI dashboard,
   * not here.
   */
  getConfigSchema(): ProviderConfigSchema {
    return {
      fields: [
        {
          key: "apiKey",
          label: "VAPI Private API key",
          type: "string",
          help: "Server-side API key for outbound REST calls (cost-cap end-call, future provisioning). VAPI dashboard → API Keys → \"Private Key\". Leave blank if you don't need outbound features.",
          sensitive: true,
          required: false,
        },
        {
          key: "publicKey",
          label: "VAPI Public Key",
          type: "string",
          help: "Browser WebRTC SDK key (ships to the learner's browser; not a secret). VAPI dashboard → API Keys → \"Public Key\". Required for the [Call me] button to work.",
          sensitive: false,
          required: false,
        },
        {
          key: "webhookSecret",
          label: "Webhook secret (HMAC)",
          type: "string",
          help: "Shared secret used to verify inbound webhooks. Generate a random string (e.g. `openssl rand -hex 32`) and paste it into BOTH VAPI's Server URL Secret AND here. Leave blank for local-dev pass-through.",
          sensitive: true,
          required: false,
        },
        {
          key: "phoneNumberId",
          label: "VAPI phone number ID (for outbound dial)",
          type: "string",
          help: "Required ONLY for [Call me] PSTN outbound dial (browser [Talk Here] doesn't need it). VAPI dashboard → Phone Numbers → copy the ID of the number HF will dial FROM. Costs ~$2/mo + per-minute usage.",
          sensitive: false,
          required: false,
        },
      ],
    };
  }

  /**
   * VAPI capability declaration (AnyVoice #1044). Single end-of-call
   * event, HTTP tools + knowledge callbacks, server-side end-call via
   * `POST /call/{id}/end` (used by the cost-cap watcher in #1080).
   */
  getCapabilities(): VoiceProviderCapabilities {
    return {
      endOfCallEvents: "single",
      hasKnowledgeCallback: true,
      toolCallsOverWebSocket: false,
      supportsRequestEndCall: true,
    };
  }

  /**
   * Extract running cost + duration from a VAPI `status-update` event
   * (AnyVoice #1080 trickle). VAPI nests these under `message.cost`
   * and `message.duration`. Returns null when the body isn't a
   * status-update or carries no cost field.
   */
  normaliseStatusUpdate(body: unknown): {
    externalCallId: string;
    costSoFarUsd: number | null;
    durationSecondsSoFar: number | null;
  } | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const message = (root.message ?? root) as Record<string, unknown>;
    const type = (message.type ?? root.type) as string | undefined;
    if (type !== "status-update") return null;

    const call = (message.call ?? root.call) as Record<string, unknown> | undefined;
    const externalCallId =
      (call?.id as string | undefined) ??
      (call?.callId as string | undefined) ??
      (call?.call_id as string | undefined);
    if (!externalCallId) return null;

    let costSoFarUsd: number | null = null;
    if (typeof message.cost === "number" && Number.isFinite(message.cost)) {
      costSoFarUsd = message.cost;
    } else if (message.cost && typeof message.cost === "object") {
      const cost = message.cost as Record<string, unknown>;
      if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
        costSoFarUsd = cost.total;
      }
    }

    const durationSecondsSoFar =
      typeof message.duration === "number" && Number.isFinite(message.duration)
        ? message.duration
        : typeof message.durationSeconds === "number" && Number.isFinite(message.durationSeconds)
          ? message.durationSeconds
          : null;

    return { externalCallId, costSoFarUsd, durationSecondsSoFar };
  }

  /**
   * VAPI end-call API (AnyVoice #1080). Idempotent — VAPI returns 4xx
   * for already-ended calls; we swallow non-2xx so the cost-cap watcher
   * doesn't spam the error log on the inevitable race.
   */
  async requestEndCall(externalCallId: string): Promise<void> {
    const apiKey = this._apiKey;
    if (!apiKey) {
      console.warn(
        `[vapi] requestEndCall(${externalCallId}) skipped — no apiKey on VoiceProvider row`,
      );
      return;
    }
    try {
      await fetch(`https://api.vapi.ai/call/${externalCallId}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      console.warn(
        `[vapi] requestEndCall(${externalCallId}) failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * Extract VAPI end-of-call-report capture fields into the canonical shape.
 * Moved verbatim from app/api/vapi/webhook/route.ts::extractVapiCapture
 * during the #1017 adapter extraction. Field names use the canonical
 * (provider-neutral) keys; #1020 schema rename aligns Call.* columns to
 * match (`voiceDurationSeconds` etc).
 *
 * Until #1020 lands, the webhook route maps `capture.durationSeconds` →
 * `Call.vapiDurationSeconds` at the persistence boundary. The adapter
 * doesn't know about column names — that's the route's responsibility.
 */
export function extractVapiCapture(message: unknown): NormalisedEndOfCallCapture {
  if (!message || typeof message !== "object") return {};
  const msg = message as Record<string, unknown>;
  const out: NormalisedEndOfCallCapture = {};

  const artifact = msg.artifact;
  if (artifact && typeof artifact === "object") {
    const art = artifact as Record<string, unknown>;
    if (typeof art.recordingUrl === "string") out.recordingUrl = art.recordingUrl;
    if (typeof art.stereoRecordingUrl === "string") out.stereoRecordingUrl = art.stereoRecordingUrl;
  }

  if (typeof msg.durationSeconds === "number" && Number.isFinite(msg.durationSeconds)) {
    out.durationSeconds = msg.durationSeconds;
  }
  if (typeof msg.endedReason === "string") out.endedReason = msg.endedReason;

  // VAPI cost can be a number directly, or nested under `cost.total`
  if (typeof msg.cost === "number" && Number.isFinite(msg.cost)) {
    out.costUsd = msg.cost;
  } else if (msg.cost && typeof msg.cost === "object") {
    const cost = msg.cost as Record<string, unknown>;
    if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
      out.costUsd = cost.total;
    }
  }

  const analysis = msg.analysis;
  if (analysis && typeof analysis === "object") {
    const an = analysis as Record<string, unknown>;
    if (typeof an.summary === "string") out.analysisSummary = an.summary;
    if (an.structuredData && typeof an.structuredData === "object" && !Array.isArray(an.structuredData)) {
      out.structuredData = an.structuredData;
    }
    // successEvaluation can be string / number / boolean depending on rubric
    const se = an.successEvaluation;
    if (typeof se === "string") out.successEvaluation = se;
    else if (typeof se === "boolean" || typeof se === "number") {
      out.successEvaluation = String(se);
    }
  }

  return out;
}

// Singleton export from #1017 removed in #1031 — the factory now
// constructs per-request from DB credentials via VOICE_ADAPTERS. Tests
// that need a standalone instance instantiate with explicit args:
//   new VapiProvider({ webhookSecret: "..." }, {})
