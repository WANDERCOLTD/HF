/**
 * Cost Configuration for Usage Metering
 *
 * Default cost rates for different resource categories.
 * These can be overridden via the UsageCostRate database table.
 *
 * Cost units are in CENTS per unit for precision.
 */

import { UsageCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Default cost rates (cents per unit)
// Based on Anthropic/OpenAI pricing as of March 2026
export const DEFAULT_COST_RATES: Record<
  string,
  { costPerUnit: number; unitType: string; description: string }
> = {
  // =========================
  // AI COSTS (per 1000 tokens)
  // =========================

  // ── Claude per-model rates (matched first) ──
  // Haiku 4.5: $1/M input, $5/M output
  "AI:claude-haiku:input": {
    costPerUnit: 0.1,
    unitType: "1k_tokens",
    description: "Claude Haiku input tokens (~$1/M)",
  },
  "AI:claude-haiku:output": {
    costPerUnit: 0.5,
    unitType: "1k_tokens",
    description: "Claude Haiku output tokens (~$5/M)",
  },
  // Sonnet 4.6: $3/M input, $15/M output
  "AI:claude-sonnet:input": {
    costPerUnit: 0.3,
    unitType: "1k_tokens",
    description: "Claude Sonnet input tokens (~$3/M)",
  },
  "AI:claude-sonnet:output": {
    costPerUnit: 1.5,
    unitType: "1k_tokens",
    description: "Claude Sonnet output tokens (~$15/M)",
  },
  // Opus 4.6: $5/M input, $25/M output
  "AI:claude-opus:input": {
    costPerUnit: 0.5,
    unitType: "1k_tokens",
    description: "Claude Opus input tokens (~$5/M)",
  },
  "AI:claude-opus:output": {
    costPerUnit: 2.5,
    unitType: "1k_tokens",
    description: "Claude Opus output tokens (~$25/M)",
  },

  // ── Claude fallback (used when model tier is unknown) ──
  // Defaults to Sonnet pricing as the most common tier
  "AI:claude:input": {
    costPerUnit: 0.3,
    unitType: "1k_tokens",
    description: "Claude input tokens — fallback (~$3/M, Sonnet pricing)",
  },
  "AI:claude:output": {
    costPerUnit: 1.5,
    unitType: "1k_tokens",
    description: "Claude output tokens — fallback (~$15/M, Sonnet pricing)",
  },

  // OpenAI GPT-4o: ~$2.5/M input, ~$10/M output
  "AI:openai:input": {
    costPerUnit: 0.25,
    unitType: "1k_tokens",
    description: "OpenAI input tokens (~$2.5/M)",
  },
  "AI:openai:output": {
    costPerUnit: 1.0,
    unitType: "1k_tokens",
    description: "OpenAI output tokens (~$10/M)",
  },
  // Mock AI (zero cost - for testing/fallback visibility)
  "AI:mock:completion": {
    costPerUnit: 0,
    unitType: "count",
    description: "Mock AI completion (no real API call)",
  },

  // =========================
  // DATABASE COSTS (per ms over threshold)
  // =========================
  "DATABASE:query": {
    costPerUnit: 0.001,
    unitType: "ms",
    description: "Slow DB query cost per ms (queries >100ms)",
  },

  // =========================
  // COMPUTE COSTS (per 100ms execution)
  // =========================
  "COMPUTE:pipeline": {
    costPerUnit: 0.01,
    unitType: "100ms",
    description: "Pipeline execution time",
  },
  "COMPUTE:analysis": {
    costPerUnit: 0.005,
    unitType: "100ms",
    description: "Analysis operation time",
  },
  "COMPUTE:import": {
    costPerUnit: 0.002,
    unitType: "100ms",
    description: "Transcript import time",
  },

  // =========================
  // STORAGE COSTS (per MB)
  // =========================
  "STORAGE:transcript": {
    costPerUnit: 0.1,
    unitType: "mb",
    description: "Transcript file storage per MB",
  },
  "STORAGE:knowledge": {
    costPerUnit: 0.05,
    unitType: "mb",
    description: "Knowledge base storage per MB",
  },

  // =========================
  // EXTERNAL API COSTS (per call)
  // =========================
  "EXTERNAL:webhook": {
    costPerUnit: 0.5,
    unitType: "count",
    description: "External webhook call",
  },
  "EXTERNAL:vapi": {
    costPerUnit: 1.0,
    unitType: "count",
    description: "VAPI API call",
  },
};

// Cache for DB rates (5 minute TTL)
let rateCache: Map<string, { rate: number; unitType: string; expiresAt: number }> =
  new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the cost rate for a specific category and operation.
 * Checks DB first (with cache), falls back to default rates.
 *
 * @param category - The usage category (AI, DATABASE, etc.)
 * @param operation - The specific operation (e.g., "claude:input")
 * @returns Cost per unit and unit type
 */
export async function getCostRate(
  category: UsageCategory,
  operation: string
): Promise<{ costPerUnit: number; unitType: string }> {
  const cacheKey = `${category}:${operation}`;
  const now = Date.now();

  // Check cache first
  const cached = rateCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { costPerUnit: cached.rate, unitType: cached.unitType };
  }

  // Try to get from database
  try {
    const dbRate = await prisma.usageCostRate.findFirst({
      where: {
        category,
        operation,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (dbRate) {
      // Cache the DB result
      rateCache.set(cacheKey, {
        rate: dbRate.costPerUnit,
        unitType: dbRate.unitType,
        expiresAt: now + CACHE_TTL_MS,
      });
      return { costPerUnit: dbRate.costPerUnit, unitType: dbRate.unitType };
    }

    // Try category default (operation = null)
    const categoryDefault = await prisma.usageCostRate.findFirst({
      where: {
        category,
        operation: null,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (categoryDefault) {
      rateCache.set(cacheKey, {
        rate: categoryDefault.costPerUnit,
        unitType: categoryDefault.unitType,
        expiresAt: now + CACHE_TTL_MS,
      });
      return {
        costPerUnit: categoryDefault.costPerUnit,
        unitType: categoryDefault.unitType,
      };
    }
  } catch (error) {
    // Log but don't fail - fall back to defaults
    console.warn("[metering] Failed to fetch cost rate from DB:", error);
  }

  // Fall back to code defaults
  const defaultKey = `${category}:${operation}`;
  const defaultRate = DEFAULT_COST_RATES[defaultKey];

  if (defaultRate) {
    rateCache.set(cacheKey, {
      rate: defaultRate.costPerUnit,
      unitType: defaultRate.unitType,
      expiresAt: now + CACHE_TTL_MS,
    });
    return { costPerUnit: defaultRate.costPerUnit, unitType: defaultRate.unitType };
  }

  // Ultimate fallback: zero cost
  return { costPerUnit: 0, unitType: "count" };
}

/**
 * Calculate cost in cents for a given quantity and rate.
 */
export function calculateCost(
  quantity: number,
  costPerUnit: number,
  unitType: string
): number {
  // Normalize quantity based on unit type
  let normalizedQty = quantity;

  switch (unitType) {
    case "1k_tokens":
      normalizedQty = quantity / 1000;
      break;
    case "100ms":
      normalizedQty = quantity / 100;
      break;
    case "mb":
      // quantity is in bytes, convert to MB
      normalizedQty = quantity / (1024 * 1024);
      break;
    default:
      // "count", "ms", etc. - use as-is
      break;
  }

  return normalizedQty * costPerUnit;
}

/**
 * Clear the rate cache (useful after updating rates in DB).
 */
export function clearRateCache(): void {
  rateCache.clear();
}

/**
 * Get all default rates (for seeding or UI display).
 */
export function getDefaultRates(): typeof DEFAULT_COST_RATES {
  return DEFAULT_COST_RATES;
}
