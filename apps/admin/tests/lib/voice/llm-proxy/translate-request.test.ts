/**
 * Request translation unit tests (#1176 — Test 1).
 *
 * Covers OpenAI → Anthropic conversion incl. the load-bearing
 * `role: "tool"` → `tool_result` re-attachment rule (TL BLOCKER 2).
 */

import { describe, expect, it } from "vitest";

import {
  translateOpenAIRequestToAnthropic,
  type OpenAIChatCompletionRequest,
} from "@/lib/voice/llm-proxy/translate-request";

describe("translateOpenAIRequestToAnthropic", () => {
  it("extracts the system message into a top-level system field", () => {
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "Hi" },
      ],
    };
    const t = translateOpenAIRequestToAnthropic(req);
    expect(t.system).toBe("You are a tutor.");
    expect(t.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("applies cache_control when the system message is large enough (>=4096 chars)", () => {
    const big = "x".repeat(5000);
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "system", content: big },
        { role: "user", content: "Hi" },
      ],
    };
    const t = translateOpenAIRequestToAnthropic(req);
    expect(Array.isArray(t.system)).toBe(true);
    if (Array.isArray(t.system)) {
      expect(t.system[0].cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("re-attaches role:tool messages as tool_result content blocks on a user-role message after the assistant tool_use", () => {
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "What's 2+2?" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: { name: "calc", arguments: '{"expr":"2+2"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_abc",
          content: "4",
        },
        { role: "user", content: "Thanks" },
      ],
    };

    const t = translateOpenAIRequestToAnthropic(req);
    expect(t.messages).toHaveLength(4);

    // assistant.content becomes the tool_use content block
    const assistantMsg = t.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    if (Array.isArray(assistantMsg.content)) {
      expect(assistantMsg.content[0]).toEqual({
        type: "tool_use",
        id: "call_abc",
        name: "calc",
        input: { expr: "2+2" },
      });
    }

    // The tool message becomes a user-role message with a tool_result block
    const toolResultMsg = t.messages[2];
    expect(toolResultMsg.role).toBe("user");
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
    if (Array.isArray(toolResultMsg.content)) {
      expect(toolResultMsg.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_abc",
        content: "4",
      });
    }
  });

  it("fans-in multiple tool results into a single user message (matches Anthropic shape)", () => {
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "do x and y" },
        {
          role: "assistant",
          tool_calls: [
            { id: "x_1", type: "function", function: { name: "x", arguments: "{}" } },
            { id: "y_1", type: "function", function: { name: "y", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "x_1", content: "X done" },
        { role: "tool", tool_call_id: "y_1", content: "Y done" },
      ],
    };
    const t = translateOpenAIRequestToAnthropic(req);
    // Three Anthropic messages: user, assistant(2 tool_use), user(2 tool_result)
    expect(t.messages).toHaveLength(3);
    const lastMsg = t.messages[2];
    expect(lastMsg.role).toBe("user");
    if (Array.isArray(lastMsg.content)) {
      expect(lastMsg.content).toHaveLength(2);
      expect(lastMsg.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "x_1",
        content: "X done",
      });
      expect(lastMsg.content[1]).toEqual({
        type: "tool_result",
        tool_use_id: "y_1",
        content: "Y done",
      });
    }
  });

  it("translates OpenAI tool definitions to Anthropic input_schema shape", () => {
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
    };
    const t = translateOpenAIRequestToAnthropic(req);
    expect(t.tools).toEqual([
      {
        name: "get_weather",
        description: "Weather for a city",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ]);
  });

  it("throws when a role:'tool' message has no tool_call_id", () => {
    const req: OpenAIChatCompletionRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", content: "x" },
      ],
    };
    expect(() => translateOpenAIRequestToAnthropic(req)).toThrow(
      /tool_call_id/,
    );
  });

  it("defaults max_tokens to 1024 and temperature to 1.0 when omitted", () => {
    const t = translateOpenAIRequestToAnthropic({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(t.max_tokens).toBe(1024);
    expect(t.temperature).toBe(1.0);
  });
});
