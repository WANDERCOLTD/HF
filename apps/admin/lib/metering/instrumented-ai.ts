/**
 * Instrumented AI Client
 *
 * Wraps the AI client functions to add automatic usage metering.
 * Use these functions instead of the raw AI client to track costs.
 */

import { config } from "@/lib/config";
import {
  getAICompletion,
  getAICompletionStream,
  getConfiguredAICompletion,
  getConfiguredAICompletionStream,
  getTextContent,
  AICompletionOptions,
  AICompletionResult,
  AIStreamOptions,
  AIEngine,
  ConfiguredAIOptions,
} from "@/lib/ai/client";
import { logAIUsage } from "./usage-logger";
import { classifyAIError, isRetryable } from "@/lib/ai/error-utils";
import { isDeepLoggingEnabled } from "@/lib/deep-logging";
import { logAI } from "@/lib/logger";

export interface MeteringContext {
  userId?: string;
  callerId?: string;
  callId?: string;
  sourceOp?: string;
  // ── Rich context (optional, for LogViewer display) ──
  userName?: string;
  entityLabel?: string;
  wizardName?: string;
  wizardStep?: string;
}

/**
 * Get AI completion with automatic usage metering.
 *
 * This wraps getAICompletion and logs token usage to the metering system.
 */
export async function getMeteredAICompletion(
  options: AICompletionOptions,
  context?: MeteringContext
): Promise<AICompletionResult> {
  const result = await getAICompletion(options);

  // Log usage if we have token counts (mock doesn't provide these)
  if (result.usage && result.engine !== "mock") {
    // Fire and forget - don't block the response
    logAIUsage({
      engine: result.engine as "claude" | "openai",
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      userId: context?.userId,
      callerId: context?.callerId,
      callId: context?.callId,
      sourceOp: context?.sourceOp,
      metadata: result.usage.cacheReadTokens || result.usage.cacheCreationTokens
        ? {
            cacheReadTokens: result.usage.cacheReadTokens,
            cacheCreationTokens: result.usage.cacheCreationTokens,
          }
        : undefined,
    }).catch((error) => {
      console.error("[metering] Failed to log AI usage:", error);
    });
  }

  return result;
}

/**
 * Streaming completion with usage estimation.
 *
 * Note: Streaming responses don't provide token counts from the API.
 * We estimate based on character count (rough: ~4 chars per token).
 *
 * For accurate metering of streaming calls, consider:
 * 1. Using non-streaming for operations where you need exact counts
 * 2. Accepting the estimation for chat-style interactions
 */
export async function getMeteredAICompletionStream(
  options: AIStreamOptions,
  context?: MeteringContext
): Promise<{ stream: ReadableStream<Uint8Array>; logUsage: (outputChars: number) => void }> {
  const stream = await getAICompletionStream(options);

  // Estimate input tokens from message content
  const inputChars = options.messages.reduce((sum, m) => sum + getTextContent(m).length, 0);
  const estimatedInputTokens = Math.ceil(inputChars / 4);

  // Return stream with a callback to log output when streaming completes
  const logUsage = (outputChars: number) => {
    if (options.engine === "mock") return;

    const estimatedOutputTokens = Math.ceil(outputChars / 4);

    logAIUsage({
      engine: options.engine as "claude" | "openai",
      model: options.engine === "claude" ? config.ai.claude.model : config.ai.openai.model,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      userId: context?.userId,
      callerId: context?.callerId,
      callId: context?.callId,
      sourceOp: context?.sourceOp,
      metadata: {
        estimated: true,
        streamingMode: true,
      },
    }).catch((error) => {
      console.error("[metering] Failed to log streaming AI usage:", error);
    });
  };

  return { stream, logUsage };
}

/**
 * Create a metering-aware stream that tracks output length.
 *
 * Wraps the stream and calls logUsage when complete.
 */
export function createMeteredStream(
  originalStream: ReadableStream<Uint8Array>,
  engine: AIEngine,
  inputMessages: { content: string | any[] }[],
  context?: MeteringContext
): ReadableStream<Uint8Array> {
  if (engine === "mock") {
    return originalStream;
  }

  let totalOutputChars = 0;
  const decoder = new TextDecoder();

  // Estimate input tokens
  const inputChars = inputMessages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const estimatedInputTokens = Math.ceil(inputChars / 4);

  return new ReadableStream({
    async start(controller) {
      const reader = originalStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Stream complete - log usage
            const estimatedOutputTokens = Math.ceil(totalOutputChars / 4);

            logAIUsage({
              engine: engine as "claude" | "openai",
              model: engine === "claude" ? config.ai.claude.model : config.ai.openai.model,
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens,
              userId: context?.userId,
              callerId: context?.callerId,
              callId: context?.callId,
              sourceOp: context?.sourceOp,
              metadata: {
                estimated: true,
                streamingMode: true,
              },
            }).catch((error) => {
              console.error("[metering] Failed to log streaming AI usage:", error);
            });

            controller.close();
            break;
          }

          // Count output characters
          if (value) {
            totalOutputChars += decoder.decode(value, { stream: true }).length;
            controller.enqueue(value);
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// ============================================================
// DEEP LOGGING (fire-and-forget diagnostic capture)
// ============================================================

/**
 * When deep logging is enabled, capture full prompt + response for diagnostics.
 * Fire-and-forget — never blocks the AI call return path.
 */
function maybeDeepLog(
  options: ConfiguredAIOptions,
  result: AICompletionResult,
  durationMs: number,
  context?: MeteringContext
): void {
  isDeepLoggingEnabled()
    .then((enabled) => {
      if (!enabled) return;

      const fullPrompt = options.messages
        .map((m) => `[${m.role}] ${getTextContent(m)}`)
        .join("\n---\n");

      logAI(`deep:${options.callPoint}`, fullPrompt, result.content, {
        deep: true,
        durationMs,
        model: result.model,
        engine: result.engine,
        usage: result.usage,
        callId: context?.callId,
        callerId: context?.callerId,
        userId: context?.userId,
        sourceOp: context?.sourceOp || options.callPoint,
        userName: context?.userName,
        entityLabel: context?.entityLabel,
        wizardName: context?.wizardName,
        wizardStep: context?.wizardStep,
      });
    })
    .catch(() => {
      // Never throw from diagnostic logging
    });
}

/**
 * Deep-log a failed AI call for diagnostics.
 */
function maybeDeepLogError(
  options: ConfiguredAIOptions,
  error: unknown,
  durationMs: number,
  context?: MeteringContext
): void {
  isDeepLoggingEnabled()
    .then((enabled) => {
      if (!enabled) return;

      const fullPrompt = options.messages
        .map((m) => `[${m.role}] ${getTextContent(m)}`)
        .join("\n---\n");

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logAI(`deep:${options.callPoint}:error`, fullPrompt, errorMessage, {
        deep: true,
        durationMs,
        error: errorMessage,
        errorType: classifyAIError(error),
        callId: context?.callId,
        callerId: context?.callerId,
        userId: context?.userId,
        sourceOp: context?.sourceOp || options.callPoint,
        userName: context?.userName,
        entityLabel: context?.entityLabel,
        wizardName: context?.wizardName,
        wizardStep: context?.wizardStep,
      });
    })
    .catch(() => {
      // Never throw from diagnostic logging
    });
}

// ============================================================
// CONFIG-AWARE METERED COMPLETIONS
// ============================================================

/**
 * Get AI completion with configuration from database and automatic metering.
 * This is the preferred method for production code.
 *
 * Includes automatic retry logic for transient errors (rate limits, timeouts, network).
 *
 * @param options - Includes callPoint to load config for, and optional maxRetries
 * @param context - Metering context (userId, callerId, etc.)
 * @returns Completion result with model info
 */
export async function getConfiguredMeteredAICompletion(
  options: ConfiguredAIOptions,
  context?: MeteringContext
): Promise<AICompletionResult> {
  const startTime = Date.now();
  const maxRetries = options.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await getConfiguredAICompletion(options);

      // Log usage if we have token counts (mock doesn't provide these)
      if (result.usage && result.engine !== "mock") {
        logAIUsage({
          engine: result.engine as "claude" | "openai",
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          userId: context?.userId,
          callerId: context?.callerId,
          callId: context?.callId,
          sourceOp: context?.sourceOp || options.callPoint,
          metadata: result.usage.cacheReadTokens || result.usage.cacheCreationTokens
            ? {
                cacheReadTokens: result.usage.cacheReadTokens,
                cacheCreationTokens: result.usage.cacheCreationTokens,
              }
            : undefined,
        }).catch((error) => {
          console.error("[metering] Failed to log AI usage:", error);
        });
      }

      const durationMs = Date.now() - startTime;

      // Always log to Logs panel (fire-and-forget)
      const promptSummary = options.messages
        .filter((m) => m.role === "user")
        .map((m) => getTextContent(m))
        .join(" ")
        .slice(0, 200);
      logAI(options.callPoint, promptSummary, result.content.slice(0, 500), {
        usage: result.usage,
        durationMs,
        model: result.model,
        engine: result.engine,
        callId: context?.callId,
        callerId: context?.callerId,
        userId: context?.userId,
        sourceOp: context?.sourceOp || options.callPoint,
        userName: context?.userName,
        entityLabel: context?.entityLabel,
        wizardName: context?.wizardName,
        wizardStep: context?.wizardStep,
      });

      // Deep logging (fire-and-forget)
      maybeDeepLog(options, result, durationMs, context);

      return result;
    } catch (err) {
      lastError = err;
      const errorCode = classifyAIError(err);

      // Log retry attempt
      if (attempt < maxRetries) {
        const backoffMs = 500 * Math.pow(2, attempt);
        console.warn(
          `[metering] AI call attempt ${attempt + 1} failed (${errorCode}). Retrying in ${backoffMs}ms...`,
          { callPoint: options.callPoint, attempt, errorCode }
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      // Only retry if the error is retryable and we have retries left
      if (!isRetryable(errorCode) || attempt === maxRetries) {
        // Deep-log the final failure
        maybeDeepLogError(options, err, Date.now() - startTime, context);
        throw err;
      }
    }
  }

  // Should never reach here, but just in case
  throw lastError;
}

/**
 * Get AI completion stream with configuration from database and automatic metering.
 *
 * NOTE: Deep logging is not supported for streaming calls — the response is consumed
 * incrementally and cannot be captured without buffering. All wizard and pipeline AI calls
 * use non-streaming, so this is acceptable for diagnostic purposes.
 *
 * @param options - Includes callPoint to load config for
 * @param context - Metering context
 * @returns Metering-aware stream
 */
export async function getConfiguredMeteredAICompletionStream(
  options: ConfiguredAIOptions,
  context?: MeteringContext
): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  // Import config loader to get the model info
  const { getAIConfig } = await import("@/lib/ai/config-loader");
  const aiConfig = await getAIConfig(options.callPoint);

  const stream = await getConfiguredAICompletionStream(options);

  // Wrap with metering
  const meteredStream = createMeteredStreamWithModel(
    stream,
    aiConfig.provider,
    aiConfig.model,
    options.messages,
    { ...context, sourceOp: context?.sourceOp || options.callPoint }
  );

  return { stream: meteredStream, model: aiConfig.model };
}

/**
 * Create a metering-aware stream that tracks output length.
 * Uses the actual model from config instead of hardcoded defaults.
 */
function createMeteredStreamWithModel(
  originalStream: ReadableStream<Uint8Array>,
  engine: AIEngine,
  model: string,
  inputMessages: { content: string | any[] }[],
  context?: MeteringContext
): ReadableStream<Uint8Array> {
  if (engine === "mock") {
    return originalStream;
  }

  let totalOutputChars = 0;
  const decoder = new TextDecoder();

  // Estimate input tokens
  const inputChars = inputMessages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const estimatedInputTokens = Math.ceil(inputChars / 4);

  return new ReadableStream({
    async start(controller) {
      const reader = originalStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            const estimatedOutputTokens = Math.ceil(totalOutputChars / 4);

            logAIUsage({
              engine: engine as "claude" | "openai",
              model: model,
              inputTokens: estimatedInputTokens,
              outputTokens: estimatedOutputTokens,
              userId: context?.userId,
              callerId: context?.callerId,
              callId: context?.callId,
              sourceOp: context?.sourceOp,
              metadata: {
                estimated: true,
                streamingMode: true,
              },
            }).catch((error) => {
              console.error("[metering] Failed to log streaming AI usage:", error);
            });

            controller.close();
            break;
          }

          if (value) {
            totalOutputChars += decoder.decode(value, { stream: true }).length;
            controller.enqueue(value);
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Re-export commonly used types for convenience
export type { AICompletionOptions, AICompletionResult, AIStreamOptions, AIEngine, ConfiguredAIOptions };
