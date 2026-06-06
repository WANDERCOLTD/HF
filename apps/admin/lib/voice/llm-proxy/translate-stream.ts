/**
 * Anthropic SDK stream → OpenAI SSE chat-completion stream (#1176).
 *
 * VAPI's custom-llm provider expects an OpenAI-format SSE response —
 * `data: {choices:[{delta:{...}}]}\n\n` chunks ending in `data: [DONE]`.
 * The Anthropic SDK emits a different event model that we need to
 * translate event-by-event.
 *
 * Translation table:
 *
 *   Anthropic event             → OpenAI delta chunk
 *   ─────────────────────────────────────────────────────────────────────
 *   message_start                first chunk with empty delta + role
 *   content_block_start (text)   (no-op — text_delta carries it)
 *   content_block_start (tool)   tool_calls[i].{id, type, function.name}
 *                                with empty arguments string
 *   content_block_delta (text_delta)         delta.content = chunk text
 *   content_block_delta (input_json_delta)   delta.tool_calls[i].function
 *                                            .arguments = partial JSON
 *   content_block_stop           (no-op — accumulated index closes)
 *   message_delta                **capture usage** (input/output/
 *                                cache_read/cache_creation tokens) —
 *                                emitted alongside [DONE] for the
 *                                caller's logging hook
 *   message_stop                 `data: [DONE]\n\n`
 *
 * The streaming `usage` event from `message_delta` is captured into a
 * shared object the caller can read AFTER the stream completes — that's
 * the load-bearing token-accounting fix (#1176 BLOCKER 1). Character-
 * count estimation is materially wrong for prompt-cached calls because
 * `cache_read_input_tokens` are billed at 0.1×.
 *
 * Pure function. Caller wires up the underlying Anthropic stream and
 * provides a buffer for the captured usage.
 */

export interface CapturedAnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Set to true once message_delta has been observed. If false at
   *  stream-end, fall back to character-count estimation (lossy but
   *  better than 0). */
  captured: boolean;
}

/**
 * Anthropic SDK event shape (loose typing — we read only the discriminator
 * + the few fields we map).
 */
export interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    /** message_delta carries usage in `usage`, NOT inside `delta`. */
    stop_reason?: string;
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  /** `message_delta` event uses this shape. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** `message_start` carries the initial usage in `message.usage`. */
  message?: {
    id?: string;
    role?: string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export interface TranslateOptions {
  /** Used as the OpenAI `id` field on every chunk. */
  completionId: string;
  /** Returned model name in the SSE chunks. */
  model: string;
  /** Mutable usage accumulator — caller reads this after stream ends. */
  usage: CapturedAnthropicUsage;
}

const SSE_DONE = "data: [DONE]\n\n";

/**
 * Wrap an Anthropic SDK async iterator into a ReadableStream of
 * UTF-8-encoded OpenAI SSE bytes.
 */
export function translateAnthropicToOpenAISSE(
  anthropicEvents: AsyncIterable<AnthropicStreamEvent>,
  opts: TranslateOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);

  // Per-tool-call accumulator. Anthropic indexes content blocks; we
  // mirror that on the OpenAI side so each tool_call chunk has a
  // matching `index`.
  const toolCalls = new Map<
    number,
    { id: string; name: string; argsAccum: string }
  >();

  return new ReadableStream({
    async start(controller) {
      try {
        // Emit the standard OpenAI first chunk — empty delta with role.
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: opts.completionId,
              created,
              model: opts.model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null,
                },
              ],
            }),
          ),
        );

        for await (const event of anthropicEvents) {
          if (event.type === "message_start") {
            // Anthropic gives initial input_token count here; output is
            // 0 until generation completes.
            const u = event.message?.usage;
            if (u) {
              opts.usage.inputTokens = u.input_tokens ?? 0;
              opts.usage.cacheCreationInputTokens =
                u.cache_creation_input_tokens ?? 0;
              opts.usage.cacheReadInputTokens =
                u.cache_read_input_tokens ?? 0;
            }
            continue;
          }

          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block?.type === "tool_use" && typeof event.index === "number") {
              toolCalls.set(event.index, {
                id: block.id ?? `tool_${event.index}`,
                name: block.name ?? "",
                argsAccum: "",
              });
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: opts.completionId,
                    created,
                    model: opts.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: event.index,
                              id: block.id ?? `tool_${event.index}`,
                              type: "function",
                              function: {
                                name: block.name ?? "",
                                arguments: "",
                              },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  }),
                ),
              );
            }
            // text content_block_start is a no-op — text_delta carries.
            continue;
          }

          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta" && event.delta.text) {
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: opts.completionId,
                    created,
                    model: opts.model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: event.delta.text },
                        finish_reason: null,
                      },
                    ],
                  }),
                ),
              );
              continue;
            }
            if (
              event.delta?.type === "input_json_delta" &&
              typeof event.delta.partial_json === "string" &&
              typeof event.index === "number"
            ) {
              const accum = toolCalls.get(event.index);
              if (accum) {
                accum.argsAccum += event.delta.partial_json;
              }
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: opts.completionId,
                    created,
                    model: opts.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: event.index,
                              function: {
                                arguments: event.delta.partial_json,
                              },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  }),
                ),
              );
              continue;
            }
            continue;
          }

          if (event.type === "content_block_stop") {
            // No emission — OpenAI doesn't separate block boundaries.
            continue;
          }

          if (event.type === "message_delta") {
            // BLOCKER 1 — real token capture. Replaces char-count est.
            if (event.usage) {
              opts.usage.outputTokens = event.usage.output_tokens ?? 0;
              // input_tokens on message_delta is the FINAL total (some
              // SDK versions repeat; latest puts it only on message_start).
              if (typeof event.usage.input_tokens === "number") {
                opts.usage.inputTokens = event.usage.input_tokens;
              }
              if (typeof event.usage.cache_creation_input_tokens === "number") {
                opts.usage.cacheCreationInputTokens =
                  event.usage.cache_creation_input_tokens;
              }
              if (typeof event.usage.cache_read_input_tokens === "number") {
                opts.usage.cacheReadInputTokens =
                  event.usage.cache_read_input_tokens;
              }
              opts.usage.captured = true;
            }
            // Emit the finish_reason chunk if stop_reason is present.
            const finishReason = mapAnthropicStopReason(event.delta?.stop_reason);
            if (finishReason) {
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: opts.completionId,
                    created,
                    model: opts.model,
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: finishReason,
                      },
                    ],
                  }),
                ),
              );
            }
            continue;
          }

          if (event.type === "message_stop") {
            // Trail [DONE] after the loop completes naturally.
            continue;
          }
        }

        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
      } catch (err) {
        // Emit an OpenAI-format error chunk + [DONE] so the caller's SSE
        // parser doesn't hang. Re-throw so the route handler logs via
        // logVoiceEvent.
        const msg = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: opts.completionId,
                created,
                model: opts.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "error",
                  },
                ],
                error: { message: msg, type: "anthropic_stream_error" },
              }),
            ),
          );
          controller.enqueue(encoder.encode(SSE_DONE));
        } finally {
          controller.error(err);
        }
      }
    },
  });
}

function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    object: "chat.completion.chunk",
    ...payload,
  })}\n\n`;
}

function mapAnthropicStopReason(
  reason: string | undefined,
): "stop" | "length" | "tool_calls" | null {
  if (!reason) return null;
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

export function emptyCapturedUsage(): CapturedAnthropicUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    captured: false,
  };
}
