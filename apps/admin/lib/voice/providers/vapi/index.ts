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
  ParsedTranscriptUpdate,
  ProviderAssistantConfig,
  ProviderConfigSchema,
  VoiceCatalogEntry,
  VoiceProvider,
  VoiceProviderCapabilities,
} from "../../types";
import { verifyVapiRequest } from "./auth";
import { log } from "@/lib/logger";

/**
 * Valid `assistant.backgroundSound` values accepted by the VAPI API.
 *
 * VAPI's API contract: `"off"` (silent default — we omit the key when
 * this is the resolved value), `"office"` (ambient), OR a URL to a
 * custom audio file. Any other string is rejected with HTTP 400
 * "assistant.backgroundSound must be a valid URL or one of the
 * following: off, office".
 *
 * Module-scope so the regex is compiled once. Do NOT inline these in
 * `buildAssistantConfig()` — re-creating the regex per call would burn
 * cycles in the hot path.
 *
 * Live evidence the allowlist matters: #1438 / hf_sandbox 2026-06-10 —
 * stored `"phone-line"` (pre-fix our schema advertised it as a valid
 * enum) reached VAPI and produced a silent 502 for every outbound dial.
 */
const VALID_BACKGROUND_SOUNDS: readonly string[] = ["office"];
const BACKGROUND_SOUND_URL_RE = /^https?:\/\/.+/;

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
    //   4. **Path-segment auth (#TBD-pathseg)** — survives VAPI's
    //      "/chat/completions" append cleanly. When `ctx.customLlmSecret`
    //      is set AND hex-shaped, URL becomes ".../llm-proxy/auth/<HEX>";
    //      VAPI's append produces ".../llm-proxy/auth/<HEX>/chat/completions"
    //      → hits `app/api/voice/llm-proxy/auth/[secret]/chat/completions`
    //      which path-validates + timing-safe-compares against
    //      `credentials.webhookSecret`. Non-hex / wrong-length secrets
    //      fall back to the header surface — pass-through if empty,
    //      401 otherwise (the operator should see a clear error in the
    //      VM log + diag dump rather than ship a mangled URL).
    const llmProxyBase = ctx.serverUrlBase
      .replace(new RegExp(`/${this.slug}$`), "")
      .concat("/llm-proxy");
    const secret = ctx.customLlmSecret;
    const useHexPathSegment =
      typeof secret === "string" &&
      secret.length >= 8 &&
      secret.length <= 256 &&
      /^[A-Fa-f0-9]+$/.test(secret);
    const customLlmProxyUrl = useHexPathSegment
      ? `${llmProxyBase}/auth/${secret}`
      : llmProxyBase;
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

    // #1271 — Per-VP voice knobs from the resolver cascade. Fields are
    // declared in getConfigSchema() and cascade via `resolveVoiceConfig`
    // (System → enabled VP → Domain → Course). Domain or Course can
    // override per-cohort. Adapter consumes raw resolved values here.
    const vc = ctx.voiceConfig;
    if (vc) {
      const voiceId = vc.voiceId;
      const voiceProvider = (vc.voiceProvider as string | undefined) ?? "11labs";
      if (typeof voiceId === "string" && voiceId.length > 0) {
        assistant.voice = { provider: voiceProvider, voiceId };
      }
      const transcriber = vc.transcriber;
      const transcriberEndpointingMs = vc.transcriberEndpointingMs;
      if (typeof transcriber === "string" && transcriber.length > 0) {
        const transcriberBlock: Record<string, unknown> = { provider: transcriber };
        // #1374 — endpointing controls how long VAPI waits after
        // detecting silence before committing the learner's turn.
        // Lower = faster turn-takes; higher = fewer mid-thought
        // interruptions. Deepgram default is 300ms.
        if (
          typeof transcriberEndpointingMs === "number" &&
          Number.isFinite(transcriberEndpointingMs) &&
          transcriberEndpointingMs > 0
        ) {
          transcriberBlock.endpointing = transcriberEndpointingMs;
        }
        assistant.transcriber = transcriberBlock;
      }
      // #1438 — allowlist guard. Pre-fix this passed any non-"off" string
      // straight to VAPI, which 400s for anything outside {"off","office",URL}.
      // Stored bad values (e.g. "phone-line" via stale dropdown) caused a
      // silent 502 chain. Omit + warn so the dial still completes when only
      // this knob is bad.
      const backgroundSound = vc.backgroundSound;
      if (typeof backgroundSound === "string" && backgroundSound !== "off") {
        if (
          VALID_BACKGROUND_SOUNDS.includes(backgroundSound) ||
          BACKGROUND_SOUND_URL_RE.test(backgroundSound)
        ) {
          assistant.backgroundSound = backgroundSound;
        } else {
          log("system", "voice.vapi.background_sound_invalid", {
            level: "warn",
            value: backgroundSound,
          });
        }
      }
      if (vc.recordingEnabled === false) {
        assistant.recordingEnabled = false;
      }
      // #1382 — `fillerInjectionEnabled` REMOVED from the wire payload.
      // VAPI's assistant schema rejects this field outright with HTTP
      // 400: "assistant.property fillerInjectionEnabled should not
      // exist". Live evidence: caller 0f6f6ed6 / 2026-06-09 09:35 —
      // every Talk Here attempt failed before mic-permission with
      // exactly this error. Field likely moved (renamed, plan-tier
      // gated, or only valid on PSTN assistant shape, not WebRTC).
      // Haiku model + 30-cap teaching points (#1377) carry most of
      // the latency win on their own.
      //
      // Field stays declared in getConfigSchema so when the right
      // name resurfaces we can wire it back without re-editing the
      // schema. Cascade reads it but the adapter no-ops it for now.
      void vc.fillerInjectionEnabled;
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
        {
          // #1421 Slice B — HF's own Deepgram API key for the sample-voice
          // button. When set + voiceProvider="deepgram", the sample route
          // hits Deepgram TTS directly so the preview voice matches the
          // live VAPI-Deepgram voice exactly. When unset, sample falls back
          // to OpenAI TTS with a clear "Preview voice ≠ live voice" label.
          // Independent from VAPI's own Deepgram billing — live calls
          // continue through VAPI's backend Deepgram integration.
          key: "deepgramApiKey",
          label: "Deepgram API key (HF-direct, for voice sampling)",
          type: "string",
          help: "Optional. Deepgram dashboard → API Keys → \"Create Key\" with Speak permission. Used ONLY by the [▶ Test] voice sample button so the preview matches the live voice exactly. Live calls bill through VAPI as usual. Leave blank to fall back to OpenAI TTS for the preview (preview won't match live voice).",
          sensitive: true,
          required: false,
        },
        // #1271 — Per-VP voice knobs. Non-sensitive → land in VoiceProvider.config.
        // Reads cascade through `resolveVoiceConfig`: Domain or Course can
        // override these per-course. Adapter weaves them into the inline
        // assistant config in `buildAssistantConfig`.
        {
          key: "voiceId",
          label: "Voice ID",
          type: "string",
          help: "Voice ID for the selected `voiceProvider` engine. Default \"asteria\" (Deepgram Aura). For ElevenLabs use \"21m00Tcm4TlvDq8ikWAM\" (Rachel) etc. Find IDs in VAPI dashboard → Voices. Voice ID MUST match the engine selected in `voiceProvider` — a mismatch makes calls connect with no audio.",
          sensitive: false,
          required: false,
        },
        {
          key: "voiceProvider",
          label: "Voice provider (TTS engine)",
          type: "enum",
          enumValues: ["11labs", "openai", "azure", "playht", "deepgram"],
          default: "deepgram",
          help: "Which TTS engine the voice ID belongs to. Default \"deepgram\" (Aura — ~$0.015/min, conversational-AI tuned, same datacentre as default STT for lowest latency). Use \"11labs\" for premium voice quality at ~12× the cost. \"openai\" is a viable middle ground. \"azure\"/\"playht\" require extra API-key linkage in the VAPI dashboard. See ADR docs/decisions/2026-06-08-pilot-cheaper-tts.md.",
          sensitive: false,
          required: false,
        },
        {
          key: "transcriber",
          label: "Transcriber (STT engine)",
          type: "enum",
          enumValues: ["deepgram", "talkscriber", "gladia", "assembly-ai"],
          default: "deepgram",
          help: "Speech-to-text engine VAPI uses to transcribe the learner. Deepgram default. Switch only if you observe transcription errors that persist after adjusting the prompt.",
          sensitive: false,
          required: false,
        },
        {
          key: "backgroundSound",
          label: "Background sound",
          type: "enum",
          // #1438 — VAPI only accepts "off", "office", or a URL. The
          // earlier `"phone-line"` enum value was rejected at the API
          // boundary with HTTP 400 and produced a silent 502 chain in
          // the outbound-dial route. URL inputs are accepted by the
          // adapter guard (lib/voice/providers/vapi/index.ts BACKGROUND_SOUND_URL_RE)
          // but not surfaced as enum values — operators who need a
          // custom audio URL paste it into Course/Domain overrides.
          enumValues: ["off", "office"],
          default: "off",
          help: "Optional ambient sound played behind the AI's voice. \"office\" can mask silence but costs extra audio bandwidth.",
          sensitive: false,
          required: false,
        },
        {
          key: "recordingEnabled",
          label: "Record calls",
          type: "boolean",
          default: true,
          help: "When true, VAPI records the call audio and posts a URL on end-of-call. Stored on Call.recordingUrl. Disable for privacy-strict cohorts.",
          sensitive: false,
          required: false,
        },
        {
          // #1373 — Live transcript-bubble stream toggle. Cascade-aware.
          // When false, /api/voice/calls/[id]/stream still serves the
          // call-started + call-ended events but transcript-partial
          // broadcasts are suppressed server-side. Post-call transcript
          // (Call.transcript via end-of-call pipeline) is unaffected —
          // bubbles still appear after the call. Default true preserves
          // current behaviour; set false per Course for cohorts where
          // operators prefer the chat surface stays empty during calls.
          key: "transcriptStreamEnabled",
          label: "Live transcript bubbles",
          type: "boolean",
          default: true,
          help: "When on, SimChat shows the conversation in real-time as bubbles while the call is live. When off, bubbles only appear after the call ends (from the persisted transcript). Off can reduce visual noise during high-volume cohort calls.",
          sensitive: false,
          required: false,
        },
        {
          // #1374 — VAPI filler injection. Plays brief "mm-hmm, let me
          // think..." style audio while the AI generates its response.
          // Hides Claude's ~3s response latency from the learner —
          // critical for natural-feeling conversation. Default ON;
          // educator can turn off per-cohort if it feels intrusive.
          key: "fillerInjectionEnabled",
          label: "Filler injection (mask AI thinking time)",
          type: "boolean",
          default: true,
          help: "When on, VAPI plays brief 'uh-huh, let me think' audio while the AI generates each response — masks the ~3 second latency so the conversation feels natural. Turn off only if the fillers feel intrusive for your cohort.",
          sensitive: false,
          required: false,
        },
        {
          // #1374 — Deepgram transcriber endpointing threshold. Lower
          // = AI commits to "learner finished" sooner = faster turn-take.
          // Default 300ms is conservative; 100-200ms feels snappier but
          // increases mid-thought interruption risk. Numbers > 1000 add
          // perceived lag.
          key: "transcriberEndpointingMs",
          label: "Transcriber endpointing (ms)",
          type: "number",
          default: 150,
          help: "Milliseconds of silence after the learner stops speaking before VAPI commits the turn and the AI starts responding. Default 150ms feels snappy. Raise to 300+ for cohorts who pause mid-thought; lower to 100 for fast back-and-forth practice.",
          sensitive: false,
          required: false,
        },
        // #1377 — Teaching-points cap is hardcoded at 30 in
        // lib/prompt/composition/transforms/teaching-content.ts today.
        // Future PR wires `voiceConfig` into composition sharedState so
        // the cap becomes cascade-tunable (per-Course / per-Cohort).
        // See GH issue for cascade plumbing scope.
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
      // #1337 — VAPI runs the agent loop in their cloud and calls back over
      // HTTP for tools / knowledge / end-of-call. LiveKit/Pipecat-style
      // providers would declare "self-hosted-agent" here.
      orchestrationMode: "vendor-cloud",
    };
  }

  /**
   * Catalog of legal voiceIds per TTS engine routed via this VAPI
   * adapter (#1421 Slice A). Static lists — covers v1's 5 voiceProvider
   * enum values. ElevenLabs returns an empty list because its catalog is
   * account-specific; the UI keeps a "Custom voice ID…" hatch for that
   * case.
   */
  getVoiceCatalog(): VoiceCatalogEntry[] {
    return [
      // Deepgram Aura 1 — the canonical 12 voices. Matches the VAPI →
      // Deepgram integration HF uses for live calls.
      { voiceProvider: "deepgram", voiceId: "asteria",  label: "Asteria — Female, conversational (default)", description: "Warm, natural, US English. The hf-default voice." },
      { voiceProvider: "deepgram", voiceId: "luna",     label: "Luna — Female, friendly",                    description: "Clear, casual, US English." },
      { voiceProvider: "deepgram", voiceId: "stella",   label: "Stella — Female, narrator",                  description: "Calm, measured, US English." },
      { voiceProvider: "deepgram", voiceId: "athena",   label: "Athena — Female, mature",                    description: "Authoritative, UK English." },
      { voiceProvider: "deepgram", voiceId: "hera",     label: "Hera — Female, formal",                      description: "Polished, US English." },
      { voiceProvider: "deepgram", voiceId: "orion",    label: "Orion — Male, approachable",                 description: "Friendly, US English." },
      { voiceProvider: "deepgram", voiceId: "arcas",    label: "Arcas — Male, conversational",               description: "Casual, US English." },
      { voiceProvider: "deepgram", voiceId: "perseus",  label: "Perseus — Male, confident",                  description: "Assertive, US English." },
      { voiceProvider: "deepgram", voiceId: "angus",    label: "Angus — Male, narrator",                     description: "Steady, Irish English." },
      { voiceProvider: "deepgram", voiceId: "orpheus",  label: "Orpheus — Male, smooth",                     description: "Warm, US English." },
      { voiceProvider: "deepgram", voiceId: "helios",   label: "Helios — Male, energetic",                   description: "Upbeat, UK English." },
      { voiceProvider: "deepgram", voiceId: "zeus",     label: "Zeus — Male, deep",                          description: "Resonant, US English." },

      // OpenAI TTS — 6 voices (the standard catalog).
      { voiceProvider: "openai", voiceId: "alloy",   label: "Alloy — Neutral, balanced" },
      { voiceProvider: "openai", voiceId: "echo",    label: "Echo — Male, conversational" },
      { voiceProvider: "openai", voiceId: "fable",   label: "Fable — Male, narrator (UK)" },
      { voiceProvider: "openai", voiceId: "onyx",    label: "Onyx — Male, deep" },
      { voiceProvider: "openai", voiceId: "nova",    label: "Nova — Female, warm" },
      { voiceProvider: "openai", voiceId: "shimmer", label: "Shimmer — Female, gentle" },

      // ElevenLabs — empty catalog (account-specific). The UI exposes a
      // "Custom voice ID…" text input when an empty array is returned
      // for the currently-selected voiceProvider. Future: fetch via
      // ElevenLabs `/v1/voices` API when an HF-level key is added.

      // Azure / PlayHT — sensible defaults the operator can override via
      // the custom-ID hatch. Listing nothing means the UI defaults to
      // the hatch immediately, avoiding fake completeness.
    ];
  }

  /**
   * Parse VAPI's `conversation-update` / `transcript` event into the
   * canonical shape (#1337 extracted from `lib/voice/route-handlers.ts`).
   *
   * Behaviour is byte-identical to the prior in-route function — see
   * `tests/lib/voice/vapi-provider.parse-transcript.test.ts`. The route
   * layer now dispatches via `provider.parseTranscriptUpdate?.(body)`
   * which means future adapters (Retell once its `transcript_updated`
   * event is wired, LiveKit/Pipecat) light up by implementing this
   * method — no edits to `route-handlers.ts` required.
   */
  parseTranscriptUpdate(body: unknown): ParsedTranscriptUpdate | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const message = (root.message ?? root) as Record<string, unknown>;
    const type = (message.type ?? root.type) as string | undefined;
    // #1366 — parse BOTH `transcript` AND `conversation-update`. Live data
    // showed VAPI's custom-llm setup fires ONLY `conversation-update`
    // (no `transcript` events at all on the wire for this call shape).
    // The #1364 "skip conversation-update" attempt killed all live
    // broadcasts. Dedup now lives ENTIRELY on the client (#1365 REPLACE-
    // not-APPEND coalesce) — REPLACE handles both event types correctly
    // because each event carries the FULL latest turn (transcript = full
    // Deepgram interim, conversation-update = full latest message via
    // history-walk).
    if (type !== "transcript" && type !== "conversation-update") return null;

    const call = (message.call ?? root.call) as
      | Record<string, unknown>
      | undefined;
    const externalCallId =
      (call?.id as string | undefined) ??
      (call?.callId as string | undefined) ??
      (call?.call_id as string | undefined);
    if (!externalCallId) return null;

    // VAPI's `transcript` event has the chunk on the root:
    //   { type: "transcript", transcript: "...", role: "user"|"assistant" }
    // VAPI's `conversation-update` event carries the FULL conversation
    // history in `messages` (or `messagesOpenAIFormatted`); the most
    // recent non-system turn is the new chunk. Pre-#922 this path only
    // read `message.transcript`, which is unset on `conversation-update`
    // — so the chat-rail SSE never received broadcasts despite VAPI
    // firing the events at ~1Hz.
    let rawText =
      (message.transcript as string | undefined) ??
      (message.text as string | undefined) ??
      "";
    let rawRole: string = (message.role as string | undefined) ?? "user";

    if (!rawText && type === "conversation-update") {
      const msgs = (message.messages ??
        message.messagesOpenAIFormatted ??
        message.conversation) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(msgs)) {
        // #1371 — VAPI emits multi-message assistant turns (one message
        // per sentence / TTS chunk). Pre-#1371 we picked ONLY the last
        // message — REPLACE coalesce then showed only the last phrase
        // live, while the full text only appeared post-call from
        // Call.transcript. Fix: walk backwards from the tail, collect
        // ALL consecutive same-role messages, join with spaces. Stops
        // on the first role change (= previous speaker's turn).
        const collected: string[] = [];
        let pickedRole: string | null = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (!m || typeof m !== "object") continue;
          const role = (m.role as string | undefined) ?? "";
          if (role === "system" || role === "tool") continue;
          const content =
            (m.content as string | undefined) ??
            (m.message as string | undefined) ??
            "";
          if (typeof content !== "string" || content.length === 0) continue;
          if (pickedRole === null) {
            pickedRole = role;
            collected.unshift(content);
          } else if (role === pickedRole) {
            collected.unshift(content);
          } else {
            break;
          }
        }
        if (collected.length > 0 && pickedRole) {
          rawText = collected.join(" ");
          rawRole = pickedRole || rawRole;
        }
      }
    }

    if (!rawText) return null;

    const role: "learner" | "assistant" =
      rawRole === "assistant" || rawRole === "bot"
        ? "assistant"
        : "learner";

    // #1361 — Pull HF placeholder id out of `assistant.metadata.hfCallId`
    // (set at WebRTC call-start). VAPI echoes assistant metadata in webhook
    // payloads under a few different nest paths depending on event type;
    // try the most common ones in order, fall back to null.
    const assistant = (message.assistant ?? root.assistant) as
      | Record<string, unknown>
      | undefined;
    const assistantOverrides = (call?.assistantOverrides ??
      message.assistantOverrides) as Record<string, unknown> | undefined;
    const callMeta = call?.metadata as Record<string, unknown> | undefined;
    const messageMeta = message.metadata as Record<string, unknown> | undefined;

    const hfCallIdCandidate =
      (assistant?.metadata as Record<string, unknown> | undefined)?.hfCallId ??
      (assistantOverrides?.metadata as Record<string, unknown> | undefined)?.hfCallId ??
      callMeta?.hfCallId ??
      messageMeta?.hfCallId ??
      null;
    const hfCallId =
      typeof hfCallIdCandidate === "string" && hfCallIdCandidate.length > 0
        ? hfCallIdCandidate
        : null;

    return { externalCallId, role, text: rawText, hfCallId };
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
