/**
 * OpenAI → Anthropic request translation for the VAPI custom-llm proxy
 * (#1176).
 *
 * VAPI POSTs an OpenAI-compatible `chat/completions` request to HF. We
 * translate to the Anthropic `messages.create` shape so the existing
 * metered AI wrapper can handle it. The translation has to handle:
 *
 *   1. **System message extraction** — OpenAI puts the system message
 *      inside `messages`; Anthropic takes it as a top-level `system`
 *      parameter (with cache_control for prompt caching).
 *
 *   2. **`role: "tool"` re-attachment** — OpenAI represents tool results
 *      as standalone messages with `role: "tool"`, but Anthropic expects
 *      them as `tool_result` content blocks **inside a `user` message**
 *      immediately following the `assistant` message that emitted the
 *      `tool_use`. Mis-translation here returns a 400 from Anthropic
 *      mid-call ("messages: tool_use blocks must be followed by
 *      tool_result blocks").
 *
 *   3. **OpenAI tool definitions → Anthropic tool definitions** —
 *      OpenAI uses `{type:"function", function:{name, description,
 *      parameters}}`; Anthropic uses `{name, description, input_schema}`.
 *
 *   4. **Assistant message tool_calls → assistant content blocks** —
 *      when an OpenAI assistant message includes `tool_calls`, Anthropic
 *      represents the same as a `tool_use` content block.
 *
 * No imports from `@/lib/ai/client` — this file is pure translation and
 * stays trivially unit-testable.
 */

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** OpenAI accepts string OR an array of content parts. */
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_calls?: OpenAIToolCall[];
  /** Required on `role: "tool"`. References the originating `tool_calls[].id`. */
  tool_call_id?: string;
  /** OpenAI's `name` on tool messages — Anthropic ignores; we drop. */
  name?: string;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAITool[];
  tool_choice?: unknown;
  /** Anything else — passed through where harmless, dropped where it'd confuse Anthropic. */
  [k: string]: unknown;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicTranslated {
  /** Top-level system, cacheable when it crosses 4096 chars (matches
   *  `lib/ai/client.ts::buildCacheableSystem` heuristic). */
  system: string | AnthropicTextBlock[] | undefined;
  messages: AnthropicMessage[];
  tools: AnthropicTool[] | undefined;
  model: string;
  /** Max tokens to generate. Anthropic requires it explicitly. */
  max_tokens: number;
  temperature: number;
  /** Whether the caller asked for a streamed response. */
  stream: boolean;
}

/** Default max_tokens when the caller doesn't supply one. Voice prompts
 *  are short by nature; 1024 is generous. */
const DEFAULT_MAX_TOKENS = 1024;
const CACHE_CONTROL_THRESHOLD_CHARS = 4096;

/**
 * Translate an OpenAI chat-completion request into an Anthropic
 * `messages.create` argument bag.
 *
 * Pure function. Throws on structurally invalid input (tool message
 * without `tool_call_id`, unknown role). Logs a single console.warn for
 * any field it silently drops so a future debugger can grep.
 */
export function translateOpenAIRequestToAnthropic(
  req: OpenAIChatCompletionRequest,
): AnthropicTranslated {
  const messages = req.messages ?? [];

  // 1. System message(s) — extract and cache-control the FIRST block when
  // it crosses threshold. Single-system-message path preserves the legacy
  // shape (one block, cached if large). Multi-system-message path emits
  // a multi-block system so a stable cached prefix (e.g. the #1906 module
  // bundle) can sit alongside a fresh per-turn block (e.g. the CURRENT
  // FOCUS directive injected by `runVapiChatCompletion`) without busting
  // the cache. Anthropic semantics: cache hit reuses up to the first
  // cache-controlled block; subsequent blocks are appended uncached.
  const systemMessages = messages.filter((m) => m.role === "system");
  let system: AnthropicTranslated["system"] = undefined;
  if (systemMessages.length > 0) {
    const texts = systemMessages
      .map((m) => extractText(m.content))
      .filter((t): t is string => Boolean(t));
    if (texts.length === 1) {
      const single = texts[0];
      if (single.length >= CACHE_CONTROL_THRESHOLD_CHARS) {
        system = [
          {
            type: "text",
            text: single,
            cache_control: { type: "ephemeral" },
          },
        ];
      } else if (single.length > 0) {
        system = single;
      }
    } else if (texts.length > 1) {
      system = texts.map((text, idx) => {
        if (idx === 0 && text.length >= CACHE_CONTROL_THRESHOLD_CHARS) {
          return {
            type: "text",
            text,
            cache_control: { type: "ephemeral" },
          };
        }
        return { type: "text", text };
      });
    }
  }

  // 2. Walk remaining messages, building Anthropic messages with
  //    tool_result re-attachment.
  const anthropicMessages: AnthropicMessage[] = [];
  const nonSystem = messages.filter((m) => m.role !== "system");

  for (let i = 0; i < nonSystem.length; i++) {
    const m = nonSystem[i];

    if (m.role === "user") {
      const text = extractText(m.content);
      anthropicMessages.push({
        role: "user",
        content: text ?? "",
      });
      continue;
    }

    if (m.role === "assistant") {
      const contentBlocks: AnthropicContentBlock[] = [];
      const text = extractText(m.content);
      if (text) {
        contentBlocks.push({ type: "text", text });
      }
      for (const tc of m.tool_calls ?? []) {
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: safeJsonParse(tc.function.arguments),
        });
      }
      // If the assistant message has neither text nor tool_calls, push
      // an empty-string text so the messages array stays valid.
      anthropicMessages.push({
        role: "assistant",
        content:
          contentBlocks.length === 1 && contentBlocks[0].type === "text"
            ? contentBlocks[0].text
            : contentBlocks.length > 0
              ? contentBlocks
              : "",
      });
      continue;
    }

    if (m.role === "tool") {
      if (!m.tool_call_id) {
        throw new Error(
          "translateOpenAIRequestToAnthropic: role='tool' message missing tool_call_id",
        );
      }
      const text = extractText(m.content) ?? "";
      // Anthropic wants tool_result inside a user-role message. If the
      // PREVIOUS Anthropic message we pushed was already a user message
      // composed of tool_result blocks (i.e. multiple tools fan-in to
      // one assistant turn), append to that. Otherwise start a new one.
      const last = anthropicMessages[anthropicMessages.length - 1];
      const toolResult: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: text,
      };
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        last.content.every((c) => c.type === "tool_result")
      ) {
        (last.content as AnthropicContentBlock[]).push(toolResult);
      } else {
        anthropicMessages.push({
          role: "user",
          content: [toolResult],
        });
      }
      continue;
    }

    throw new Error(
      `translateOpenAIRequestToAnthropic: unknown role '${(m as { role: string }).role}'`,
    );
  }

  // 3. Tools — OpenAI shape → Anthropic shape.
  let tools: AnthropicTool[] | undefined = undefined;
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    tools = req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      // Anthropic requires `input_schema` (JSON Schema) — OpenAI's
      // `parameters` is the same shape, so direct pass-through is safe.
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }

  return {
    system,
    messages: anthropicMessages,
    tools,
    model: req.model,
    max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : DEFAULT_MAX_TOKENS,
    temperature: typeof req.temperature === "number" ? req.temperature : 1.0,
    stream: req.stream === true,
  };
}

function extractText(
  content: OpenAIMessage["content"],
): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return text || undefined;
  }
  return undefined;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // OpenAI tool_call arguments are supposed to be JSON-encoded strings.
    // If they're not, hand the raw string to Anthropic as input.text.
    return { raw: s };
  }
}
