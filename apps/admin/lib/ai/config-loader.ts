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
import { getDefaultsMap } from "./call-points";
import type { AICallPointOverride, AIOverridesMap } from "@/lib/types/json-fields";

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
  /** Timeout in milliseconds. Resolved from DB → call-point defaults → 30_000. */
  timeoutMs?: number;
  isCustomized: boolean;
  /**
   * Lattice provenance — which scope tier supplied the winning model
   * (#1868). `"playbook" | "domain" | "global" | "system" | "hardcoded"`.
   *
   * Per-field provenance (provider may come from Playbook, model from
   * Domain, etc.) is intentionally not tracked here — a future Cascade
   * Inspector Tray entry can join the `AICascadeChain` if/when needed.
   * The winner field below identifies who set the **model** specifically,
   * which is the load-bearing axis the 2026-06-17 incident hit.
   */
  modelLayer?: "playbook" | "domain" | "global" | "system" | "hardcoded" | "ultimate";
}

/**
 * Scope chain for cascading AI configuration resolution (#1868). At least
 * ONE of `callId`, `playbookId`, `domainId` should be set for the cascade
 * to engage; an absent scope keeps the legacy flat lookup.
 *
 * When `callId` is supplied alone, the resolver fetches the Call row to
 * derive `playbookId`. When `playbookId` is supplied, it fetches the
 * Playbook to derive `domainId`. Higher-priority ids passed in
 * directly skip the lookup.
 */
export interface AIConfigScope {
  callId?: string;
  playbookId?: string;
  domainId?: string;
}

// Defaults are imported from the canonical call-points registry (single source of truth).
// No duplicate default map here — all call point definitions live in call-points.ts.
const DEFAULT_CONFIGS = getDefaultsMap();

// In-memory cache with TTL. Key shape: `${callPoint}|${playbookId??""}|${domainId??""}`
// so per-Playbook + per-Domain overrides do not collide on the call-point
// (#1868 — Lattice gap closeout).
const configCache: Map<string, { config: AIConfigResult; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute cache

function cacheKey(callPoint: string, scope: AIConfigScope | undefined): string {
  return `${callPoint}|${scope?.playbookId ?? ""}|${scope?.domainId ?? ""}`;
}

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
// CASCADE — Playbook + Domain layer reads (#1868)
// =====================================================

/**
 * Single combined lookup: derive `(playbookId, domainId)` from scope AND
 * read the call-point override off `Playbook.config.aiOverrides[callPoint]`
 * in ONE Playbook query. Domain reads in a second query when needed.
 *
 * Returns `{ playbookOverride: null, domainOverride: null }` on any read
 * failure — cascade callers fall through to the legacy global path. Per
 * `.claude/rules/ai-callpoint-cascade.md`.
 */
async function readScopeOverrides(
  scope: AIConfigScope,
  callPoint: string,
): Promise<{
  playbookOverride: AICallPointOverride | null;
  domainOverride: AICallPointOverride | null;
}> {
  let playbookId: string | null = scope.playbookId ?? null;
  let domainId: string | null = scope.domainId ?? null;
  let playbookOverride: AICallPointOverride | null = null;

  try {
    if (!playbookId && scope.callId) {
      const call = await prisma.call.findUnique({
        where: { id: scope.callId },
        select: { playbookId: true, caller: { select: { domainId: true } } },
      });
      playbookId = call?.playbookId ?? null;
      if (!domainId) domainId = call?.caller?.domainId ?? null;
    }
    if (playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: playbookId },
        select: { config: true, domainId: true },
      });
      const cfg = (pb?.config ?? {}) as { aiOverrides?: AIOverridesMap };
      playbookOverride = cfg.aiOverrides?.[callPoint] ?? null;
      if (!domainId) domainId = pb?.domainId ?? null;
    }
    let domainOverride: AICallPointOverride | null = null;
    if (domainId) {
      const dom = await prisma.domain.findUnique({
        where: { id: domainId },
        select: { config: true },
      });
      const cfg = (dom?.config ?? {}) as { aiOverrides?: AIOverridesMap };
      domainOverride = cfg.aiOverrides?.[callPoint] ?? null;
    }
    return { playbookOverride, domainOverride };
  } catch (err) {
    console.warn("[ai-config] readScopeOverrides failed — falling through to global lookup:", err);
    return { playbookOverride: null, domainOverride: null };
  }
}

// =====================================================
// LOADER FUNCTION
// =====================================================

/**
 * Get AI configuration for a call point.
 *
 * Resolution cascade (highest priority first, #1868):
 *   1. Playbook.config.aiOverrides[callPoint]
 *   2. Domain.config.aiOverrides[callPoint]
 *   3. AIConfig table (admin overrides via `/x/ai-config`)
 *   4. SystemSettings fallback (`fallback:ai.default_models`)
 *   5. CALL_POINTS hardcoded defaults (`call-points.ts`)
 *   6. Ultimate fallback (any available provider)
 *
 * Each layer may set ANY of `{provider, model, temperature, maxTokens,
 * timeoutMs}` — partial overrides are merged top-down per field. The
 * `modelLayer` field on the result reports who supplied the WINNING
 * model id (used by the Cascade Inspector Tray and PRs to debug
 * cascade-shadowing). Per `.claude/rules/ai-callpoint-cascade.md`.
 *
 * @param callPoint - The call point identifier (e.g., "pipeline.measure")
 * @param scope     - Optional cascade scope. When omitted, falls back to
 *                    the legacy flat lookup (no Playbook/Domain check).
 */
export async function getAIConfig(
  callPoint: string,
  scope?: AIConfigScope,
): Promise<AIConfigResult> {
  // Check cache first — scope is part of the key so per-Playbook /
  // per-Domain overrides do not collide.
  const ck = cacheKey(callPoint, scope);
  const cached = configCache.get(ck);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  // Expand scope + read Playbook/Domain overrides in one combined helper.
  let playbookOverride: AICallPointOverride | null = null;
  let domainOverride: AICallPointOverride | null = null;
  if (scope && (scope.callId || scope.playbookId || scope.domainId)) {
    const o = await readScopeOverrides(scope, callPoint);
    playbookOverride = o.playbookOverride;
    domainOverride = o.domainOverride;
  }

  // Load AIConfig table + fallbacks for layers 3-5.
  let dbConfig: Awaited<ReturnType<typeof prisma.aIConfig.findUnique>> = null;
  try {
    dbConfig = await prisma.aIConfig.findUnique({ where: { callPoint } });
  } catch (error) {
    console.warn(`[ai-config] Failed to load AIConfig for ${callPoint}:`, error);
  }
  const fallbackConfigs = await getAIModelConfigsFallback();
  const systemFallback = fallbackConfigs[callPoint];
  const hardcodedDefaults = DEFAULT_CONFIGS[callPoint];

  // Per-field cascade — first non-undefined wins, per field. Tracks which
  // layer supplied the model so the result carries provenance.
  type LayerName = "playbook" | "domain" | "global" | "system" | "hardcoded";
  function pickField<K extends keyof AICallPointOverride>(
    field: K,
  ): { value: AICallPointOverride[K] | undefined; layer: LayerName | null } {
    if (playbookOverride?.[field] !== undefined) return { value: playbookOverride[field], layer: "playbook" };
    if (domainOverride?.[field] !== undefined) return { value: domainOverride[field], layer: "domain" };
    const dbActive = dbConfig && dbConfig.isActive;
    if (field === "provider" && dbActive) return { value: (dbConfig!.provider as unknown) as AICallPointOverride[K], layer: "global" };
    if (field === "model" && dbActive) return { value: (dbConfig!.model as unknown) as AICallPointOverride[K], layer: "global" };
    if (field === "temperature" && dbActive && dbConfig!.temperature != null) return { value: (dbConfig!.temperature as unknown) as AICallPointOverride[K], layer: "global" };
    if (field === "maxTokens" && dbActive && dbConfig!.maxTokens != null) return { value: (dbConfig!.maxTokens as unknown) as AICallPointOverride[K], layer: "global" };
    if (field === "timeoutMs" && dbActive && dbConfig!.timeoutMs != null) return { value: (dbConfig!.timeoutMs as unknown) as AICallPointOverride[K], layer: "global" };
    if (systemFallback) {
      const v = (systemFallback as unknown as Record<string, unknown>)[field as string];
      if (v !== undefined) return { value: v as AICallPointOverride[K], layer: "system" };
    }
    if (hardcodedDefaults) {
      const v = (hardcodedDefaults as unknown as Record<string, unknown>)[field as string];
      if (v !== undefined) return { value: v as AICallPointOverride[K], layer: "hardcoded" };
    }
    return { value: undefined, layer: null };
  }

  const providerPick = pickField("provider");
  const modelPick = pickField("model");
  const temperaturePick = pickField("temperature");
  const maxTokensPick = pickField("maxTokens");
  const timeoutMsPick = pickField("timeoutMs");

  // Ultimate fallback — nothing at all configured.
  if (!providerPick.value || !modelPick.value) {
    const fallbackProvider = getDefaultEngine();
    const result: AIConfigResult = {
      provider: fallbackProvider,
      model: DEFAULT_MODELS[fallbackProvider],
      isCustomized: false,
      modelLayer: "ultimate",
    };
    configCache.set(ck, { config: result, fetchedAt: Date.now() });
    return result;
  }

  // Provider availability gate — if the chosen provider has no API key,
  // fall back. The model id may not match the fallback provider, but
  // that mirrors the pre-#1868 behaviour and is the safest bet.
  const { provider, model, fallbackUsed } = ensureAvailableProvider(
    providerPick.value as AIEngine,
    modelPick.value as string,
  );

  const result: AIConfigResult = {
    provider,
    model: fallbackUsed ? model : (modelPick.value as string),
    maxTokens: maxTokensPick.value as number | undefined,
    temperature: temperaturePick.value as number | undefined,
    timeoutMs: timeoutMsPick.value as number | undefined,
    isCustomized:
      !fallbackUsed && (modelPick.layer === "playbook" || modelPick.layer === "domain" || modelPick.layer === "global"),
    modelLayer: modelPick.layer ?? "ultimate",
  };
  configCache.set(ck, { config: result, fetchedAt: Date.now() });
  return result;
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

    for (const dbEntry of allConfigs) {
      const hardcodedDefaults = DEFAULT_CONFIGS[dbEntry.callPoint];
      const result: AIConfigResult = {
        provider: dbEntry.provider as AIEngine,
        model: dbEntry.model,
        maxTokens: dbEntry.maxTokens ?? undefined,
        temperature: dbEntry.temperature ?? undefined,
        timeoutMs: dbEntry.timeoutMs ?? hardcodedDefaults?.timeoutMs ?? undefined,
        isCustomized: true,
      };
      configCache.set(dbEntry.callPoint, { config: result, fetchedAt: Date.now() });
    }

    // Also cache defaults for unconfigured call points
    for (const [callPoint, defaultConfig] of Object.entries(DEFAULT_CONFIGS)) {
      if (!configCache.has(callPoint)) {
        configCache.set(callPoint, {
          config: {
            provider: defaultConfig.provider as AIEngine,
            model: defaultConfig.model,
            maxTokens: defaultConfig.maxTokens,
            temperature: defaultConfig.temperature,
            timeoutMs: defaultConfig.timeoutMs,
            isCustomized: false,
          },
          fetchedAt: Date.now(),
        });
      }
    }
  } catch (error) {
    console.warn("[ai-config] Failed to preload configs:", error);
  }
}
