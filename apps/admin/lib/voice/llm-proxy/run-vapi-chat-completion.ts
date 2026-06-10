/**
 * Shared body handler for VAPI custom-LLM POSTs (#1441 — extracted from
 * the route file so two auth surfaces can call it).
 *
 *   - Header / query auth surface: `/api/voice/llm-proxy/chat/completions`
 *   - Path-segment auth surface:   `/api/voice/llm-proxy/auth/[secret]/chat/completions`
 *
 * Each route does its own auth then calls `runVapiChatCompletion` with
 * the already-authenticated Request. NO auth here.
 *
 * This module owns everything from "parse the OpenAI request" through
 * "stream back the SSE response", including translation to Anthropic
 * and `logAIUsage` / `logVoiceEvent` telemetry. Pre-fix this logic was
 * 240 lines inside a single 431-line route file; splitting auth
 * surfaces was untenable until extraction.
 */

import { NextResponse } from "next/server";

import Anthropic from "@anthropic-ai/sdk";

import { config } from "@/lib/config";
import { log } from "@/lib/logger";
import { logAIUsage } from "@/lib/metering/usage-logger";
import { logVoiceEvent, startVoiceSpan } from "@/lib/voice/telemetry";

import {
  translateOpenAIRequestToAnthropic,
  type OpenAIChatCompletionRequest,
} from "./translate-request";
import {
  emptyCapturedUsage,
  translateAnthropicToOpenAISSE,
  type AnthropicStreamEvent,
} from "./translate-stream";

/** Slug of the VAPI VoiceProvider whose telemetry tag is used. */
const VAPI_SLUG = "vapi";

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = config.ai.claude.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured (config.ai.claude.apiKey)");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export async function runVapiChatCompletion(request: Request): Promise<Response> {
  const startMs = Date.now();
  const endSpan = startVoiceSpan({
    slug: VAPI_SLUG,
    operation: "voice_llm_proxy",
  });
  const callIdHeader = request.headers.get("x-vapi-call-id") ?? null;

  let body: OpenAIChatCompletionRequest;
  try {
    body = (await request.json()) as OpenAIChatCompletionRequest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("system", "voice.llm_proxy.bad_json", {
      level: "error",
      callId: callIdHeader,
      message: msg,
    });
    endSpan({ errorMessage: `Invalid JSON body: ${msg}` });
    return NextResponse.json(
      { error: { message: `Invalid JSON: ${msg}`, type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const systemCharCount = (() => {
    const sys = (body as Record<string, unknown>).messages as
      | Array<{ role?: string; content?: unknown }>
      | undefined;
    if (!Array.isArray(sys)) return 0;
    const sysMsg = sys.find((m) => m?.role === "system");
    return typeof sysMsg?.content === "string" ? sysMsg.content.length : 0;
  })();
  log("api", "voice.llm_proxy.body_parsed", {
    level: "info",
    callId: callIdHeader,
    model: (body as Record<string, unknown>).model ?? null,
    messageCount: Array.isArray((body as Record<string, unknown>).messages)
      ? ((body as Record<string, unknown>).messages as unknown[]).length
      : 0,
    systemCharCount,
    toolCount: Array.isArray((body as Record<string, unknown>).tools)
      ? ((body as Record<string, unknown>).tools as unknown[]).length
      : 0,
    stream: Boolean((body as Record<string, unknown>).stream),
  });

  let translated;
  try {
    translated = translateOpenAIRequestToAnthropic(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("system", "voice.llm_proxy.translate_failed", {
      level: "error",
      callId: callIdHeader,
      message: msg,
    });
    endSpan({ errorMessage: `Translation failed: ${msg}` });
    return NextResponse.json(
      { error: { message: msg, type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const callId = callIdHeader;
  log("api", "voice.llm_proxy.translated", {
    level: "info",
    callId,
    anthropicModel: translated.model,
    anthropicMessageCount: translated.messages.length,
    hasSystem: translated.system !== undefined,
    hasTools: Boolean(translated.tools?.length),
    maxTokens: translated.max_tokens,
  });

  const anthropicParams: Record<string, unknown> = {
    model: translated.model,
    max_tokens: translated.max_tokens,
    temperature: translated.temperature,
    messages: translated.messages,
  };
  if (translated.system !== undefined) {
    anthropicParams.system = translated.system;
  }
  if (translated.tools) {
    anthropicParams.tools = translated.tools;
  }

  const client = getAnthropicClient();
  const completionId = `chatcmpl-${cryptoRandomId()}`;

  if (translated.stream) {
    let stream;
    try {
      log("api", "voice.llm_proxy.stream_open", {
        level: "info",
        callId,
        completionId,
        model: translated.model,
      });
      stream = client.messages.stream(
        anthropicParams as unknown as Anthropic.MessageStreamParams,
      );
    } catch (err) {
      log("system", "voice.llm_proxy.stream_open_failed", {
        level: "error",
        callId,
        completionId,
        model: translated.model,
        message: err instanceof Error ? err.message : String(err),
      });
      return handleAnthropicError(err, completionId, translated.model, endSpan, callId);
    }

    const usage = emptyCapturedUsage();
    const sse = translateAnthropicToOpenAISSE(
      stream as unknown as AsyncIterable<AnthropicStreamEvent>,
      {
        completionId,
        model: translated.model,
        usage,
      },
    );

    const [forResponse, forObserver] = sse.tee();
    void observeStreamEnd(forObserver, () => {
      const durationMs = Date.now() - startMs;
      if (usage.captured) {
        void logAIUsage({
          engine: "claude",
          model: translated.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          callId: callId ?? undefined,
          sourceOp: "voice_llm_proxy",
          metadata: {
            cacheReadTokens: usage.cacheReadInputTokens,
            cacheCreationTokens: usage.cacheCreationInputTokens,
            voiceProviderSlug: VAPI_SLUG,
            durationMs,
          },
        });
      }
      logVoiceEvent({
        slug: VAPI_SLUG,
        operation: "voice_llm_proxy",
        durationMs,
        callId,
        metadata: {
          model: translated.model,
          usageCaptured: usage.captured,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadInputTokens,
          cacheCreationTokens: usage.cacheCreationInputTokens,
        },
      });
      log("api", "voice.llm_proxy.stream_done", {
        level: "info",
        callId,
        completionId,
        durationMs,
        model: translated.model,
        usageCaptured: usage.captured,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadInputTokens,
        cacheCreationTokens: usage.cacheCreationInputTokens,
      });
      endSpan({});
    });

    return new Response(forResponse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const message = await client.messages.create(
      anthropicParams as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );
    const durationMs = Date.now() - startMs;
    void logAIUsage({
      engine: "claude",
      model: translated.model,
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      callId: callId ?? undefined,
      sourceOp: "voice_llm_proxy",
      metadata: {
        cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: message.usage?.cache_creation_input_tokens ?? 0,
        voiceProviderSlug: VAPI_SLUG,
        durationMs,
      },
    });
    logVoiceEvent({
      slug: VAPI_SLUG,
      operation: "voice_llm_proxy",
      durationMs,
      callId,
      metadata: { model: translated.model, stream: false },
    });
    endSpan({});

    const text = message.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");
    return NextResponse.json({
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: translated.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: mapStopReason(message.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: message.usage?.input_tokens ?? 0,
        completion_tokens: message.usage?.output_tokens ?? 0,
        total_tokens:
          (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
      },
    });
  } catch (err) {
    return handleAnthropicError(err, completionId, translated.model, endSpan, callId);
  }
}

function handleAnthropicError(
  err: unknown,
  completionId: string,
  model: string,
  endSpan: (input: { errorMessage?: string }) => void,
  callId: string | null,
): Response {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;
  const errStatus = (err as { status?: number })?.status ?? null;
  console.error("[voice/llm-proxy] Anthropic upstream error:", msg);
  log("system", "voice.llm_proxy.anthropic_error", {
    level: "error",
    callId,
    completionId,
    model,
    upstreamStatus: errStatus,
    message: msg,
    stack,
  });
  endSpan({ errorMessage: msg });
  logVoiceEvent({
    slug: VAPI_SLUG,
    operation: "voice_llm_proxy",
    durationMs: 0,
    metadata: { model, errorPath: "anthropic_upstream", upstreamStatus: errStatus },
    errorMessage: msg,
  });
  return NextResponse.json(
    {
      id: completionId,
      error: {
        message: `Anthropic upstream error: ${msg}`,
        type: "upstream_error",
      },
    },
    { status: 500 },
  );
}

function mapStopReason(
  reason: Anthropic.Message["stop_reason"],
): "stop" | "length" | "tool_calls" {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "stop_sequence":
      return "stop";
    default:
      return "stop";
  }
}

async function observeStreamEnd(
  stream: ReadableStream<Uint8Array>,
  onEnd: () => void,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // Swallow — the response stream's own error path is what matters.
  } finally {
    onEnd();
    reader.releaseLock();
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 14);
}
