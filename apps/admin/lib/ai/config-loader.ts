/**
 * AI Configuration Loader
 *
 * Loads AI configuration from the database for a given call point.
 * Used by the AI client to determine which provider/model to use.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import type { AIEngine } from "./client";
import { getAIModelConfigsFallback } from "@/lib/fallback-settings";

// =====================================================
// ENGINE AVAILABILITY (inlined to avoid circular imports)
// =====================================================

/**
 * Check if an AI engine has its API key configured.
 * Inlined here to avoid circular import with client.ts
 */
function isEngineAvailable(engine: AIEngine): boolean {
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
 * Get the first available engine (has API key configured).
 */
function getDefaultEngine(): AIEngine {
  if (isEngineAvailable("claude")) return "claude";
  if (isEngineAvailable("openai")) return "openai";
  return "mock";
}

// =====================================================
// TYPES
// =====================================================

export interface AIConfigResult {
  provider: AIEngine;
  model: string;
  maxTokens?: number;
  temperature?: number;
  isCustomized: boolean;
}

// Per-call-point defaults: provider, model, and optional temperature/maxTokens.
// Uses config.ai.claude.model for flagship and config.ai.claude.lightModel for fast/cheap tasks.
// All env-overridable via config.ai.*. Operators can override per-call-point via /x/ai-config.
// These match the definitions in /api/ai-config/route.ts
const DEFAULT_CONFIGS: Record<string, { provider: AIEngine; model: string; temperature?: number; maxTokens?: number }> = {
  "pipeline.measure": { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 2048 },
  "pipeline.learn": { provider: "claude", model: config.ai.claude.model },
  "pipeline.score_agent": { provider: "claude", model: config.ai.claude.model, temperature: 0.3 },
  "pipeline.adapt": { provider: "claude", model: config.ai.claude.lightModel },
  "pipeline.extract_goals": { provider: "claude", model: config.ai.claude.lightModel },
  "compose.prompt": { provider: "claude", model: config.ai.claude.model },
  "analysis.measure": { provider: "claude", model: config.ai.claude.lightModel },
  "analysis.learn": { provider: "claude", model: config.ai.claude.lightModel },
  "parameter.enrich": { provider: "claude", model: config.ai.claude.lightModel },
  "bdd.parse": { provider: "claude", model: config.ai.claude.model },
  "chat.stream": { provider: "claude", model: config.ai.claude.model },
  "spec.assistant": { provider: "claude", model: config.ai.claude.model },
  "spec.view": { provider: "claude", model: config.ai.claude.model },
  "spec.extract": { provider: "claude", model: config.ai.claude.model },
  "spec.parse": { provider: "claude", model: config.ai.claude.lightModel },
  "chat.data": { provider: "claude", model: config.ai.claude.model, temperature: 0.7, maxTokens: 4000 },
  "chat.call": { provider: "claude", model: config.ai.claude.model, temperature: 0.85, maxTokens: 300 },
  "chat.bug": { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 2000 },
  "assistant.chat": { provider: "claude", model: config.ai.claude.model },
  "assistant.tasks": { provider: "claude", model: config.ai.claude.model },
  "assistant.data": { provider: "claude", model: config.ai.claude.model },
  "assistant.spec": { provider: "claude", model: config.ai.claude.model },
  "content-trust.extract": { provider: "claude", model: config.ai.claude.model, temperature: 0.1, maxTokens: 4000 },
  "content-trust.quick-extract": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 1500 },
  "content-trust.structure": { provider: "claude", model: config.ai.claude.model, temperature: 0.2, maxTokens: 8000 },
  "content-trust.classify": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 500 },
  "content-trust.curriculum": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 8000 }, // lightModel for market test — switch to full model post-launch
  "content-trust.curriculum-from-goals": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 8000 }, // lightModel for market test
  "content-trust.curriculum-skeleton": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 2000 },
  "workflow.classify": { provider: "claude", model: config.ai.claude.model },
  "workflow.step": { provider: "claude", model: config.ai.claude.model },
  "quick-launch.identity": { provider: "claude", model: config.ai.claude.model, temperature: 0.4 },
  "test-harness.system": { provider: "claude", model: config.ai.claude.model },
  "test-harness.caller": { provider: "claude", model: config.ai.claude.model },
  "test-harness.greeting": { provider: "claude", model: config.ai.claude.model },
  "targets.suggest": { provider: "claude", model: config.ai.claude.lightModel },
  "content-sources.suggest": { provider: "claude", model: config.ai.claude.lightModel },
  "agent-tuner.interpret": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 2048 },
  // Specialist extractors — structured JSON output needs more room than default 1024
  // lightModel (Haiku) is sufficient for structured extraction and avoids Sonnet timeout at 30s
  "content-trust.extract-comprehension": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 8000 },
  "content-trust.extract-assessment": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 8000 },
  "content-trust.extract-reading-passage": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 4000 },
  "content-trust.extract-question-bank": { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 8000 },
  // Missing from original — synced from route.ts AI_CALL_POINTS
  "pipeline.artifacts": { provider: "claude", model: config.ai.claude.lightModel },
  "pipeline.actions": { provider: "claude", model: config.ai.claude.lightModel },
  "content-trust.segment": { provider: "claude", model: config.ai.claude.lightModel },
  "content-trust.lesson-plan": { provider: "claude", model: config.ai.claude.model },
  "lesson-plan.generate": { provider: "claude", model: config.ai.claude.model },
  "quick-launch.suggest-name": { provider: "claude", model: "claude-haiku-4-5-20251001" },
  "demonstrate.suggest": { provider: "claude", model: config.ai.claude.lightModel },
  "workflow.step-guidance": { provider: "claude", model: config.ai.claude.model },
};

// In-memory cache with TTL
const configCache: Map<string, { config: AIConfigResult; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute cache

// Default models per provider (used for fallback)
const DEFAULT_MODELS: Record<AIEngine, string> = {
  claude: config.ai.claude.model,
  openai: config.ai.openai.model,
  mock: "mock-model",
};

/**
 * Ensure provider is available, falling back to one that has an API key configured.
 * Returns the provider and whether a fallback was used.
 */
function ensureAvailableProvider(
  provider: AIEngine,
  model: string
): { provider: AIEngine; model: string; fallbackUsed: boolean } {
  if (isEngineAvailable(provider)) {
    return { provider, model, fallbackUsed: false };
  }

  // Provider not available - find a fallback
  const fallbackProvider = getDefaultEngine();
  if (fallbackProvider !== provider) {
    console.warn(
      `[ai-config] Provider "${provider}" not available (missing API key), falling back to "${fallbackProvider}"`
    );
    return {
      provider: fallbackProvider,
      model: DEFAULT_MODELS[fallbackProvider],
      fallbackUsed: true,
    };
  }

  // No fallback available - return mock
  return { provider: "mock", model: "mock-model", fallbackUsed: true };
}

// =====================================================
// LOADER FUNCTION
// =====================================================

/**
 * Get AI configuration for a call point.
 * Loads from database (with caching) and falls back to defaults.
 *
 * @param callPoint - The call point identifier (e.g., "pipeline.measure")
 * @returns The configuration to use for this call point
 */
export async function getAIConfig(callPoint: string): Promise<AIConfigResult> {
  // Check cache first
  const cached = configCache.get(callPoint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  // Load from database
  try {
    const dbConfig = await prisma.aIConfig.findUnique({
      where: { callPoint },
    });

    if (dbConfig && dbConfig.isActive) {
      // Ensure the configured provider is actually available
      const { provider, model, fallbackUsed } = ensureAvailableProvider(
        dbConfig.provider as AIEngine,
        dbConfig.model
      );

      const result: AIConfigResult = {
        provider,
        model: fallbackUsed ? model : dbConfig.model,
        maxTokens: dbConfig.maxTokens ?? undefined,
        temperature: dbConfig.temperature ?? undefined,
        isCustomized: !fallbackUsed, // Not really customized if we had to fall back
      };

      // Cache the result
      configCache.set(callPoint, { config: result, fetchedAt: Date.now() });
      return result;
    }
  } catch (error) {
    // Log but don't fail - fall back to defaults
    console.warn(`[ai-config] Failed to load config for ${callPoint}:`, error);
  }

  // Fall back to defaults (SystemSettings → hardcoded constant)
  const fallbackConfigs = await getAIModelConfigsFallback();
  const fallbackConfig = fallbackConfigs[callPoint];
  const hardcodedConfig = DEFAULT_CONFIGS[callPoint];
  const defaultConfig = fallbackConfig || hardcodedConfig;
  if (defaultConfig) {
    // Ensure the default provider is actually available
    const { provider, model } = ensureAvailableProvider(
      defaultConfig.provider as AIEngine,
      defaultConfig.model
    );

    const result: AIConfigResult = {
      provider,
      model,
      maxTokens: hardcodedConfig?.maxTokens,
      temperature: hardcodedConfig?.temperature,
      isCustomized: false,
    };
    configCache.set(callPoint, { config: result, fetchedAt: Date.now() });
    return result;
  }

  // Ultimate fallback - use whatever is available
  const fallbackProvider = getDefaultEngine();
  return {
    provider: fallbackProvider,
    model: DEFAULT_MODELS[fallbackProvider],
    isCustomized: false,
  };
}

/**
 * Clear the configuration cache.
 * Call this when configurations are updated.
 */
export function clearAIConfigCache(): void {
  configCache.clear();
}

/**
 * Preload all configurations into cache.
 * Useful for warming up at startup.
 */
export async function preloadAIConfigs(): Promise<void> {
  try {
    const allConfigs = await prisma.aIConfig.findMany({
      where: { isActive: true },
    });

    for (const config of allConfigs) {
      const result: AIConfigResult = {
        provider: config.provider as AIEngine,
        model: config.model,
        maxTokens: config.maxTokens ?? undefined,
        temperature: config.temperature ?? undefined,
        isCustomized: true,
      };
      configCache.set(config.callPoint, { config: result, fetchedAt: Date.now() });
    }

    // Also cache defaults for unconfigured call points
    for (const [callPoint, defaultConfig] of Object.entries(DEFAULT_CONFIGS)) {
      if (!configCache.has(callPoint)) {
        configCache.set(callPoint, {
          config: { ...defaultConfig, isCustomized: false },
          fetchedAt: Date.now(),
        });
      }
    }
  } catch (error) {
    console.warn("[ai-config] Failed to preload configs:", error);
  }
}
