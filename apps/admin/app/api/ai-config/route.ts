/**
 * AI Configuration API
 *
 * Manages per-call-point AI model settings.
 * Allows admins to configure which AI provider/model to use for each operation.
 *
 * GET    - List all configurations (with defaults for unconfigured call points)
 * POST   - Create or update a configuration
 * DELETE - Remove a configuration (reverts to default)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearAIConfigCache } from "@/lib/ai/config-loader";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";
import {
  CALL_POINTS,
  AI_CONFIG_CATEGORY_META,
  type AIConfigCategory,
} from "@/lib/ai/call-points";

// Re-export for any code that imported from this file
export { AI_CONFIG_CATEGORY_META, type AIConfigCategory };

// =====================================================
// CALL POINT DEFINITIONS (derived from canonical registry)
// =====================================================

/**
 * All configurable AI call points in the system.
 * Derived from the canonical CALL_POINTS registry in lib/ai/call-points.ts.
 * Shape maintained for backward compatibility with existing GET response.
 */
export const AI_CALL_POINTS = CALL_POINTS.map((cp) => ({
  callPoint: cp.id,
  label: cp.label,
  description: cp.description,
  defaultProvider: cp.defaults.provider,
  defaultModel: cp.defaults.model,
  ...(cp.defaultTranscriptLimit != null ? { defaultTranscriptLimit: cp.defaultTranscriptLimit } : {}),
  category: cp.category as AIConfigCategory,
}));

// Hardcoded fallback models (used if DB is empty)
// These are seeded to the AIModel table on first access via /api/ai-models
export const AVAILABLE_MODELS = {
  claude: [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", tier: "flagship", maxOutputTokens: 64000 },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "fast", maxOutputTokens: 8192 },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", tier: "flagship", maxOutputTokens: 16384 },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", tier: "fast", maxOutputTokens: 16384 },
  ],
  mock: [
    { id: "mock-model", label: "Mock (Testing)", tier: "test", maxOutputTokens: 4096 },
  ],
} as const;

type ModelEntry = { id: string; label: string; tier: string; maxOutputTokens: number | null };
type ModelMap = Record<string, ModelEntry[]>;

/** Convert the `as const` AVAILABLE_MODELS into a mutable ModelMap. */
function staticModelsToMap(): ModelMap {
  const result: ModelMap = {};
  for (const [provider, list] of Object.entries(AVAILABLE_MODELS)) {
    result[provider] = list.map((m) => ({ ...m, maxOutputTokens: m.maxOutputTokens as number | null }));
  }
  return result;
}

/**
 * Fetch available models from database, grouped by provider.
 * Falls back to hardcoded AVAILABLE_MODELS if DB is empty.
 */
async function getAvailableModels(): Promise<ModelMap> {
  try {
    const models = await prisma.aIModel.findMany({
      where: { isActive: true },
      orderBy: [{ provider: "asc" }, { sortOrder: "asc" }],
    });

    if (models.length === 0) {
      return staticModelsToMap();
    }

    // Group by provider
    const byProvider: ModelMap = {};
    for (const model of models) {
      if (!byProvider[model.provider]) {
        byProvider[model.provider] = [];
      }
      byProvider[model.provider].push({
        id: model.modelId,
        label: model.label,
        tier: model.tier,
        maxOutputTokens: model.maxOutputTokens,
      });
    }

    return byProvider;
  } catch (error) {
    console.error("[ai-config] Error fetching models from DB, using fallback:", error);
    return staticModelsToMap();
  }
}

/**
 * Look up the maxOutputTokens for a given model across all providers.
 */
async function getModelMaxOutputTokens(provider: string, modelId: string): Promise<number | null> {
  const availableModels = await getAvailableModels();
  const providerModels = availableModels[provider];
  if (!providerModels) return null;
  const model = providerModels.find((m) => m.id === modelId);
  return model?.maxOutputTokens ?? null;
}

export type CallPointId = string;

// =====================================================
// GET - List all configurations
// =====================================================

/**
 * @api GET /api/ai-config
 * @visibility internal
 * @scope ai-config:read
 * @auth session
 * @tags ai
 * @description List all AI call-point configurations, merged with defaults for unconfigured points. Returns available models and API key status per provider.
 * @response 200 { ok: true, configs: [...], availableModels: {...}, callPoints: [...], keyStatus: {...} }
 * @response 500 { ok: false, error: "Failed to fetch AI configurations" }
 */
export async function GET() {
  try {
    const authResult = await requireEntityAccess("ai_config", "R");
    if (isEntityAuthError(authResult)) return authResult.error;

    // Fetch all saved configurations and available models in parallel
    const [savedConfigs, availableModels] = await Promise.all([
      prisma.aIConfig.findMany({
        orderBy: { callPoint: "asc" },
      }),
      getAvailableModels(),
    ]);

    // Check which providers have API keys configured
    const keyStatus: Record<string, boolean> = {
      claude: !!process.env.ANTHROPIC_API_KEY,
      openai: !!(process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY),
      mock: true, // Mock always available
    };

    // Create a map for quick lookup
    const configMap = new Map(savedConfigs.map((c) => [c.callPoint, c]));

    // Merge with defaults to show all call points
    const allConfigs = AI_CALL_POINTS.map((def) => {
      const saved = configMap.get(def.callPoint);
      const provider = saved?.provider ?? def.defaultProvider;
      return {
        callPoint: def.callPoint,
        label: def.label,
        description: def.description,
        category: def.category,
        // Use saved values or defaults
        provider,
        model: saved?.model ?? def.defaultModel,
        maxTokens: saved?.maxTokens ?? null,
        temperature: saved?.temperature ?? null,
        transcriptLimit: saved?.transcriptLimit ?? null,
        timeoutMs: saved?.timeoutMs ?? null,
        isActive: saved?.isActive ?? true,
        // Metadata
        isCustomized: !!saved,
        savedId: saved?.id ?? null,
        updatedAt: saved?.updatedAt ?? null,
        // Defaults for reference
        defaultProvider: def.defaultProvider,
        defaultModel: def.defaultModel,
        defaultTranscriptLimit: (def as any).defaultTranscriptLimit ?? null,
        // Key availability for this config's provider
        hasKey: keyStatus[provider] ?? false,
      };
    });

    return NextResponse.json({
      ok: true,
      configs: allConfigs,
      availableModels,
      callPoints: AI_CALL_POINTS,
      keyStatus, // Which providers have keys configured
      categoryMeta: AI_CONFIG_CATEGORY_META,
    });
  } catch (error) {
    console.error("[ai-config] GET error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch AI configurations" },
      { status: 500 }
    );
  }
}

// =====================================================
// POST - Create or update configuration
// =====================================================

interface UpdateConfigBody {
  callPoint: string;
  provider: string;
  model: string;
  maxTokens?: number | null;
  temperature?: number | null;
  transcriptLimit?: number | null;
  timeoutMs?: number | null;
  isActive?: boolean;
}

/**
 * @api POST /api/ai-config
 * @visibility internal
 * @scope ai-config:write
 * @auth session
 * @tags ai
 * @description Create or update an AI configuration for a specific call point. Validates provider, model, and call point before upserting.
 * @body callPoint string - The call point identifier (e.g. "pipeline.measure")
 * @body provider string - AI provider ("claude" | "openai" | "mock")
 * @body model string - Model identifier (must exist for the chosen provider)
 * @body maxTokens number|null - Optional max token limit
 * @body temperature number|null - Optional temperature setting
 * @body transcriptLimit number|null - Optional transcript character limit
 * @body timeoutMs number|null - Optional timeout in milliseconds (1000–300000)
 * @body isActive boolean - Whether this config is active (default true)
 * @response 200 { ok: true, config: {...}, message: "Updated AI config for ..." }
 * @response 400 { ok: false, error: "Invalid callPoint: ..." }
 * @response 500 { ok: false, error: "Failed to update AI configuration" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireEntityAccess("ai_config", "U");
    if (isEntityAuthError(authResult)) return authResult.error;

    const body: UpdateConfigBody = await request.json();

    // Validate callPoint
    const callPointDef = AI_CALL_POINTS.find((cp) => cp.callPoint === body.callPoint);
    if (!callPointDef) {
      return NextResponse.json(
        { ok: false, error: `Invalid callPoint: ${body.callPoint}` },
        { status: 400 }
      );
    }

    // Validate provider
    if (!["claude", "openai", "mock"].includes(body.provider)) {
      return NextResponse.json(
        { ok: false, error: `Invalid provider: ${body.provider}` },
        { status: 400 }
      );
    }

    // Validate model exists for provider (check DB first, fallback to hardcoded)
    const availableModels = await getAvailableModels();
    const providerModels = availableModels[body.provider];
    if (!providerModels?.some((m) => m.id === body.model)) {
      return NextResponse.json(
        { ok: false, error: `Invalid model ${body.model} for provider ${body.provider}` },
        { status: 400 }
      );
    }

    // Validate maxTokens against model's output token limit
    if (body.maxTokens != null && body.maxTokens > 0) {
      const modelDef = providerModels?.find((m) => m.id === body.model);
      const maxOutput = modelDef?.maxOutputTokens;
      if (maxOutput && body.maxTokens > maxOutput) {
        return NextResponse.json(
          { ok: false, error: `maxTokens (${body.maxTokens}) exceeds ${modelDef?.label ?? body.model} output limit of ${maxOutput}` },
          { status: 400 }
        );
      }
    }

    // Validate timeoutMs bounds
    if (body.timeoutMs != null && (body.timeoutMs < 1000 || body.timeoutMs > 300000)) {
      return NextResponse.json(
        { ok: false, error: `timeoutMs must be between 1000 and 300000 (1s–5min)` },
        { status: 400 }
      );
    }

    // Upsert the configuration
    const aiConfig = await prisma.aIConfig.upsert({
      where: { callPoint: body.callPoint },
      create: {
        callPoint: body.callPoint,
        label: callPointDef.label,
        provider: body.provider,
        model: body.model,
        maxTokens: body.maxTokens ?? null,
        temperature: body.temperature ?? null,
        transcriptLimit: body.transcriptLimit ?? null,
        timeoutMs: body.timeoutMs ?? null,
        isActive: body.isActive ?? true,
        description: callPointDef.description,
      },
      update: {
        provider: body.provider,
        model: body.model,
        maxTokens: body.maxTokens ?? null,
        temperature: body.temperature ?? null,
        transcriptLimit: body.transcriptLimit ?? null,
        timeoutMs: body.timeoutMs ?? null,
        isActive: body.isActive ?? true,
      },
    });

    // Invalidate AI config cache so new settings take effect immediately
    clearAIConfigCache();

    return NextResponse.json({
      ok: true,
      config: aiConfig,
      message: `Updated AI config for ${callPointDef.label}`,
    });
  } catch (error) {
    console.error("[ai-config] POST error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update AI configuration" },
      { status: 500 }
    );
  }
}

// =====================================================
// DELETE - Remove configuration (revert to default)
// =====================================================

/**
 * @api DELETE /api/ai-config
 * @visibility internal
 * @scope ai-config:write
 * @auth session
 * @tags ai
 * @description Remove a custom AI configuration for a call point, reverting it to default settings.
 * @query callPoint string - The call point to revert (required)
 * @response 200 { ok: true, message: "Reverted ... to default settings" }
 * @response 400 { ok: false, error: "callPoint query parameter is required" }
 * @response 404 { ok: false, error: "No custom config found for ..." }
 * @response 500 { ok: false, error: "Failed to delete AI configuration" }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireEntityAccess("ai_config", "D");
    if (isEntityAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const callPoint = searchParams.get("callPoint");

    if (!callPoint) {
      return NextResponse.json(
        { ok: false, error: "callPoint query parameter is required" },
        { status: 400 }
      );
    }

    // Find and delete
    const existing = await prisma.aIConfig.findUnique({
      where: { callPoint },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: `No custom config found for ${callPoint}` },
        { status: 404 }
      );
    }

    await prisma.aIConfig.delete({
      where: { callPoint },
    });

    // Invalidate AI config cache so revert takes effect immediately
    clearAIConfigCache();

    return NextResponse.json({
      ok: true,
      message: `Reverted ${callPoint} to default settings`,
    });
  } catch (error) {
    console.error("[ai-config] DELETE error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to delete AI configuration" },
      { status: 500 }
    );
  }
}
