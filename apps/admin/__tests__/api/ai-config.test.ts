/**
 * Tests for /api/ai-config endpoint
 *
 * @feature AI Model Configuration
 * @scenario Configure transcript limits for pipeline stages
 *
 * Gherkin:
 *   Feature: AI Model Configuration
 *     As an administrator
 *     I want to configure AI models and transcript limits per call point
 *     So that I can optimize cost vs fidelity for each pipeline stage
 *
 *     Scenario: Get all configurations
 *       Given the AI config API is available
 *       When I request GET /api/ai-config
 *       Then I should receive all configured call points
 *       And each call point should have default values
 *       And pipeline stages should have defaultTranscriptLimit
 *
 *     Scenario: Update transcript limit
 *       Given I have a call point "pipeline.measure"
 *       When I POST to /api/ai-config with transcriptLimit=6000
 *       Then the configuration should be updated
 *       And subsequent GET requests should return transcriptLimit=6000
 *
 *     Scenario: Reset to defaults
 *       Given a customized configuration exists
 *       When I DELETE /api/ai-config?callPoint=pipeline.measure
 *       Then the configuration should be removed
 *       And GET should return default values
 *
 *     Scenario: Pipeline uses configured limit
 *       Given pipeline.measure has transcriptLimit=5000
 *       When the pipeline runs MEASURE stage
 *       Then the transcript should be truncated to 5000 chars
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock Prisma client
const mockPrisma = {
  aIConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
  aIModel: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Test data factories
const createMockAIConfig = <T extends Record<string, unknown>>(overrides?: T) => ({
  id: "config-123",
  callPoint: "pipeline.measure",
  label: "Pipeline - MEASURE",
  provider: "claude",
  model: "claude-sonnet-4-5-20250929",
  maxTokens: null,
  temperature: null,
  transcriptLimit: null,
  isActive: true,
  description: "Scores caller parameters from transcript",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-15"),
  ...overrides,
});

const createMockAIModel = <T extends Record<string, unknown>>(overrides?: T) => ({
  id: "model-123",
  modelId: "claude-sonnet-4-5-20250929",
  provider: "claude",
  label: "Claude Sonnet 4",
  tier: "flagship",
  isActive: true,
  sortOrder: 0,
  ...overrides,
});

describe("/api/ai-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for available models
    mockPrisma.aIModel.findMany.mockResolvedValue([
      createMockAIModel(),
      createMockAIModel({ modelId: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "fast" }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/ai-config", () => {
    it("should return all call points with defaults", async () => {
      // Given: No custom configs exist
      mockPrisma.aIConfig.findMany.mockResolvedValue([]);

      // When: Importing and calling the GET handler
      const { GET } = await import("@/app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      // Then: Should return all call points with default values
      expect(data.ok).toBe(true);
      expect(data.configs).toBeDefined();
      expect(data.configs.length).toBeGreaterThan(0);

      // And: Pipeline stages should have defaultTranscriptLimit
      const measureConfig = data.configs.find(
        (c: any) => c.callPoint === "pipeline.measure"
      );
      expect(measureConfig).toBeDefined();
      expect(measureConfig.defaultTranscriptLimit).toBe(4000);
      expect(measureConfig.transcriptLimit).toBeNull(); // Not customized yet
    });

    it("should return customized configs with saved values", async () => {
      // Given: A custom config exists with transcriptLimit
      mockPrisma.aIConfig.findMany.mockResolvedValue([
        createMockAIConfig({ transcriptLimit: 6000 }),
      ]);

      // When
      const { GET } = await import("@/app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      // Then: Should return the saved transcriptLimit
      const measureConfig = data.configs.find(
        (c: any) => c.callPoint === "pipeline.measure"
      );
      expect(measureConfig.transcriptLimit).toBe(6000);
      expect(measureConfig.isCustomized).toBe(true);
    });

    it("should include default transcript limits for all pipeline stages", async () => {
      // Given
      mockPrisma.aIConfig.findMany.mockResolvedValue([]);

      // When
      const { GET } = await import("@/app/api/ai-config/route");
      const response = await GET();
      const data = await response.json();

      // Then: All pipeline stages should have transcript limits
      const pipelineConfigs = data.configs.filter((c: any) =>
        c.callPoint.startsWith("pipeline.")
      );

      for (const config of pipelineConfigs) {
        expect(config.defaultTranscriptLimit).toBeDefined();
        expect(typeof config.defaultTranscriptLimit).toBe("number");
        expect(config.defaultTranscriptLimit).toBeGreaterThanOrEqual(2000);
      }

      // ADAPT should have lower default (2000) for cost optimization
      const adaptConfig = data.configs.find(
        (c: any) => c.callPoint === "pipeline.adapt"
      );
      expect(adaptConfig.defaultTranscriptLimit).toBe(2000);
    });
  });

  describe("POST /api/ai-config", () => {
    it("should update transcript limit for a call point", async () => {
      // Given: Valid request body
      mockPrisma.aIConfig.upsert.mockResolvedValue(
        createMockAIConfig({ transcriptLimit: 5000 })
      );

      // When
      const { POST } = await import("@/app/api/ai-config/route");
      const request = new Request("http://localhost/api/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callPoint: "pipeline.measure",
          provider: "claude",
          model: "claude-sonnet-4-5-20250929",
          transcriptLimit: 5000,
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Then
      expect(data.ok).toBe(true);
      expect(mockPrisma.aIConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callPoint: "pipeline.measure" },
          create: expect.objectContaining({
            transcriptLimit: 5000,
          }),
          update: expect.objectContaining({
            transcriptLimit: 5000,
          }),
        })
      );
    });

    it("should allow null transcript limit (uses default)", async () => {
      // Given
      mockPrisma.aIConfig.upsert.mockResolvedValue(
        createMockAIConfig({ transcriptLimit: null })
      );

      // When
      const { POST } = await import("@/app/api/ai-config/route");
      const request = new Request("http://localhost/api/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callPoint: "pipeline.measure",
          provider: "claude",
          model: "claude-sonnet-4-5-20250929",
          transcriptLimit: null,
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Then
      expect(data.ok).toBe(true);
      expect(mockPrisma.aIConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            transcriptLimit: null,
          }),
        })
      );
    });

    it("should reject invalid call points", async () => {
      // When
      const { POST } = await import("@/app/api/ai-config/route");
      const request = new Request("http://localhost/api/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callPoint: "invalid.call.point",
          provider: "claude",
          model: "claude-sonnet-4-5-20250929",
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Then
      expect(data.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/ai-config", () => {
    it("should delete configuration and revert to defaults", async () => {
      // Given
      mockPrisma.aIConfig.findUnique.mockResolvedValue(
        createMockAIConfig({ transcriptLimit: 5000 })
      );
      mockPrisma.aIConfig.delete.mockResolvedValue(createMockAIConfig());

      // When
      const { DELETE } = await import("@/app/api/ai-config/route");
      const request = new Request(
        "http://localhost/api/ai-config?callPoint=pipeline.measure",
        { method: "DELETE" }
      );

      const response = await DELETE(request as any);
      const data = await response.json();

      // Then
      expect(data.ok).toBe(true);
      expect(mockPrisma.aIConfig.delete).toHaveBeenCalledWith({
        where: { callPoint: "pipeline.measure" },
      });
    });

    it("should return 404 for non-existent config", async () => {
      // Given
      mockPrisma.aIConfig.findUnique.mockResolvedValue(null);

      // When
      const { DELETE } = await import("@/app/api/ai-config/route");
      const request = new Request(
        "http://localhost/api/ai-config?callPoint=pipeline.measure",
        { method: "DELETE" }
      );

      const response = await DELETE(request as any);
      const data = await response.json();

      // Then
      expect(data.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
});

describe("Transcript limit integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have consistent defaults across API and pipeline", async () => {
    // Given: Import the call points definition
    const { AI_CALL_POINTS } = await import("@/app/api/ai-config/route");

    // Then: Verify default limits match documented values
    const measurePoint = AI_CALL_POINTS.find(
      (p) => p.callPoint === "pipeline.measure"
    );
    const adaptPoint = AI_CALL_POINTS.find(
      (p) => p.callPoint === "pipeline.adapt"
    );

    expect((measurePoint as any).defaultTranscriptLimit).toBe(4000);
    expect((adaptPoint as any).defaultTranscriptLimit).toBe(2000);
  });

  it("should define transcript limits for all pipeline stages", async () => {
    // Given
    const { AI_CALL_POINTS } = await import("@/app/api/ai-config/route");

    // Then: All pipeline.* call points should have transcript limits
    const pipelinePoints = AI_CALL_POINTS.filter((p) =>
      p.callPoint.startsWith("pipeline.")
    );

    for (const point of pipelinePoints) {
      expect((point as any).defaultTranscriptLimit).toBeDefined();
      expect((point as any).defaultTranscriptLimit).toBeGreaterThan(0);
    }
  });
});
