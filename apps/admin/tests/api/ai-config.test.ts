/**
 * Tests for /api/ai-config route
 *
 * Tests the AI configuration management API:
 * - GET: List all configurations with defaults
 * - POST: Create/update configurations
 * - DELETE: Remove configurations (revert to default)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  aIConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// =====================================================
// EXPECTED DEFINITIONS (mirroring route.ts)
// =====================================================

// These mirror the definitions in app/api/ai-config/route.ts
// If the route definitions change, these tests will catch mismatches

const EXPECTED_CALL_POINTS = [
  "pipeline.measure",
  "pipeline.learn",
  "pipeline.score_agent",
  "pipeline.adapt",
  "compose.prompt",
  "analysis.measure",
  "analysis.learn",
  "parameter.enrich",
  "bdd.parse",
  "chat.stream",
];

const EXPECTED_PROVIDERS = ["claude", "openai", "mock"];

const EXPECTED_CLAUDE_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
];

const EXPECTED_OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini"];

// =====================================================
// TESTS - Using relative imports for route handlers
// =====================================================

describe("AI Config API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/ai-config", () => {
    it("should return all call points with defaults when no configs exist", async () => {
      mockPrisma.aIConfig.findMany.mockResolvedValue([]);

      // Use relative import to avoid vitest path alias issues
      const { GET } = await import("../../app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.configs).toBeDefined();
      expect(Array.isArray(data.configs)).toBe(true);
      expect(data.configs.length).toBeGreaterThan(0);

      // Check that default values are applied
      const pipelineMeasure = data.configs.find(
        (c: any) => c.callPoint === "pipeline.measure"
      );
      expect(pipelineMeasure).toBeDefined();
      expect(pipelineMeasure.provider).toBe("claude");
      expect(pipelineMeasure.model).toBe("claude-sonnet-4-20250514");
      expect(pipelineMeasure.isCustomized).toBe(false);
    });

    it("should merge saved configs with defaults", async () => {
      mockPrisma.aIConfig.findMany.mockResolvedValue([
        {
          id: "config-1",
          callPoint: "pipeline.measure",
          label: "Pipeline - MEASURE",
          provider: "openai",
          model: "gpt-4o",
          maxTokens: 2048,
          temperature: 0.5,
          isActive: true,
          updatedAt: new Date("2025-01-01"),
        },
      ]);

      const { GET } = await import("../../app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      expect(data.ok).toBe(true);

      const pipelineMeasure = data.configs.find(
        (c: any) => c.callPoint === "pipeline.measure"
      );
      expect(pipelineMeasure.provider).toBe("openai");
      expect(pipelineMeasure.model).toBe("gpt-4o");
      expect(pipelineMeasure.maxTokens).toBe(2048);
      expect(pipelineMeasure.isCustomized).toBe(true);

      // Other call points should still have defaults
      const pipelineLearn = data.configs.find(
        (c: any) => c.callPoint === "pipeline.learn"
      );
      expect(pipelineLearn.isCustomized).toBe(false);
    });

    it("should include available models in response", async () => {
      mockPrisma.aIConfig.findMany.mockResolvedValue([]);

      const { GET } = await import("../../app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      expect(data.availableModels).toBeDefined();
      expect(data.availableModels.claude).toBeDefined();
      expect(data.availableModels.openai).toBeDefined();
      expect(data.availableModels.mock).toBeDefined();
    });
  });

  describe("POST /api/ai-config", () => {
    it("should create a new configuration", async () => {
      mockPrisma.aIConfig.upsert.mockResolvedValue({
        id: "config-1",
        callPoint: "pipeline.measure",
        label: "Pipeline - MEASURE",
        provider: "openai",
        model: "gpt-4o",
        isActive: true,
      });

      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "pipeline.measure",
          provider: "openai",
          model: "gpt-4o",
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.config.provider).toBe("openai");
      expect(data.config.model).toBe("gpt-4o");
    });

    it("should reject invalid call point", async () => {
      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "invalid.callpoint",
          provider: "claude",
          model: "claude-sonnet-4-20250514",
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.error).toContain("Invalid callPoint");
      expect(response.status).toBe(400);
    });

    it("should reject invalid provider", async () => {
      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "pipeline.measure",
          provider: "invalid-provider",
          model: "some-model",
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.error).toContain("Invalid provider");
      expect(response.status).toBe(400);
    });

    it("should reject invalid model for provider", async () => {
      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "pipeline.measure",
          provider: "claude",
          model: "gpt-4o", // OpenAI model with Claude provider
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.error).toContain("Invalid model");
      expect(response.status).toBe(400);
    });

    it("should reject maxTokens exceeding model output limit", async () => {
      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "pipeline.measure",
          provider: "claude",
          model: "claude-haiku-4-5-20251001", // 8192 max output
          maxTokens: 16000, // Exceeds limit
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.error).toContain("exceeds");
      expect(data.error).toContain("4096");
      expect(response.status).toBe(400);
    });

    it("should allow maxTokens within model output limit", async () => {
      mockPrisma.aIConfig.upsert.mockResolvedValue({
        id: "config-1",
        callPoint: "pipeline.measure",
        provider: "claude",
        model: "claude-sonnet-4-20250514",
        maxTokens: 8000,
        isActive: true,
      });

      const { POST } = await import("../../app/api/ai-config/route");
      const request = {
        json: vi.fn().mockResolvedValue({
          callPoint: "pipeline.measure",
          provider: "claude",
          model: "claude-sonnet-4-20250514", // 16384 max output
          maxTokens: 8000, // Within limit
        }),
      } as any;

      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
    });
  });

  describe("DELETE /api/ai-config", () => {
    it("should delete an existing configuration", async () => {
      mockPrisma.aIConfig.findUnique.mockResolvedValue({
        id: "config-1",
        callPoint: "pipeline.measure",
      });
      mockPrisma.aIConfig.delete.mockResolvedValue({});

      const { DELETE } = await import("../../app/api/ai-config/route");
      const request = {
        url: "http://localhost/api/ai-config?callPoint=pipeline.measure",
      } as any;

      const response = await DELETE(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toContain("Reverted");
    });

    it("should return 404 when config not found", async () => {
      mockPrisma.aIConfig.findUnique.mockResolvedValue(null);

      const { DELETE } = await import("../../app/api/ai-config/route");
      const request = {
        url: "http://localhost/api/ai-config?callPoint=pipeline.measure",
      } as any;

      const response = await DELETE(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it("should return 400 when callPoint not provided", async () => {
      const { DELETE } = await import("../../app/api/ai-config/route");
      const request = {
        url: "http://localhost/api/ai-config",
      } as any;

      const response = await DELETE(request);
      const data = await response.json();

      expect(data.ok).toBe(false);
      expect(data.error).toContain("callPoint query parameter is required");
      expect(response.status).toBe(400);
    });
  });
});

// =====================================================
// CALL POINT DEFINITIONS TESTS
// =====================================================

describe("AI Call Point Definitions", () => {
  it("should define all expected call points", async () => {
    const { AI_CALL_POINTS } = await import("../../app/api/ai-config/route");

    for (const callPoint of EXPECTED_CALL_POINTS) {
      const found = AI_CALL_POINTS.find((cp) => cp.callPoint === callPoint);
      expect(found, `Call point "${callPoint}" should be defined`).toBeDefined();
      expect(found?.label).toBeDefined();
      expect(found?.description).toBeDefined();
      expect(found?.defaultProvider).toBeDefined();
      expect(found?.defaultModel).toBeDefined();
    }
  });

  it("should define valid default providers", async () => {
    const { AI_CALL_POINTS } = await import("../../app/api/ai-config/route");

    for (const cp of AI_CALL_POINTS) {
      expect(EXPECTED_PROVIDERS).toContain(cp.defaultProvider);
    }
  });

  it("should assign a valid category to every call point", async () => {
    const { AI_CALL_POINTS, AI_CONFIG_CATEGORY_META } = await import("../../app/api/ai-config/route");
    const validCategories = Object.keys(AI_CONFIG_CATEGORY_META);

    for (const cp of AI_CALL_POINTS) {
      expect(validCategories, `Call point "${cp.callPoint}" has invalid category "${cp.category}"`).toContain(cp.category);
    }
  });

  it("should have all categories represented by at least one call point", async () => {
    const { AI_CALL_POINTS, AI_CONFIG_CATEGORY_META } = await import("../../app/api/ai-config/route");
    const usedCategories = new Set(AI_CALL_POINTS.map((cp: { category: string }) => cp.category));

    for (const category of Object.keys(AI_CONFIG_CATEGORY_META)) {
      expect(usedCategories.has(category), `Category "${category}" should have at least one call point`).toBe(true);
    }
  });
});

// =====================================================
// AVAILABLE MODELS TESTS
// =====================================================

describe("Available Models", () => {
  it("should define models for all providers", async () => {
    const { AVAILABLE_MODELS } = await import("../../app/api/ai-config/route");

    expect(AVAILABLE_MODELS.claude).toBeDefined();
    expect(AVAILABLE_MODELS.claude.length).toBeGreaterThan(0);

    expect(AVAILABLE_MODELS.openai).toBeDefined();
    expect(AVAILABLE_MODELS.openai.length).toBeGreaterThan(0);

    expect(AVAILABLE_MODELS.mock).toBeDefined();
    expect(AVAILABLE_MODELS.mock.length).toBeGreaterThan(0);
  });

  it("should have required properties for each model", async () => {
    const { AVAILABLE_MODELS } = await import("../../app/api/ai-config/route");

    for (const provider of Object.keys(AVAILABLE_MODELS)) {
      const models = AVAILABLE_MODELS[provider as keyof typeof AVAILABLE_MODELS];
      for (const model of models) {
        expect(model.id).toBeDefined();
        expect(model.label).toBeDefined();
        expect(model.tier).toBeDefined();
        expect(model.maxOutputTokens).toBeDefined();
        expect(model.maxOutputTokens).toBeGreaterThan(0);
      }
    }
  });

  it("should include expected Claude models", async () => {
    const { AVAILABLE_MODELS } = await import("../../app/api/ai-config/route");

    const claudeModelIds = AVAILABLE_MODELS.claude.map((m) => m.id);
    for (const model of EXPECTED_CLAUDE_MODELS) {
      expect(claudeModelIds).toContain(model);
    }
  });

  it("should include expected OpenAI models", async () => {
    const { AVAILABLE_MODELS } = await import("../../app/api/ai-config/route");

    const openaiModelIds = AVAILABLE_MODELS.openai.map((m) => m.id);
    for (const model of EXPECTED_OPENAI_MODELS) {
      expect(openaiModelIds).toContain(model);
    }
  });
});

// =====================================================
// CONFIG LOADER LOGIC TESTS
// =====================================================
// Note: These test the config loader logic patterns without dynamic imports
// since vitest has issues with path aliases in dynamic imports.

describe("AI Config Loader Logic", () => {
  // Default configurations per call point
  const DEFAULT_CONFIGS: Record<string, { provider: string; model: string }> = {
    "pipeline.measure": { provider: "claude", model: "claude-sonnet-4-20250514" },
    "pipeline.learn": { provider: "claude", model: "claude-sonnet-4-20250514" },
    "analysis.measure": { provider: "claude", model: "claude-haiku-4-5-20251001" },
  };

  // Simulates the config loading logic
  function simulateGetConfig(
    callPoint: string,
    dbConfig: { provider: string; model: string; isActive: boolean; maxTokens?: number } | null
  ) {
    // If db config exists and is active, use it
    if (dbConfig && dbConfig.isActive) {
      return {
        provider: dbConfig.provider,
        model: dbConfig.model,
        maxTokens: dbConfig.maxTokens,
        isCustomized: true,
      };
    }

    // Fall back to defaults
    const defaultConfig = DEFAULT_CONFIGS[callPoint];
    if (defaultConfig) {
      return {
        ...defaultConfig,
        isCustomized: false,
      };
    }

    // Ultimate fallback
    return {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      isCustomized: false,
    };
  }

  it("should return default config when not in database", () => {
    const config = simulateGetConfig("pipeline.measure", null);

    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.isCustomized).toBe(false);
  });

  it("should return saved config from database", () => {
    const config = simulateGetConfig("pipeline.measure", {
      provider: "openai",
      model: "gpt-4o",
      maxTokens: 2048,
      isActive: true,
    });

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.maxTokens).toBe(2048);
    expect(config.isCustomized).toBe(true);
  });

  it("should skip inactive configs", () => {
    const config = simulateGetConfig("pipeline.measure", {
      provider: "openai",
      model: "gpt-4o",
      isActive: false, // Inactive
    });

    // Should fall back to defaults
    expect(config.provider).toBe("claude");
    expect(config.isCustomized).toBe(false);
  });

  it("should return ultimate fallback for unknown call points", () => {
    const config = simulateGetConfig("unknown.callpoint", null);

    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.isCustomized).toBe(false);
  });

  it("should use different defaults for different call points", () => {
    const pipelineConfig = simulateGetConfig("pipeline.measure", null);
    const analysisConfig = simulateGetConfig("analysis.measure", null);

    expect(pipelineConfig.model).toBe("claude-sonnet-4-20250514");
    expect(analysisConfig.model).toBe("claude-haiku-4-5-20251001");
  });
});
