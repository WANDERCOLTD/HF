/**
 * API for managing AI models
 *
 * GET: List all available models (optionally filter by provider)
 * POST: Create a new model
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

// Default models to seed if table is empty
const DEFAULT_MODELS = [
  // Claude models (active as of Feb 2026 — see platform.claude.com/docs/en/about-claude/model-deprecations)
  { modelId: "claude-sonnet-4-20250514", provider: "claude", label: "Claude Sonnet 4", tier: "flagship", sortOrder: 1, maxOutputTokens: 16384 },
  { modelId: "claude-haiku-4-5-20251001", provider: "claude", label: "Claude Haiku 4.5", tier: "fast", sortOrder: 2, maxOutputTokens: 8192 },
  // OpenAI models
  { modelId: "gpt-4o", provider: "openai", label: "GPT-4o", tier: "flagship", sortOrder: 1, maxOutputTokens: 16384 },
  { modelId: "gpt-4o-mini", provider: "openai", label: "GPT-4o Mini", tier: "fast", sortOrder: 2, maxOutputTokens: 16384 },
  // Mock models
  { modelId: "mock-model", provider: "mock", label: "Mock Model", tier: "test", sortOrder: 1, maxOutputTokens: 4096 },
];

// Available providers
export const PROVIDERS = [
  { id: "claude", label: "Anthropic Claude", color: "#D97706" },
  { id: "openai", label: "OpenAI", color: "#10B981" },
  { id: "mock", label: "Mock (Testing)", color: "#6B7280" },
];

/**
 * @api GET /api/ai-models
 * @visibility internal
 * @scope ai-models:read
 * @auth session
 * @tags ai
 * @description List all available AI models, optionally filtered by provider. Seeds default models on first access if the table is empty. Returns models grouped by provider for UI consumption.
 * @query provider string - Filter by provider (optional)
 * @query includeInactive string - Include inactive models ("true" to include, default: false)
 * @response 200 { ok: true, models: [...], byProvider: {...}, providers: [...] }
 * @response 500 { ok: false, error: "Failed to fetch models" }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const includeInactive = searchParams.get("includeInactive") === "true";

    // Check if we have any models, seed if not
    const count = await prisma.aIModel.count();
    if (count === 0) {
      await seedDefaultModels();
    }

    // Build query
    const where: any = {};
    if (provider) {
      where.provider = provider;
    }
    if (!includeInactive) {
      where.isActive = true;
    }

    const models = await prisma.aIModel.findMany({
      where,
      orderBy: [{ provider: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    });

    // Group by provider for easier UI consumption
    const byProvider: Record<string, typeof models> = {};
    for (const model of models) {
      if (!byProvider[model.provider]) {
        byProvider[model.provider] = [];
      }
      byProvider[model.provider].push(model);
    }

    return NextResponse.json({
      ok: true,
      models,
      byProvider,
      providers: PROVIDERS,
    });
  } catch (error: unknown) {
    console.error("[ai-models] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch models" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/ai-models
 * @visibility internal
 * @scope ai-models:write
 * @auth bearer
 * @tags ai
 * @description Create a new AI model record. Validates provider and tier, and checks for duplicate modelId before inserting.
 * @body modelId string - Unique model identifier (e.g. "gpt-4o")
 * @body provider string - Provider name ("claude" | "openai" | "mock")
 * @body label string - Human-readable model label
 * @body tier string - Model tier ("flagship" | "standard" | "fast" | "test"), default "standard"
 * @body sortOrder number - Display sort order (default 99)
 * @body isActive boolean - Whether the model is active (default true)
 * @response 200 { ok: true, model: {...} }
 * @response 400 { ok: false, error: "modelId, provider, and label are required" }
 * @response 409 { ok: false, error: "Model with ID \"...\" already exists" }
 * @response 500 { ok: false, error: "Failed to create model" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const { modelId, provider, label, tier, sortOrder, isActive } = body;

    // Validate required fields
    if (!modelId || !provider || !label) {
      return NextResponse.json(
        { ok: false, error: "modelId, provider, and label are required" },
        { status: 400 }
      );
    }

    // Validate provider
    const validProviders = PROVIDERS.map((p) => p.id);
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { ok: false, error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate tier
    const validTiers = ["flagship", "standard", "fast", "test"];
    if (tier && !validTiers.includes(tier)) {
      return NextResponse.json(
        { ok: false, error: `Invalid tier. Must be one of: ${validTiers.join(", ")}` },
        { status: 400 }
      );
    }

    // Check for duplicate
    const existing = await prisma.aIModel.findUnique({
      where: { modelId },
    });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: `Model with ID "${modelId}" already exists` },
        { status: 409 }
      );
    }

    // Create model
    const model = await prisma.aIModel.create({
      data: {
        modelId,
        provider,
        label,
        tier: tier || "standard",
        sortOrder: sortOrder ?? 99,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({ ok: true, model });
  } catch (error: unknown) {
    console.error("[ai-models] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create model" },
      { status: 500 }
    );
  }
}

/**
 * Seed default models into the database
 */
async function seedDefaultModels() {
  console.log("[ai-models] Seeding default models...");

  for (const model of DEFAULT_MODELS) {
    await prisma.aIModel.upsert({
      where: { modelId: model.modelId },
      update: {},
      create: {
        ...model,
        isActive: true,
      },
    });
  }

  console.log(`[ai-models] Seeded ${DEFAULT_MODELS.length} default models`);
}
