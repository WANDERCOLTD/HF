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
import { config } from "@/lib/config";

// =====================================================
// CATEGORIES (user-intent grouping for the /x/ai-config UI)
// =====================================================

export type AIConfigCategory =
  | "conversation"
  | "call-analysis"
  | "content-processing"
  | "course-setup"
  | "admin-ai"
  | "advanced";

export const AI_CONFIG_CATEGORY_META: Record<AIConfigCategory, { label: string; order: number; description: string }> = {
  "conversation":       { label: "Conversation AI",    order: 0, description: "Powers the live tutoring experience" },
  "call-analysis":      { label: "Call Analysis",      order: 1, description: "What the system learns after each call" },
  "content-processing": { label: "Content Processing", order: 2, description: "Analysing and structuring uploaded documents" },
  "course-setup":       { label: "Course Setup",       order: 3, description: "Building curriculum, lesson plans, and courses" },
  "admin-ai":           { label: "Admin AI",           order: 4, description: "AI tools that help administrators" },
  "advanced":           { label: "Advanced",           order: 5, description: "Specs, standalone analysis, developer tools" },
};

// =====================================================
// CALL POINT DEFINITIONS
// =====================================================

/**
 * All configurable AI call points in the system.
 * Each has a unique ID, label, description, category, and default settings.
 */
export const AI_CALL_POINTS = [
  // ── Call Analysis ──
  {
    callPoint: "pipeline.measure",
    label: "Pipeline - MEASURE",
    description: "Scores caller parameters from transcript (Big 5 personality, engagement, etc.)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    defaultTranscriptLimit: 4000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.learn",
    label: "Pipeline - LEARN",
    description: "Extracts facts and memories about the caller from transcript",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    defaultTranscriptLimit: 4000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.score_agent",
    label: "Pipeline - SCORE_AGENT",
    description: "Evaluates agent behavior against targets (warmth, empathy, etc.)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    defaultTranscriptLimit: 4000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.adapt",
    label: "Pipeline - ADAPT",
    description: "Computes personalized behavior targets based on caller profile",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    defaultTranscriptLimit: 2000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.extract_goals",
    label: "Pipeline - Goal Extraction",
    description: "Extracts learner goals from transcript",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    defaultTranscriptLimit: 3000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.artifacts",
    label: "Pipeline - Artifact Extraction",
    description: "Extracts conversation artifacts (summaries, facts, exercises) to share with the learner",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    defaultTranscriptLimit: 4000,
    category: "call-analysis" as AIConfigCategory,
  },
  {
    callPoint: "pipeline.actions",
    label: "Pipeline - Action Extraction",
    description: "Extracts actionable items (homework, follow-ups, tasks, reminders) from call transcripts",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    defaultTranscriptLimit: 4000,
    category: "call-analysis" as AIConfigCategory,
  },
  // ── Conversation AI ──
  {
    callPoint: "compose.prompt",
    label: "Prompt Composition",
    description: "Generates personalized agent guidance prompts",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "conversation" as AIConfigCategory,
  },
  // ── Advanced ──
  {
    callPoint: "analysis.measure",
    label: "Analysis - MEASURE",
    description: "Standalone parameter scoring (used by /api/analysis/run)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "analysis.learn",
    label: "Analysis - LEARN",
    description: "Standalone memory extraction (used by /api/analysis/run)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "parameter.enrich",
    label: "Parameter Enrichment",
    description: "Enriches parameter definitions with KB context",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "bdd.parse",
    label: "BDD Parser",
    description: "Parses BDD specifications into structured data",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "advanced" as AIConfigCategory,
  },
  // ── Admin AI ──
  {
    callPoint: "chat.stream",
    label: "Chat (Streaming)",
    description: "Interactive chat completions with streaming",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "spec.assistant",
    label: "Spec Creation Assistant",
    description: "AI assistant for creating and editing BDD specifications",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "spec.view",
    label: "Spec View Assistant",
    description: "AI assistant for viewing and understanding BDD specifications",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "spec.extract",
    label: "Spec Structure Extraction",
    description: "Converts raw documents into structured BDD specification JSON",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "spec.parse",
    label: "Spec Document Parser",
    description: "Detects document type for BDD spec conversion (CURRICULUM, MEASURE, etc.)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "advanced" as AIConfigCategory,
  },
  {
    callPoint: "chat.data",
    label: "Chat - Data",
    description: "Data exploration mode with tool calling in the chat panel",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "chat.call",
    label: "Chat - Call Analysis",
    description: "Call analysis mode in the chat panel",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "assistant.chat",
    label: "AI Assistant - General",
    description: "General-purpose AI assistant with system context awareness",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "assistant.tasks",
    label: "AI Assistant - Tasks",
    description: "Task-focused AI assistant for workflow completion",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "assistant.data",
    label: "AI Assistant - Data",
    description: "Data exploration AI assistant for querying and understanding system data",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "assistant.spec",
    label: "AI Assistant - Spec",
    description: "Spec-focused AI assistant for spec creation and troubleshooting",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  // ── Content Processing ──
  {
    callPoint: "content-trust.classify",
    label: "Content Trust - Classify",
    description: "Classifies document type (CURRICULUM, TEXTBOOK, etc.) from text sample",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "content-processing" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.extract",
    label: "Content Trust - Extraction",
    description: "Extracts assertions from training materials for content trust verification",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "content-processing" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.segment",
    label: "Content Trust - Segment",
    description: "Segments composite documents into logical sections for targeted extraction",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "content-processing" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.structure",
    label: "Content Trust - Structure",
    description: "Structures extracted assertions into hierarchical topics and modules",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "content-processing" as AIConfigCategory,
  },
  {
    callPoint: "content-sources.suggest",
    label: "Content Sources - Suggest",
    description: "Suggests content source metadata from document text",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "content-processing" as AIConfigCategory,
  },
  // ── Course Setup ──
  {
    callPoint: "content-trust.curriculum",
    label: "Content Trust - Curriculum",
    description: "Generates structured curriculum from extracted assertions",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel, // lightModel for market test — matches config-loader
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.curriculum-from-goals",
    label: "Content Trust - Curriculum from Goals",
    description: "Generates structured curriculum from subject + persona + learning goals (no document upload)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel, // lightModel for market test — matches config-loader
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.curriculum-skeleton",
    label: "Content Trust - Curriculum Skeleton",
    description: "Fast skeleton curriculum (titles + descriptions only) using lightweight model. Detail added async.",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "content-trust.lesson-plan",
    label: "Content Trust - Lesson Plan",
    description: "Generates lesson plan structure from curriculum assertions",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "lesson-plan.generate",
    label: "Lesson Plan - Generate",
    description: "AI-generates a structured lesson plan from curriculum modules",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "targets.suggest",
    label: "Targets - Suggest",
    description: "Suggests adaptation targets for a playbook based on spec parameters",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "quick-launch.suggest-name",
    label: "Quick Launch - Suggest Name",
    description: "Suggests a short course name from a free-text brief",
    defaultProvider: "claude",
    defaultModel: "claude-haiku-4-5-20251001",
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "quick-launch.identity",
    label: "Quick Launch - Identity",
    description: "Generates agent identity configuration from domain assertions",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "course-setup" as AIConfigCategory,
  },
  {
    callPoint: "demonstrate.suggest",
    label: "Demonstrate - Suggest Goals",
    description: "Suggests session goals for the demonstrate flow",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.lightModel,
    category: "course-setup" as AIConfigCategory,
  },
  // ── Conversation AI (continued) ──
  {
    callPoint: "test-harness.system",
    label: "Test Harness - System Agent",
    description: "System agent turns in simulated conversations",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "conversation" as AIConfigCategory,
  },
  {
    callPoint: "test-harness.caller",
    label: "Test Harness - Caller Persona",
    description: "Caller persona turns in simulated conversations",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "conversation" as AIConfigCategory,
  },
  {
    callPoint: "test-harness.greeting",
    label: "Test Harness - Greeting",
    description: "Initial AI greeting for onboarding calls",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "conversation" as AIConfigCategory,
  },
  // ── Admin AI (continued) ──
  {
    callPoint: "workflow.classify",
    label: "Workflow - Discovery & Planning",
    description: "Multi-turn discovery conversation that understands user intent and generates guided workflow plans",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "workflow.step",
    label: "Workflow - Step Guidance",
    description: "Per-step AI guidance during workflow execution (field suggestions, validation help, context)",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "workflow.step-guidance",
    label: "Workflow - Step Guidance (Active)",
    description: "Per-step AI guidance during active workflow execution",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
  {
    callPoint: "chat.bug",
    label: "Chat - Bug Report",
    description: "Bug report analysis mode in the chat panel",
    defaultProvider: "claude",
    defaultModel: config.ai.claude.model,
    category: "admin-ai" as AIConfigCategory,
  },
];

// Hardcoded fallback models (used if DB is empty)
// These are seeded to the AIModel table on first access via /api/ai-models
export const AVAILABLE_MODELS = {
  claude: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", tier: "flagship", maxOutputTokens: 16384 },
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

/**
 * Fetch available models from database, grouped by provider.
 * Falls back to hardcoded AVAILABLE_MODELS if DB is empty.
 */
async function getAvailableModels(): Promise<Record<string, Array<{ id: string; label: string; tier: string; maxOutputTokens: number | null }>>> {
  try {
    const models = await prisma.aIModel.findMany({
      where: { isActive: true },
      orderBy: [{ provider: "asc" }, { sortOrder: "asc" }],
    });

    if (models.length === 0) {
      // Return hardcoded fallback
      return AVAILABLE_MODELS as any;
    }

    // Group by provider
    const byProvider: Record<string, Array<{ id: string; label: string; tier: string; maxOutputTokens: number | null }>> = {};
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
    return AVAILABLE_MODELS as any;
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
        isActive: body.isActive ?? true,
        description: callPointDef.description,
      },
      update: {
        provider: body.provider,
        model: body.model,
        maxTokens: body.maxTokens ?? null,
        temperature: body.temperature ?? null,
        transcriptLimit: body.transcriptLimit ?? null,
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
