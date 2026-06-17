/**
 * Stream translation unit tests (#1176 — Tests 2 + 3).
 *
 * Covers Anthropic SDK events → OpenAI SSE chunks. Specifically:
 *   - text_delta → delta.content
 *   - input_json_delta → delta.tool_calls[i].function.arguments
 *   - message_delta usage capture (BLOCKER 1 — real token counts)
 */

import { describe, expect, it } from "vitest";

import {
  emptyCapturedUsage,
  translateAnthropicToOpenAISSE,
  type AnthropicStreamEvent,
} from "@/lib/voice/llm-proxy/translate-stream";

async function asyncIterable<T>(items: T[]): Promise<AsyncIterable<T>> {
   
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("translateAnthropicToOpenAISSE", () => {
  it("emits the standard first chunk (empty delta with role:assistant) before any content", async () => {
    const events = await asyncIterable<AnthropicStreamEvent>([
      { type: "message_stop" },
    ]);
    const usage = emptyCapturedUsage();
    const stream = translateAnthropicToOpenAISSE(events, {
      completionId: "test_1",
      model: "claude-3-5-sonnet",
      usage,
    });
    const sse = await collectSse(stream);
    expect(sse).toMatch(/"delta":\{"role":"assistant"\}/);
    expect(sse.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("translates content_block_delta text_delta events into OpenAI delta.content chunks", async () => {
    const events = await asyncIterable<AnthropicStreamEvent>([
      { type: "message_start", message: { id: "m1", role: "assistant" } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2, input_tokens: 10 } },
      { type: "message_stop" },
    ]);
    const usage = emptyCapturedUsage();
    const stream = translateAnthropicToOpenAISSE(events, {
      completionId: "test_2",
      model: "claude-3-5-sonnet",
      usage,
    });
    const sse = await collectSse(stream);
    expect(sse).toContain('"content":"Hel"');
    expect(sse).toContain('"content":"lo"');
    expect(sse.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("translates input_json_delta events into OpenAI tool_calls function.arguments chunks (TL flag)", async () => {
    const events = await asyncIterable<AnthropicStreamEvent>([
      { type: "message_start", message: { id: "m1", role: "assistant" } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_abc", name: "calc" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"exp' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'r":"2+2"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const usage = emptyCapturedUsage();
    const stream = translateAnthropicToOpenAISSE(events, {
      completionId: "test_3",
      model: "claude-3-5-sonnet",
      usage,
    });
    const sse = await collectSse(stream);
    // The tool_call start chunk has id + name with empty arguments
    expect(sse).toMatch(/"tool_calls":\[\{"index":0,"id":"call_abc","type":"function","function":\{"name":"calc","arguments":""\}\}\]/);
    // Then the argument chunks stream the partial_json verbatim
    expect(sse).toContain('"arguments":"{\\"exp"');
    expect(sse).toContain('"arguments":"r\\":\\"2+2\\"}"');
    // finish_reason: tool_calls
    expect(sse).toContain('"finish_reason":"tool_calls"');
  });

  it("CAPTURES real token counts from message_delta usage (BLOCKER 1)", async () => {
    const events = await asyncIterable<AnthropicStreamEvent>([
      {
        type: "message_start",
        message: {
          id: "m1",
          role: "assistant",
          usage: {
            input_tokens: 1234,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 0,
          },
        },
      },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: 1234,
          output_tokens: 42,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 0,
        },
      },
      { type: "message_stop" },
    ]);
    const usage = emptyCapturedUsage();
    const stream = translateAnthropicToOpenAISSE(events, {
      completionId: "test_4",
      model: "claude-3-5-sonnet",
      usage,
    });
    await collectSse(stream);
    expect(usage.captured).toBe(true);
    expect(usage.inputTokens).toBe(1234);
    expect(usage.outputTokens).toBe(42);
    expect(usage.cacheReadInputTokens).toBe(1000);
  });

  it("leaves captured=false when message_delta arrives without usage (char-count fallback path)", async () => {
    const events = await asyncIterable<AnthropicStreamEvent>([
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "X" } },
      { type: "message_stop" },
    ]);
    const usage = emptyCapturedUsage();
    const stream = translateAnthropicToOpenAISSE(events, {
      completionId: "test_5",
      model: "claude-3-5-sonnet",
      usage,
    });
    await collectSse(stream);
    expect(usage.captured).toBe(false);
  });
});
