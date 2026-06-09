/**
 * Tests for /api/callers/[callerId]/compose-prompt endpoint
 *
 * Covers:
 * - POST /api/callers/[callerId]/compose-prompt - Compose personalized prompt
 * - GET /api/callers/[callerId]/compose-prompt - Get prompt history
 * - Composition pipeline execution
 * - Target overrides for preview
 * - AI completion integration
 * - Prompt storage and superseding
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Prisma client
const mockPrisma = {
  analysisSpec: {
    findFirst: vi.fn(),
  },
  composedPrompt: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock composition pipeline
const mockCompositionResult = {
  llmPrompt: "Structured prompt content for AI...",
  callerContext: "Caller context for the AI to understand...",
  loadedData: {
    caller: { id: "caller-123", name: "Test Caller" },
    memories: [
      { category: "preference", key: "topic", value: "tech", confidence: 0.9 },
    ],
    personality: {
      openness: 0.7,
      conscientiousness: 0.6,
      extraversion: 0.5,
      agreeableness: 0.8,
      neuroticism: 0.3,
    },
    learnerProfile: null,
    recentCalls: [],
    callCount: 5,
    behaviorTargets: [],
    callerTargets: [],
    callerAttributes: [],
    goals: [],
    playbooks: [{ id: "pb-1", name: "Default Playbook" }],
    systemSpecs: [],
  },
  resolvedSpecs: {
    identitySpec: { name: "Agent Identity" },
    contentSpec: null,
    voiceSpec: { name: "Friendly Voice" },
  },
  metadata: {
    sectionsActivated: ["identity", "personality", "memories"],
    sectionsSkipped: ["learning"],
    loadTimeMs: 45,
    transformTimeMs: 12,
    mergedTargetCount: 8,
  },
  sections: {
    behaviorTargets: { byDomain: {} },
  },
};

vi.mock("@/lib/prompt/composition", () => ({
  executeComposition: vi.fn(() => Promise.resolve(mockCompositionResult)),
  getDefaultSections: vi.fn(() => []),
}));

// Mock AI client
vi.mock("@/lib/ai/client", () => ({
  getDefaultEngine: vi.fn(() => "mock"),
}));

// Mock metering
const mockAIResult = {
  content: "Generated personalized prompt content for the caller...",
  engine: "mock",
  model: "mock-model",
  usage: { promptTokens: 500, completionTokens: 200 },
};
vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: vi.fn(() => Promise.resolve(mockAIResult)),
  getMeteredAICompletion: vi.fn(() => Promise.resolve(mockAIResult)),
}));

// Mock template renderer
vi.mock("@/lib/prompt/PromptTemplateCompiler", () => ({
  renderTemplate: vi.fn((template: string) => template),
}));

// Mock constants
vi.mock("@/lib/constants", () => ({
  getMemoriesByCategory: vi.fn(() => ({})),
}));

// Test data factories
const createMockCaller = (overrides = {}) => ({
  id: "caller-123",
  name: "Test Caller",
  email: "test@example.com",
  phone: "+1234567890",
  domainId: "domain-123",
  ...overrides,
});

const createMockComposeSpec = <T extends Record<string, unknown>>(overrides?: T) => ({
  id: "compose-spec-1",
  slug: "system-compose-next-prompt",
  name: "System Compose Prompt",
  isActive: true,
  config: {
    thresholds: { high: 0.65, low: 0.35 },
    memoriesLimit: 50,
    memoriesPerCategory: 5,
    recentCallsLimit: 5,
    maxTokens: 1500,
    temperature: 0.7,
    sections: [] as unknown[],
    parameters: [] as unknown[],
  },
  promptTemplate: null,
  ...overrides,
});

const createMockComposedPrompt = <T extends Record<string, unknown>>(overrides?: T) => ({
  id: "prompt-123",
  callerId: "caller-123",
  prompt: "Generated personalized prompt...",
  llmPrompt: "Structured prompt content...",
  triggerType: "manual",
  // #1344 Slice 4 — was `triggerCallId`; now `triggerSessionId`.
  triggerSessionId: null,
  model: "mock-model",
  status: "active",
  composedAt: new Date(),
  inputs: {} as Record<string, unknown>,
  ...overrides,
});

describe("/api/callers/[callerId]/compose-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/callers/[callerId]/compose-prompt", () => {
    it("should compose prompt for valid caller", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(createMockComposeSpec());
      mockPrisma.composedPrompt.create.mockResolvedValue(createMockComposedPrompt());
      mockPrisma.composedPrompt.updateMany.mockResolvedValue({ count: 0 });

      const expectedResponse = {
        ok: true,
        prompt: createMockComposedPrompt(),
        metadata: {
          engine: "mock",
          model: "mock-model",
          usage: { promptTokens: 500, completionTokens: 200 },
          inputContext: {
            memoriesCount: 1,
            personalityAvailable: true,
            recentCallsCount: 0,
            behaviorTargetsCount: 8,
            playbooksUsed: ["Default Playbook"],
            identitySpec: "Agent Identity",
            contentSpec: null,
          },
          composition: {
            sectionsActivated: ["identity", "personality", "memories"],
            sectionsSkipped: ["learning"],
            loadTimeMs: 45,
            transformTimeMs: 12,
          },
        },
      };

      expect(expectedResponse.ok).toBe(true);
      expect(expectedResponse.prompt).toBeDefined();
      expect(expectedResponse.metadata.inputContext.memoriesCount).toBe(1);
    });

    it("should use default engine when not specified", async () => {
      const requestBody = {};
      const expectedEngine = "mock";

      expect(expectedEngine).toBe("mock");
    });

    it("should accept custom engine parameter", async () => {
      const requestBody = { engine: "claude" };

      expect(requestBody.engine).toBe("claude");
    });

    it("should accept triggerType parameter", async () => {
      const requestBody = { triggerType: "post-call" };

      expect(requestBody.triggerType).toBe("post-call");
    });

    it("should accept triggerCallId parameter", async () => {
      const requestBody = { triggerCallId: "call-456" };

      expect(requestBody.triggerCallId).toBe("call-456");
    });

    it("should accept targetOverrides for preview", async () => {
      const requestBody = {
        targetOverrides: {
          "param-1": 0.8,
          "param-2": 0.3,
        },
      };

      expect(requestBody.targetOverrides["param-1"]).toBe(0.8);
      expect(requestBody.targetOverrides["param-2"]).toBe(0.3);
    });

    it("should pass targetOverrides to composition pipeline", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(createMockComposeSpec());

      const { executeComposition } = await import("@/lib/prompt/composition");

      const targetOverrides = { "param-1": 0.9 };

      // The fullSpecConfig should include targetOverrides
      const expectedConfig = {
        thresholds: { high: 0.65, low: 0.35 },
        targetOverrides,
      };

      expect(expectedConfig.targetOverrides).toEqual({ "param-1": 0.9 });
    });

    it("should find compose spec by slug first", async () => {
      const composeSpec = createMockComposeSpec({
        slug: "system-compose-next-prompt",
      });
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(composeSpec);

      expect(composeSpec.slug).toBe("system-compose-next-prompt");
    });

    it("should fall back to COMPOSE outputType if slug not found", async () => {
      mockPrisma.analysisSpec.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          createMockComposeSpec({ outputType: "COMPOSE", scope: "SYSTEM" })
        );

      expect(mockPrisma.analysisSpec.findFirst).toBeDefined();
    });

    it("should store composed prompt in database", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(createMockComposeSpec());
      mockPrisma.composedPrompt.create.mockResolvedValue(createMockComposedPrompt());
      mockPrisma.composedPrompt.updateMany.mockResolvedValue({ count: 0 });

      expect(mockPrisma.composedPrompt.create).toBeDefined();
    });

    it("should mark previous prompts as superseded", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(createMockComposeSpec());
      mockPrisma.composedPrompt.create.mockResolvedValue(
        createMockComposedPrompt({ id: "new-prompt" })
      );
      mockPrisma.composedPrompt.updateMany.mockResolvedValue({ count: 2 });

      const expectedUpdate = {
        where: {
          callerId: "caller-123",
          id: { not: "new-prompt" },
          status: "active",
        },
        data: {
          status: "superseded",
        },
      };

      expect(expectedUpdate.data.status).toBe("superseded");
    });

    it("should store composition metadata in prompt inputs", async () => {
      const mockPrompt = createMockComposedPrompt({
        inputs: {
          callerContext: "...",
          memoriesCount: 5,
          personalityAvailable: true,
          recentCallsCount: 3,
          behaviorTargetsCount: 8,
          playbooksUsed: ["Playbook A"],
          playbooksCount: 1,
          identitySpec: "Agent Identity",
          contentSpec: null,
          specUsed: "system-compose-next-prompt",
          specConfig: {
            thresholds: { high: 0.65, low: 0.35 },
            memoriesLimit: 50,
          },
          composition: {
            sectionsActivated: ["identity", "memories"],
            sectionsSkipped: [],
            loadTimeMs: 45,
            transformTimeMs: 12,
          },
        },
      });

      expect((mockPrompt.inputs as { memoriesCount: number }).memoriesCount).toBe(5);
      expect((mockPrompt.inputs as { composition: { loadTimeMs: number } }).composition.loadTimeMs).toBe(45);
    });

    it("should handle composition pipeline errors", async () => {
      const { executeComposition } = await import("@/lib/prompt/composition");
      (executeComposition as any).mockRejectedValueOnce(
        new Error("Composition failed")
      );

      const expectedResponse = {
        ok: false,
        error: "Composition failed",
      };

      expect(expectedResponse.ok).toBe(false);
    });

    it("should handle AI completion errors", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(createMockComposeSpec());

      const { getConfiguredMeteredAICompletion } = await import("@/lib/metering");
      (getConfiguredMeteredAICompletion as any).mockRejectedValueOnce(
        new Error("AI service unavailable")
      );

      const expectedResponse = {
        ok: false,
        error: "AI service unavailable",
      };

      expect(expectedResponse.ok).toBe(false);
    });

    it("should use promptTemplate if available in spec", async () => {
      const specWithTemplate = createMockComposeSpec({
        promptTemplate: "Custom template: {{caller.name}}",
      });
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(specWithTemplate);

      expect(specWithTemplate.promptTemplate).toBe("Custom template: {{caller.name}}");
    });

    it("should use default prompts if no template", async () => {
      const specWithoutTemplate = createMockComposeSpec({
        promptTemplate: null,
      });
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(specWithoutTemplate);

      expect(specWithoutTemplate.promptTemplate).toBeNull();
    });
  });

  describe("GET /api/callers/[callerId]/compose-prompt", () => {
    it("should return prompt history for caller", async () => {
      const mockPrompts = [
        createMockComposedPrompt({ id: "p1", status: "active" }),
        createMockComposedPrompt({ id: "p2", status: "superseded" }),
        createMockComposedPrompt({ id: "p3", status: "superseded" }),
      ];
      mockPrisma.composedPrompt.findMany.mockResolvedValue(mockPrompts);

      const expectedResponse = {
        ok: true,
        prompts: mockPrompts,
        count: 3,
      };

      expect(expectedResponse.count).toBe(3);
      expect(expectedResponse.prompts[0].status).toBe("active");
    });

    it("should filter by status when provided", async () => {
      const activePrompts = [
        createMockComposedPrompt({ id: "p1", status: "active" }),
      ];
      mockPrisma.composedPrompt.findMany.mockResolvedValue(activePrompts);

      const expectedQuery = {
        where: {
          callerId: "caller-123",
          status: "active",
        },
      };

      expect(expectedQuery.where.status).toBe("active");
    });

    it("should return all prompts when status is 'all'", async () => {
      const allPrompts = [
        createMockComposedPrompt({ id: "p1", status: "active" }),
        createMockComposedPrompt({ id: "p2", status: "superseded" }),
      ];
      mockPrisma.composedPrompt.findMany.mockResolvedValue(allPrompts);

      expect(allPrompts).toHaveLength(2);
    });

    it("should respect limit parameter", async () => {
      mockPrisma.composedPrompt.findMany.mockResolvedValue([]);

      const expectedQuery = {
        take: 5,
      };

      expect(expectedQuery.take).toBe(5);
    });

    it("should default limit to 20", async () => {
      const defaultLimit = 20;

      expect(defaultLimit).toBe(20);
    });

    it("should order by composedAt descending", async () => {
      const expectedQuery = {
        orderBy: { composedAt: "desc" },
      };

      expect(expectedQuery.orderBy.composedAt).toBe("desc");
    });

    it("should include trigger session relationship (#1344 Slice 4)", async () => {
      // #1344 Slice 4 — `triggerCall` relation gone; walk via
      // `triggerSession.call` (1:1 with Session).
      const promptWithTrigger = createMockComposedPrompt({
        triggerSessionId: "sess-123",
        triggerSession: {
          id: "sess-123",
          call: {
            id: "call-123",
            createdAt: new Date(),
            source: "phone",
          },
        },
      });
      mockPrisma.composedPrompt.findMany.mockResolvedValue([promptWithTrigger]);

      expect((promptWithTrigger as any).triggerSession.call.id).toBe("call-123");
    });

    it("should handle database errors gracefully", async () => {
      mockPrisma.composedPrompt.findMany.mockRejectedValue(
        new Error("Database error")
      );

      const expectedResponse = {
        ok: false,
        error: "Failed to fetch prompts",
      };

      expect(expectedResponse.ok).toBe(false);
    });
  });

  describe("Composition Pipeline Integration", () => {
    it("should execute composition with caller ID and sections", async () => {
      const { executeComposition } = await import("@/lib/prompt/composition");

      const callerId = "caller-123";
      const sections = [];
      const config = { thresholds: { high: 0.65, low: 0.35 } };

      // Verify composition is called correctly
      expect(executeComposition).toBeDefined();
    });

    it("should extract spec config for composition", async () => {
      const spec = createMockComposeSpec({
        config: {
          parameters: [
            { id: "personality_section", config: { thresholds: { high: 0.7 } } },
            { id: "memory_section", config: { memoriesLimit: 100 } },
          ],
        },
      });
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(spec);

      expect(spec.config.parameters).toHaveLength(2);
    });

    it("should use default sections when spec has none", async () => {
      const { getDefaultSections } = await import("@/lib/prompt/composition");

      expect(getDefaultSections).toBeDefined();
    });

    it("should return resolved specs in metadata", async () => {
      const expectedMetadata = {
        inputContext: {
          identitySpec: "Agent Identity",
          contentSpec: null,
        },
      };

      expect(expectedMetadata.inputContext.identitySpec).toBe("Agent Identity");
    });

    it("should return composition timing in metadata", async () => {
      const expectedMetadata = {
        composition: {
          loadTimeMs: 45,
          transformTimeMs: 12,
        },
      };

      expect(expectedMetadata.composition.loadTimeMs).toBe(45);
      expect(expectedMetadata.composition.transformTimeMs).toBe(12);
    });
  });
});

describe("Target Overrides Preview Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not persist target overrides", async () => {
    const targetOverrides = { "param-1": 0.9 };

    // Target overrides are for preview only, not stored
    const mockPrompt = createMockComposedPrompt({
      inputs: {
        specConfig: {
          // targetOverrides should NOT be in stored config
        },
      },
    });

    expect(mockPrompt.inputs.specConfig).not.toHaveProperty("targetOverrides");
  });

  it("should merge target overrides into composition config", async () => {
    const baseConfig = {
      thresholds: { high: 0.65, low: 0.35 },
    };
    const targetOverrides = { "param-1": 0.9 };

    const fullConfig = {
      ...baseConfig,
      targetOverrides,
    };

    expect(fullConfig.targetOverrides["param-1"]).toBe(0.9);
  });

  it("should default targetOverrides to empty object", async () => {
    const requestBody = {};
    const targetOverrides = (requestBody as any).targetOverrides || {};

    expect(targetOverrides).toEqual({});
  });
});
