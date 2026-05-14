/**
 * AI Client Module
 *
 * Provides a unified interface for calling different AI engines (Claude, OpenAI, Mock).
 * The engine selection is passed from the frontend via request headers or body.
 *
 * Supports runtime configuration via AIConfig table - use `callPoint` to load
 * provider/model settings from the database.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "@/lib/config";
import { classifyAIError, userMessageForError } from "./error-utils";

export type AIEngine = "mock" | "claude" | "openai";

// Content block types for tool calling (Anthropic SDK format)
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AITool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AIToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface AICompletionOptions {
  engine: AIEngine;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Optional: specific model to use (overrides engine default) */
  model?: string;
  /** Optional: call point for loading config from database */
  callPoint?: string;
  /** Optional: tool definitions for function calling */
  tools?: AITool[];
  /** Optional: timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable extended thinking. Budget 1024–16000 tokens. Forces temperature=1. */
  thinkingBudgetTokens?: number;
}

export interface AICompletionResult {
  content: string;
  engine: AIEngine;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** Tokens read from Anthropic prompt cache (charged at 0.1x) */
    cacheReadTokens?: number;
    /** Tokens written to Anthropic prompt cache (charged at 1.25x, one-time) */
    cacheCreationTokens?: number;
  };
  /** Why the model stopped generating */
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  /** Tool calls requested by the model */
  toolUses?: AIToolUse[];
  /** Raw content blocks from the response (for feeding back into tool loop) */
  rawContentBlocks?: ContentBlock[];
  /** Concatenated thinking text when extended thinking was enabled */
  thinkingContent?: string;
}

/** Extract string content from an AIMessage (handles both string and content block formats) */
export function getTextContent(msg: AIMessage): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Lazy-initialized clients
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    // Prefer OPENAI_HF_MVP_KEY, fall back to OPENAI_API_KEY
    const apiKey = process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_HF_MVP_KEY or OPENAI_API_KEY not configured");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Get AI completion from the specified engine
 */
export async function getAICompletion(options: AICompletionOptions): Promise<AICompletionResult> {
  const { engine, messages, maxTokens = config.ai.defaults.maxTokens, temperature = config.ai.defaults.temperature, model, tools, timeoutMs = 30000, thinkingBudgetTokens } = options;

  switch (engine) {
    case "claude":
      return callClaude(messages, maxTokens, temperature, model, tools, timeoutMs, thinkingBudgetTokens);

    case "openai":
      return callOpenAI(messages, maxTokens, temperature, model, timeoutMs);

    case "mock":
    default:
      return mockCompletion(messages);
  }
}

/**
 * Build a cacheable system prompt for the Anthropic API.
 * Wraps system text in a content block with cache_control: ephemeral,
 * enabling Anthropic's prompt caching (90% input cost savings on cache hits).
 * Cache lives for 5 minutes — ideal for pipeline bursts after each call.
 *
 * Returns undefined if no system message provided.
 */
function buildCacheableSystem(
  systemMessage: AIMessage | undefined
): undefined | string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  if (!systemMessage) return undefined;

  const text = typeof systemMessage.content === "string"
    ? systemMessage.content
    : getTextContent(systemMessage);

  if (!text) return undefined;

  // Anthropic requires at least 1024 tokens (~4096 chars) for caching to activate.
  // Below that threshold, just send as plain string (no overhead).
  if (text.length < 4096) {
    return text;
  }

  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

async function callClaude(
  messages: AIMessage[],
  maxTokens: number,
  temperature: number,
  model?: string,
  tools?: AITool[],
  timeoutMs: number = 30000,
  thinkingBudgetTokens?: number,
): Promise<AICompletionResult> {
  const client = getAnthropicClient();

  // Separate system message from user/assistant messages
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as any, // Content blocks or string — Anthropic SDK accepts both
    }));

  // Use provided model or default from config
  const modelId = model || config.ai.claude.model;

  // Build system param with prompt caching.
  // Wraps the system prompt in a content block with cache_control so
  // Anthropic caches it across calls (90% input cost savings on cache hits).
  const systemParam = buildCacheableSystem(systemMessage);

  const createParams: any = {
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    system: systemParam,
    messages: chatMessages,
  };
  if (tools && tools.length > 0) {
    createParams.tools = tools;
  }
  if (thinkingBudgetTokens) {
    createParams.thinking = { type: "enabled", budget_tokens: thinkingBudgetTokens };
    createParams.temperature = 1; // Required when thinking is enabled
    // Anthropic requires max_tokens > budget_tokens. Ensure at least budget + 1000 for the response.
    const minTokens = thinkingBudgetTokens + 1000;
    if (createParams.max_tokens < minTokens) {
      createParams.max_tokens = minTokens;
    }
  }

  // Add timeout support with AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.messages.create(
      createParams,
      { signal: controller.signal },
    );

    // Extract text content
    const textBlocks = response.content.filter((c: any) => c.type === "text");
    const textContent = textBlocks.map((c: any) => c.text).join("\n");

    // Extract thinking blocks
    const thinkingBlocks = response.content.filter((c: any) => c.type === "thinking");
    const thinkingContent = thinkingBlocks.length > 0
      ? thinkingBlocks.map((c: any) => c.thinking).join("\n\n")
      : undefined;

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter((c: any) => c.type === "tool_use");
    const toolUses: AIToolUse[] = toolUseBlocks.map((c: any) => ({
      id: c.id,
      name: c.name,
      input: c.input,
    }));

    // Build raw content blocks for feeding back into tool loop.
    // Thinking blocks must be preserved so multi-turn tool loops pass them back correctly.
    const rawContentBlocks: ContentBlock[] = response.content.map((c: any) => {
      if (c.type === "text") return { type: "text" as const, text: c.text };
      if (c.type === "thinking") return { type: "thinking" as const, thinking: c.thinking, signature: c.signature };
      if (c.type === "tool_use") return { type: "tool_use" as const, id: c.id, name: c.name, input: c.input };
      return { type: "text" as const, text: "" };
    });

    return {
      content: textContent,
      engine: "claude",
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: (response.usage as any).cache_read_input_tokens || 0,
        cacheCreationTokens: (response.usage as any).cache_creation_input_tokens || 0,
      },
      stopReason: response.stop_reason as AICompletionResult["stopReason"],
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      rawContentBlocks: rawContentBlocks.length > 0 ? rawContentBlocks : undefined,
      thinkingContent,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`AI call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(
  messages: AIMessage[],
  maxTokens: number,
  temperature: number,
  model?: string,
  timeoutMs: number = 30000
): Promise<AICompletionResult> {
  const client = getOpenAIClient();

  // Use provided model or default from config
  const modelId = model || config.ai.openai.model;

  // Add timeout support with AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({
        role: m.role,
        content: getTextContent(m),
      })),
    },
    {
      signal: controller.signal,
    } as any);

    const choice = response.choices[0];

    return {
      content: choice?.message?.content || "",
      engine: "openai",
      model: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`AI call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mockCompletion(messages: AIMessage[]): AICompletionResult {
  // For mock mode, return a structured response based on the last message
  const lastMessage = messages[messages.length - 1];
  const content = lastMessage ? getTextContent(lastMessage) : "";

  const contentLower = content.toLowerCase();

  // Generate mock scores if the prompt seems to be asking for scoring
  if (contentLower.includes("score") || contentLower.includes("rate")) {
    return {
      content: JSON.stringify({
        score: 0.5 + Math.random() * 0.3,
        confidence: 0.7 + Math.random() * 0.2,
        reasoning: "Mock scoring based on pattern analysis",
      }),
      engine: "mock",
      model: "mock_v1",
    };
  }

  // Generate mock memories if the prompt seems to be asking for extraction
  if (contentLower.includes("extract") || contentLower.includes("memory")) {
    return {
      content: JSON.stringify({
        memories: [
          { category: "CONTEXT", key: "interaction_type", value: "general", confidence: 0.8 },
        ],
      }),
      engine: "mock",
      model: "mock_v1",
    };
  }

  // Generate mock prompt if this is a compose/generation request
  if (contentLower.includes("compose") || contentLower.includes("generate") || contentLower.includes("agent guidance")) {
    return {
      content: `# Agent Guidance Prompt (MOCK)

## Identity & Role
You are a helpful, knowledgeable assistant focused on providing clear, accurate information and support.

## Conversation Context
This is a mock-generated prompt. In production, this would be customized based on:
- Caller's personality profile and preferences
- Conversation history and memories
- Learning progress and goals
- Behavioral targets for tone and style

## Behavioral Guidelines
- Be warm, approachable, and empathetic
- Match the caller's pace and communication style
- Ask thoughtful questions to encourage engagement
- Provide clear explanations tailored to their level

## Current Session Goals
- Build rapport and understand caller's needs
- Provide helpful, relevant information
- Encourage continued learning and exploration

---
*This is a MOCK prompt. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY for real AI-generated prompts.*`,
      engine: "mock",
      model: "mock_v1",
    };
  }

  // Default mock response
  return {
    content: JSON.stringify({ result: "mock_response", timestamp: new Date().toISOString() }),
    engine: "mock",
    model: "mock_v1",
  };
}

/**
 * Check if an engine is available (API key configured)
 */
export function isEngineAvailable(engine: AIEngine): boolean {
  switch (engine) {
    case "mock":
      return true;
    case "claude":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!(process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY);
    default:
      return false;
  }
}

/**
 * Get the default engine (first available)
 */
export function getDefaultEngine(): AIEngine {
  if (isEngineAvailable("claude")) return "claude";
  if (isEngineAvailable("openai")) return "openai";
  return "mock";
}

// ============================================================
// STREAMING SUPPORT
// ============================================================

export interface AIStreamOptions {
  engine: AIEngine;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Optional: specific model to use (overrides engine default) */
  model?: string;
  /** Optional: call point for loading config from database */
  callPoint?: string;
  /** Optional: timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Get AI completion as a streaming response
 * Returns a ReadableStream that can be directly returned from API routes
 */
export async function getAICompletionStream(
  options: AIStreamOptions
): Promise<ReadableStream<Uint8Array>> {
  const { engine, messages, maxTokens = config.ai.defaults.maxTokens, temperature = config.ai.defaults.temperature, model, timeoutMs = 30000 } = options;

  switch (engine) {
    case "claude":
      return streamClaude(messages, maxTokens, temperature, model, timeoutMs);
    case "openai":
      return streamOpenAI(messages, maxTokens, temperature, model, timeoutMs);
    case "mock":
    default:
      return mockStream(messages);
  }
}

async function streamClaude(
  messages: AIMessage[],
  maxTokens: number,
  temperature: number,
  model?: string,
  timeoutMs: number = 30000
): Promise<ReadableStream<Uint8Array>> {
  const client = getAnthropicClient();

  // Separate system message from user/assistant messages
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as any, // String or content blocks
    }));

  // Use provided model or default from config
  const modelId = model || config.ai.claude.model;

  // Build system param with prompt caching (same as non-streaming)
  const systemParam = buildCacheableSystem(systemMessage);

  const stream = client.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    system: systemParam,
    messages: chatMessages,
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const streamController = new AbortController();
      const timer = setTimeout(() => streamController.abort(), timeoutMs);

      try {
        for await (const event of stream) {
          if (streamController.signal.aborted) {
            throw new Error(`AI stream timed out after ${timeoutMs}ms`);
          }
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (error) {
        // Classify the error and send user-friendly message to stream
        const errorCode = classifyAIError(error);
        const userMessage = userMessageForError(errorCode);
        console.error(`[streamClaude] Stream error: ${errorCode}`, error);

        try {
          // Send error message as a JSON event
          const errorEvent = JSON.stringify({ error: userMessage, errorCode });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        } catch {
          // Ignore encoding errors
        }

        controller.close();
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

async function streamOpenAI(
  messages: AIMessage[],
  maxTokens: number,
  temperature: number,
  model?: string,
  timeoutMs: number = 30000
): Promise<ReadableStream<Uint8Array>> {
  const client = getOpenAIClient();

  // Use provided model or default from config
  const modelId = model || config.ai.openai.model;

  const stream = await client.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: getTextContent(m),
    })),
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const streamController = new AbortController();
      const timer = setTimeout(() => streamController.abort(), timeoutMs);

      try {
        for await (const chunk of stream) {
          if (streamController.signal.aborted) {
            throw new Error(`AI stream timed out after ${timeoutMs}ms`);
          }
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(content));
          }
        }
        controller.close();
      } catch (error) {
        // Classify the error and send user-friendly message to stream
        const errorCode = classifyAIError(error);
        const userMessage = userMessageForError(errorCode);
        console.error(`[streamOpenAI] Stream error: ${errorCode}`, error);

        try {
          // Send error message as a JSON event
          const errorEvent = JSON.stringify({ error: userMessage, errorCode });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        } catch {
          // Ignore encoding errors
        }

        controller.close();
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

function mockStream(messages: AIMessage[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lastMessage = messages[messages.length - 1];
  const lastContent = lastMessage ? getTextContent(lastMessage) : "";
  const lastLower = lastContent.toLowerCase();

  // Generate a mock response based on the message
  let response = "This is a mock response. ";
  if (lastLower.includes("help")) {
    response = "Available commands:\n• /help - Show this help\n• /context - Show current context\n• /clear - Clear chat history\n• /memories - Show caller memories\n• /buildprompt - Build composed prompt";
  } else if (lastLower.includes("hello") || lastLower.includes("hi")) {
    response = "Hello! I'm your AI assistant. How can I help you today?";
  } else {
    response = `I received your message: "${lastContent.slice(0, 50)}..."\n\nThis is a mock response since no AI engine is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable real responses.`;
  }

  const words = response.split(" ");
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      if (index < words.length) {
        const word = words[index] + (index < words.length - 1 ? " " : "");
        controller.enqueue(encoder.encode(word));
        index++;
        // Simulate streaming delay
        await new Promise((resolve) => setTimeout(resolve, 50));
      } else {
        controller.close();
      }
    },
  });
}

// ============================================================
// CONFIG-AWARE COMPLETIONS
// ============================================================

import { getAIConfig } from "./config-loader";

export interface ConfiguredAIOptions {
  callPoint: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Override the configured engine (for testing) */
  engineOverride?: AIEngine;
  /** Optional: tool definitions for function calling */
  tools?: AITool[];
  /** Optional: timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable extended thinking. Budget 1024–16000 tokens. Forces temperature=1. */
  thinkingBudgetTokens?: number;
  /** Optional: number of retries for transient errors (default: 2) */
  maxRetries?: number;
}

/**
 * Get AI completion using configuration from the database.
 * This is the preferred method for production code.
 *
 * @ai-call {options.callPoint} — Generic config-aware wrapper | config: /x/ai-config
 * @param options - Includes callPoint to load config for
 * @returns Completion result with model info
 */
export async function getConfiguredAICompletion(
  options: ConfiguredAIOptions
): Promise<AICompletionResult> {
  const { callPoint, messages, maxTokens, temperature, engineOverride, tools, timeoutMs, thinkingBudgetTokens } = options;

  // Load config from database
  const aiConfig = await getAIConfig(callPoint);

  // Use override if provided, otherwise use config.
  // When the engine is overridden to a different provider, the configured model
  // (e.g. "claude-sonnet-4-5-20250929") won't work on the other provider (e.g. OpenAI).
  // Fall back to the default model for the overridden engine.
  const engine = engineOverride ?? aiConfig.provider;
  const modelProviderMismatch = engineOverride && engineOverride !== aiConfig.provider;
  const model = modelProviderMismatch
    ? (engine === "claude" ? config.ai.claude.model : engine === "openai" ? config.ai.openai.model : aiConfig.model)
    : aiConfig.model;

  // Merge: explicit options > DB config > app config defaults
  const finalMaxTokens = maxTokens ?? aiConfig.maxTokens ?? config.ai.defaults.maxTokens;
  const finalTemperature = temperature ?? aiConfig.temperature ?? config.ai.defaults.temperature;
  // Timeout cascade: caller option > DB/call-point config > 30s default
  const finalTimeoutMs = timeoutMs ?? aiConfig.timeoutMs ?? 30_000;

  return getAICompletion({
    engine,
    messages,
    maxTokens: finalMaxTokens,
    temperature: finalTemperature,
    model,
    tools,
    timeoutMs: finalTimeoutMs,
    thinkingBudgetTokens,
  });
}

/**
 * Get AI completion stream using configuration from the database.
 *
 * @ai-call {options.callPoint} — Generic config-aware stream wrapper | config: /x/ai-config
 * @param options - Includes callPoint to load config for
 * @returns Streaming response
 */
export async function getConfiguredAICompletionStream(
  options: ConfiguredAIOptions
): Promise<ReadableStream<Uint8Array>> {
  const { callPoint, messages, maxTokens, temperature, engineOverride, timeoutMs } = options;

  // Load config from database
  const aiConfig = await getAIConfig(callPoint);

  // Use override if provided, otherwise use config.
  // When the engine is overridden to a different provider, the configured model
  // (e.g. "claude-sonnet-4-5-20250929") won't work on the other provider (e.g. OpenAI).
  // Fall back to the default model for the overridden engine.
  const engine = engineOverride ?? aiConfig.provider;
  const modelProviderMismatch = engineOverride && engineOverride !== aiConfig.provider;
  const model = modelProviderMismatch
    ? (engine === "claude" ? config.ai.claude.model : engine === "openai" ? config.ai.openai.model : aiConfig.model)
    : aiConfig.model;

  // Merge: explicit options > DB config > app config defaults
  const finalMaxTokens = maxTokens ?? aiConfig.maxTokens ?? config.ai.defaults.maxTokens;
  const finalTemperature = temperature ?? aiConfig.temperature ?? config.ai.defaults.temperature;
  const finalTimeoutMs = timeoutMs ?? aiConfig.timeoutMs ?? 30_000;

  return getAICompletionStream({
    engine,
    messages,
    maxTokens: finalMaxTokens,
    temperature: finalTemperature,
    model,
    timeoutMs: finalTimeoutMs,
  });
}
