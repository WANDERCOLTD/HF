/**
 * Usage Logger - Core function for logging usage events
 *
 * This is the primary entry point for recording resource usage.
 * All instrumentation wrappers should use this function.
 */

import { UsageCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCostRate, calculateCost } from "./cost-config";

export interface UsageEventInput {
  // Required
  category: UsageCategory;
  operation: string;

  // Optional attribution
  userId?: string;
  callerId?: string;
  callId?: string;

  // Quantity (default: 1)
  quantity?: number;
  unitType?: string;

  // Context
  engine?: string;
  model?: string;
  sourceOp?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageEventResult {
  id: string;
  costCents: number;
}

/**
 * Log a usage event to the database.
 *
 * This function is fire-and-forget safe - it catches errors internally
 * and logs them without throwing. Use logUsageEventAsync for awaitable version.
 *
 * @param input - The usage event data
 * @returns The created event (or null if failed)
 */
export async function logUsageEvent(
  input: UsageEventInput
): Promise<UsageEventResult | null> {
  try {
    // Get cost rate for this operation
    const { costPerUnit, unitType: rateUnitType } = await getCostRate(
      input.category,
      input.operation
    );

    // Use provided unitType or fall back to rate's unitType
    const unitType = input.unitType || rateUnitType || "count";
    const quantity = input.quantity ?? 1;

    // Calculate cost
    const costCents = calculateCost(quantity, costPerUnit, unitType);

    // Create the event
    const event = await prisma.usageEvent.create({
      data: {
        category: input.category,
        operation: input.operation,
        userId: input.userId,
        callerId: input.callerId,
        callId: input.callId,
        quantity,
        unitType,
        costCents,
        engine: input.engine,
        model: input.model,
        sourceOp: input.sourceOp,
        metadata: input.metadata as object,
      },
    });

    return { id: event.id, costCents };
  } catch (error) {
    console.error("[metering] Failed to log usage event:", error, input);
    return null;
  }
}

/**
 * Log multiple usage events in a batch (more efficient for bulk operations).
 */
export async function logUsageEventsBatch(
  inputs: UsageEventInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  try {
    // Pre-fetch all unique rates we'll need
    const ratePromises = inputs.map((input) =>
      getCostRate(input.category, input.operation)
    );
    const rates = await Promise.all(ratePromises);

    // Build data array
    const data = inputs.map((input, i) => {
      const { costPerUnit, unitType: rateUnitType } = rates[i];
      const unitType = input.unitType || rateUnitType || "count";
      const quantity = input.quantity ?? 1;
      const costCents = calculateCost(quantity, costPerUnit, unitType);

      return {
        category: input.category,
        operation: input.operation,
        userId: input.userId,
        callerId: input.callerId,
        callId: input.callId,
        quantity,
        unitType,
        costCents,
        engine: input.engine,
        model: input.model,
        sourceOp: input.sourceOp,
        metadata: input.metadata as object,
      };
    });

    const result = await prisma.usageEvent.createMany({ data });
    return result.count;
  } catch (error) {
    console.error("[metering] Failed to log batch usage events:", error);
    return 0;
  }
}

/**
 * Fire-and-forget version that doesn't block the caller.
 * Use this when you don't need the result.
 */
export function logUsageEventFireAndForget(input: UsageEventInput): void {
  logUsageEvent(input).catch((error) => {
    console.error("[metering] Fire-and-forget logging failed:", error);
  });
}

// =========================
// Convenience helpers for common operations
// =========================

/**
 * Log AI token usage (both input and output).
 * For real AI providers (claude, openai) only.
 * Use logMockAIUsage for mock/testing completions.
 */
export async function logAIUsage(params: {
  engine: "claude" | "openai";
  model: string;
  inputTokens: number;
  outputTokens: number;
  userId?: string;
  callerId?: string;
  callId?: string;
  sourceOp?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // Resolve model tier for per-model cost rates.
  // E.g. "claude-haiku" for haiku models, "claude-sonnet" for sonnet, "claude-opus" for opus.
  // Falls back to engine name (e.g. "claude") when tier is unknown.
  const operationPrefix = resolveModelTier(params.engine, params.model);

  const baseInput = {
    category: "AI" as UsageCategory,
    userId: params.userId,
    callerId: params.callerId,
    callId: params.callId,
    engine: params.engine,
    model: params.model,
    sourceOp: params.sourceOp,
  };

  // Log input tokens
  // Note: quantity is raw token count; cost rate uses 1k_tokens unit
  // so we let getCostRate provide the unitType and calculateCost handles normalization
  if (params.inputTokens > 0) {
    await logUsageEvent({
      ...baseInput,
      operation: `${operationPrefix}:input`,
      quantity: params.inputTokens,
      metadata: { ...params.metadata, tokenType: "input" },
    });
  }

  // Log output tokens
  if (params.outputTokens > 0) {
    await logUsageEvent({
      ...baseInput,
      operation: `${operationPrefix}:output`,
      quantity: params.outputTokens,
      metadata: { ...params.metadata, tokenType: "output" },
    });
  }
}

/**
 * Resolve a model ID to a cost tier prefix.
 * Maps model strings like "claude-haiku-4-5-20251001" → "claude-haiku",
 * "claude-sonnet-4-20250514" → "claude-sonnet", etc.
 * Falls back to the engine name when the tier can't be determined.
 */
function resolveModelTier(engine: string, model: string): string {
  if (engine !== "claude") return engine;

  const m = model.toLowerCase();
  if (m.includes("haiku")) return "claude-haiku";
  if (m.includes("sonnet")) return "claude-sonnet";
  if (m.includes("opus")) return "claude-opus";

  // Unknown Claude model — fall back to generic "claude" rate
  return "claude";
}

/**
 * Log a mock AI completion.
 * Tracks mock/testing calls for visibility in metering dashboard.
 * These have zero cost but show that real AI was not used.
 *
 * @param params - Mock usage context
 * @param params.sourceOp - The operation that would have used AI (e.g., "pipeline:extract")
 * @param params.reason - Why mock was used (e.g., "fallback", "testing", "no_api_key")
 */
export async function logMockAIUsage(params: {
  userId?: string;
  callerId?: string;
  callId?: string;
  sourceOp?: string;
  reason?: "fallback" | "testing" | "no_api_key" | "requested";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logUsageEvent({
    category: "AI" as UsageCategory,
    operation: "mock:completion",
    quantity: 1,
    unitType: "count",
    engine: "mock",
    model: "mock-model",
    userId: params.userId,
    callerId: params.callerId,
    callId: params.callId,
    sourceOp: params.sourceOp,
    metadata: {
      ...params.metadata,
      reason: params.reason || "testing",
      isMock: true,
    },
  });
}

/**
 * Log a slow database query.
 */
export function logSlowQuery(params: {
  model: string;
  action: string;
  durationMs: number;
  userId?: string;
}): void {
  logUsageEventFireAndForget({
    category: "DATABASE",
    operation: `${params.model}.${params.action}`,
    quantity: params.durationMs,
    unitType: "ms",
    userId: params.userId,
    metadata: {
      model: params.model,
      action: params.action,
      durationMs: params.durationMs,
    },
  });
}

/**
 * Log compute operation duration.
 */
export async function logComputeUsage(params: {
  operation: string;
  durationMs: number;
  userId?: string;
  callerId?: string;
  sourceOp?: string;
  metadata?: Record<string, unknown>;
}): Promise<UsageEventResult | null> {
  return logUsageEvent({
    category: "COMPUTE",
    operation: params.operation,
    quantity: params.durationMs,
    unitType: "ms",
    userId: params.userId,
    callerId: params.callerId,
    sourceOp: params.sourceOp,
    metadata: {
      ...params.metadata,
      durationMs: params.durationMs,
    },
  });
}

/**
 * Log storage usage.
 */
export async function logStorageUsage(params: {
  operation: string;
  bytes: number;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<UsageEventResult | null> {
  return logUsageEvent({
    category: "STORAGE",
    operation: params.operation,
    quantity: params.bytes,
    unitType: "bytes",
    userId: params.userId,
    metadata: params.metadata,
  });
}

/**
 * Log external API call.
 */
export async function logExternalAPIUsage(params: {
  operation: string;
  userId?: string;
  callerId?: string;
  metadata?: Record<string, unknown>;
}): Promise<UsageEventResult | null> {
  return logUsageEvent({
    category: "EXTERNAL",
    operation: params.operation,
    quantity: 1,
    unitType: "count",
    userId: params.userId,
    callerId: params.callerId,
    metadata: params.metadata,
  });
}
