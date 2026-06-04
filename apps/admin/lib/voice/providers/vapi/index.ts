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
  KnowledgeResult,
  NormalisedEndOfCallCapture,
  NormalisedEndOfCallEvent,
  NormalisedToolCall,
  NormalisedToolCallBatch,
  ProviderAssistantConfig,
  VoiceProvider,
} from "../../types";
import { verifyVapiRequest } from "./auth";

interface VapiCredentials {
  apiKey?: string;
  webhookSecret?: string;
}

export class VapiProvider implements VoiceProvider {
  readonly slug = "vapi";

  private readonly webhookSecret: string | undefined;

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

    const assistant: Record<string, unknown> = {
      model: {
        provider: ctx.modelConfig.provider,
        model: ctx.modelConfig.model,
        messages: [{ role: "system", content: ctx.voicePrompt }],
        ...(tools.length > 0 ? { tools } : {}),
      },
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

    return { assistant };
  }

  normaliseEndOfCallEvent(body: unknown): NormalisedEndOfCallEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    // VAPI nests under `message` for some events, root for others
    const message = (root.message ?? root) as Record<string, unknown>;
    const call = (message.call ?? message) as Record<string, unknown>;

    const externalCallId =
      (call.id as string | undefined) ??
      (call.callId as string | undefined) ??
      (call.call_id as string | undefined);
    if (!externalCallId) return null;

    const customer = call.customer as Record<string, unknown> | undefined;
    const customerPhone = (customer?.number as string | undefined) ?? null;
    const customerName = (customer?.name as string | undefined) ?? null;

    let transcript = (call.transcript as string | undefined) ?? "";
    if (!transcript && Array.isArray(call.messages)) {
      transcript = (call.messages as Array<Record<string, unknown>>)
        .filter((m) => m.role && m.content)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
    }

    return {
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
    const empty: NormalisedToolCallBatch = { toolCalls: [], customerPhone: null };
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

    return { toolCalls, customerPhone };
  }

  buildKnowledgeResponse(results: KnowledgeResult[]): unknown {
    return { results };
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
