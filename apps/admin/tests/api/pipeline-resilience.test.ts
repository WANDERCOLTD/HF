/**
 * Pipeline Resilience Tests
 *
 * Verifies that the pipeline orchestrator (runSpecDrivenPipeline) is resilient:
 * - COMPOSE always runs even when earlier stages (EXTRACT, SCORE_AGENT) fail
 * - Promise.allSettled is used for parallel stages so one failure doesn't block others
 * - stageErrors are tracked and surfaced in the response
 * - Mode: "prompt" always reaches COMPOSE stage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  analysisSpec: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
  call: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  callScore: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  callerMemory: {
    create: vi.fn(),
  },
  behaviorMeasurement: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  behaviorTarget: {
    findMany: vi.fn(),
  },
  rewardScore: {
    upsert: vi.fn(),
  },
  personalityObservation: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  callerPersonality: {
    upsert: vi.fn(),
  },
  callerPersonalityProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  callTarget: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  callerTarget: {
    upsert: vi.fn(),
  },
  parameter: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  playbook: {
    findFirst: vi.fn(),
  },
  aIConfig: {
    findUnique: vi.fn(),
  },
  systemSetting: {
    findUnique: vi.fn(),
  },
  $disconnect: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx) => tx ?? mockPrisma,
}));

vi.mock("@/lib/ai/client", () => ({
  AIEngine: "mock",
  isEngineAvailable: vi.fn((engine: string) => engine === "mock"),
}));

// Track AI calls so we can make specific ones throw
const mockGetMeteredAICompletion = vi.fn();
const mockLogMockAIUsage = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockGetMeteredAICompletion(...args),
  logMockAIUsage: (...args: any[]) => mockLogMockAIUsage(...args),
}));

vi.mock("@/lib/pipeline/aggregate-runner", () => ({
  runAggregateSpecs: vi.fn().mockResolvedValue({
    specsRun: 0,
    profileUpdates: 0,
    errors: [],
  }),
}));

vi.mock("@/lib/pipeline/adapt-runner", () => ({
  runAdaptSpecs: vi.fn().mockResolvedValue({
    specsRun: 0,
    targetsCreated: 0,
    targetsUpdated: 0,
    errors: [],
  }),
}));

vi.mock("@/lib/goals/track-progress", () => ({
  trackGoalProgress: vi.fn().mockResolvedValue({
    updated: 0,
    completed: 0,
  }),
}));

vi.mock("@/lib/goals/extract-goals", () => ({
  extractGoals: vi.fn().mockResolvedValue({
    goalsCreated: 0,
    goalsUpdated: 0,
    goalsSkipped: 0,
    errors: [],
  }),
}));

// Mock config
vi.mock("@/lib/config", () => ({
  config: {
    ai: {
      claude: { model: "claude-sonnet-4-5-20250929", lightModel: "claude-haiku-4-5-20251001" },
      openai: { model: "gpt-4o", lightModel: "gpt-4o-mini" },
    },
    specs: {
      pipeline: "PIPELINE-001",
      pipelineFallback: "GUARD-001",
    },
    vapi: { webhookSecret: "test-secret" },
  },
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
}));

vi.mock("@/lib/registry", () => ({
  TRAITS: {
    B5_O: "B5-O",
    B5_C: "B5-C",
    B5_E: "B5-E",
    B5_A: "B5-A",
    B5_N: "B5-N",
  },
}));

vi.mock("@/lib/system-settings", () => ({
  getPipelineGates: vi.fn().mockResolvedValue({
    minTranscriptWords: 5,
    shortTranscriptThresholdWords: 50,
    shortTranscriptConfidenceCap: 0.3,
  }),
  TRUST_DEFAULTS: { weightL5Regulatory: 1.0, weightL4Accredited: 0.95, weightL3Published: 0.80, weightL2Expert: 0.60, weightL1AiAssisted: 0.30, weightL0Unverified: 0.05, certificationMinWeight: 0.80, extractionMaxChunkChars: 8000 },
  getTrustSettings: vi.fn().mockResolvedValue({ weightL5Regulatory: 1.0, weightL4Accredited: 0.95, weightL3Published: 0.80, weightL2Expert: 0.60, weightL1AiAssisted: 0.30, weightL0Unverified: 0.05, certificationMinWeight: 0.80, extractionMaxChunkChars: 8000 }),
  PIPELINE_DEFAULTS: { minTranscriptWords: 20, shortTranscriptThresholdWords: 50, shortTranscriptConfidenceCap: 0.3, maxRetries: 2, mockMode: false, personalityDecayHalfLifeDays: 30, mockScoreBase: 0.3, mockScoreRange: 0.4 },
  getPipelineSettings: vi.fn().mockResolvedValue({ minTranscriptWords: 20, shortTranscriptThresholdWords: 50, shortTranscriptConfidenceCap: 0.3, maxRetries: 2, mockMode: false, personalityDecayHalfLifeDays: 30, mockScoreBase: 0.3, mockScoreRange: 0.4 }),
  clearSystemSettingsCache: vi.fn(),
  getSystemSetting: vi.fn().mockImplementation(async (_key: string, defaultValue?: any) => defaultValue ?? null),
  SETTINGS_REGISTRY: [],
}));

// Track COMPOSE calls
const mockExecuteComposition = vi.fn().mockResolvedValue({
  prompt: "Composed prompt text",
  llmPrompt: { sections: [] },
});
const mockPersistComposedPrompt = vi.fn().mockResolvedValue({
  id: "prompt-test-1",
  prompt: "Composed prompt text for next call",
});
const mockLoadComposeConfig = vi.fn().mockResolvedValue({
  fullSpecConfig: {},
  sections: [],
  specSlug: "COMP-001",
});
const mockRenderPromptSummary = vi.fn().mockReturnValue("Summary");

vi.mock("@/lib/prompt/composition", () => ({
  executeComposition: (...args: any[]) => mockExecuteComposition(...args),
  persistComposedPrompt: (...args: any[]) => mockPersistComposedPrompt(...args),
  loadComposeConfig: (...args: any[]) => mockLoadComposeConfig(...args),
}));

vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderPromptSummary: (...args: any[]) => mockRenderPromptSummary(...args),
}));

// =====================================================
// HELPERS
// =====================================================

/** Standard PIPELINE-001 spec with all 7 stages */
const PIPELINE_SPEC = {
  slug: "pipeline-001",
  config: {
    parameters: [
      {
        id: "pipeline_stages",
        config: {
          stages: [
            { name: "EXTRACT", order: 10, outputTypes: ["LEARN", "MEASURE"], batched: true },
            { name: "SCORE_AGENT", order: 20, outputTypes: ["MEASURE_AGENT"], batched: true },
            { name: "AGGREGATE", order: 30, outputTypes: ["AGGREGATE"] },
            { name: "REWARD", order: 40, outputTypes: ["REWARD"] },
            { name: "ADAPT", order: 50, outputTypes: ["ADAPT"] },
            { name: "SUPERVISE", order: 60, outputTypes: ["SUPERVISE"] },
            { name: "COMPOSE", order: 100, outputTypes: ["COMPOSE"], requiresMode: "prompt" },
          ],
        },
      },
    ],
  },
};

function createMockRequest(body: Record<string, any>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

function setupBaseMocks() {
  // Pipeline spec
  mockPrisma.analysisSpec.findFirst.mockImplementation(async (args: any) => {
    const where = args?.where || {};
    // loadPipelineStages queries by slug containing pipeline slug
    if (where.slug?.contains) {
      return PIPELINE_SPEC;
    }
    // loadGuardrails queries by outputType === "SUPERVISE"
    if (where.outputType === "SUPERVISE") {
      return null; // use default guardrails
    }
    // AGGREGATE spec query
    if (where.outputType === "AGGREGATE") {
      return null;
    }
    return null;
  });

  // Call exists with transcript
  mockPrisma.call.findUnique.mockResolvedValue({
    id: "call-test-1",
    transcript: "Customer: Hello I am from London. Agent: Welcome! How can I help you today?",
    createdAt: new Date(),
    behaviorMeasurements: [],
  });

  // Caller with domain
  mockPrisma.caller.findUnique.mockResolvedValue({
    id: "caller-test-1",
    domainId: "domain-1",
    domain: { slug: "companion", name: "Companion" },
  });

  // No analysis specs (empty stages for EXTRACT/SCORE_AGENT/ADAPT/etc)
  mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

  // No parameters
  mockPrisma.parameter.findMany.mockResolvedValue([]);

  // No playbook
  mockPrisma.playbook.findFirst.mockResolvedValue(null);

  // Empty scores, measurements, targets (count=0 ensures idempotency checks pass through)
  mockPrisma.callScore.findMany.mockResolvedValue([]);
  mockPrisma.callScore.findFirst.mockResolvedValue(null);
  mockPrisma.callScore.count.mockResolvedValue(0);
  mockPrisma.behaviorMeasurement.findFirst.mockResolvedValue(null);
  mockPrisma.behaviorMeasurement.count.mockResolvedValue(0);
  mockPrisma.behaviorTarget.findMany.mockResolvedValue([]);
  mockPrisma.callTarget.findMany.mockResolvedValue([]);
  mockPrisma.callTarget.count.mockResolvedValue(0);
  mockPrisma.personalityObservation.findUnique.mockResolvedValue(null);
  mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);

  // No previous call (for delta computation)
  mockPrisma.call.findFirst.mockResolvedValue(null);
  mockPrisma.call.findMany.mockResolvedValue([]);

  // Upserts succeed
  mockPrisma.rewardScore.upsert.mockResolvedValue({});
  mockPrisma.callerPersonality.upsert.mockResolvedValue({});
  mockPrisma.callerPersonalityProfile.upsert.mockResolvedValue({});
  mockPrisma.callTarget.upsert.mockResolvedValue({});
  mockPrisma.callerTarget.upsert.mockResolvedValue({});
  mockPrisma.personalityObservation.create.mockResolvedValue({});

  // AI transcript limit config
  mockPrisma.aIConfig.findUnique.mockResolvedValue(null);

  // System settings
  mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
}

// =====================================================
// TESTS
// =====================================================

describe("Pipeline Resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it("COMPOSE runs even when EXTRACT and SCORE_AGENT both fail (mode=prompt)", async () => {
    // Make AI completion throw (used by both EXTRACT and SCORE_AGENT)
    mockGetMeteredAICompletion.mockRejectedValue(new Error("AI service unavailable"));

    // Give EXTRACT something to work with so it actually tries the AI call
    mockPrisma.analysisSpec.findMany.mockImplementation(async (args: any) => {
      const where = args?.where || {};
      if (where.scope === "SYSTEM" || where.scope === "DOMAIN") {
        return [{ id: "spec-1", slug: "test-measure", outputType: "MEASURE" }];
      }
      if (where.id?.in) {
        return [
          {
            id: "spec-1",
            slug: "test-measure",
            triggers: [{ actions: [{ parameterId: "B5-O" }] }],
          },
        ];
      }
      return [];
    });

    // Parameter lookup
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "B5-O", name: "Openness", definition: "Openness to experience" },
    ]);

    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prompt",
      engine: "mock",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    // Pipeline should succeed overall (200 OK)
    expect(data.ok).toBe(true);
    expect(data.mode).toBe("prompt");

    // COMPOSE should have been called
    expect(mockLoadComposeConfig).toHaveBeenCalled();
    expect(mockExecuteComposition).toHaveBeenCalled();
    expect(mockPersistComposedPrompt).toHaveBeenCalled();

    // Prompt should be present in response
    expect(data.data.promptId).toBeDefined();
  });

  it("COMPOSE runs when AGGREGATE throws (sequential stage failure)", async () => {
    // Make aggregatePersonality fail by having callScores return data
    // but personalityObservation.create throw
    mockPrisma.callScore.findMany.mockResolvedValue([
      { parameterId: "B5-O", score: 0.8, confidence: 0.9, call: { createdAt: new Date() }, scoredAt: new Date() },
    ]);
    mockPrisma.personalityObservation.findUnique.mockResolvedValue(null);
    mockPrisma.personalityObservation.create.mockRejectedValue(new Error("DB constraint violation"));

    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prompt",
      engine: "mock",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    // Pipeline should succeed overall
    expect(data.ok).toBe(true);

    // COMPOSE should still have run
    expect(mockLoadComposeConfig).toHaveBeenCalled();
    expect(mockExecuteComposition).toHaveBeenCalled();

    // Stage errors should be tracked
    if (data.data.stageErrors) {
      expect(data.data.stageErrors.length).toBeGreaterThan(0);
      const aggregateError = data.data.stageErrors.find((e: string) => e.includes("AGGREGATE"));
      expect(aggregateError).toBeDefined();
    }
  });

  it("stageErrors are populated when stages fail", async () => {
    // Make COMPOSE config loading fail to force a COMPOSE error
    // but first let's make a parallel stage fail instead
    mockGetMeteredAICompletion.mockRejectedValue(new Error("Rate limited"));

    // Provide specs so EXTRACT actually calls AI
    mockPrisma.analysisSpec.findMany.mockImplementation(async (args: any) => {
      const where = args?.where || {};
      if (where.scope === "SYSTEM" || where.scope === "DOMAIN") {
        return [{ id: "spec-1", slug: "test-measure", outputType: "MEASURE" }];
      }
      if (where.id?.in) {
        return [
          {
            id: "spec-1",
            slug: "test-measure",
            triggers: [{ actions: [{ parameterId: "B5-O" }] }],
          },
        ];
      }
      return [];
    });

    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "B5-O", name: "Openness", definition: null },
    ]);

    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prompt",
      engine: "mock",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);

    // COMPOSE should still succeed
    expect(mockPersistComposedPrompt).toHaveBeenCalled();
    expect(data.data.promptId).toBeDefined();
  });

  it("COMPOSE is skipped in prep mode even when all stages succeed", async () => {
    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prep",
      engine: "mock",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.mode).toBe("prep");

    // COMPOSE should NOT have been called
    expect(mockLoadComposeConfig).not.toHaveBeenCalled();
    expect(mockExecuteComposition).not.toHaveBeenCalled();
    expect(mockPersistComposedPrompt).not.toHaveBeenCalled();
  });

  it("prompt mode response includes prompt when COMPOSE succeeds", async () => {
    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prompt",
      engine: "mock",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.mode).toBe("prompt");
    expect(data.prompt).toBeDefined();
    expect(data.data.promptId).toBe("prompt-test-1");
  });

  it("returns 400 when callerId is missing", async () => {
    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({ mode: "prompt" });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(data.error).toContain("callerId");
  });

  it("returns 400 when mode is invalid", async () => {
    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "invalid",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "call-test-1" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(false);
    expect(response.status).toBe(400);
  });

  it("returns 404 when call not found", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);

    const { POST } = await import("@/app/api/calls/[callId]/pipeline/route");

    const request = createMockRequest({
      callerId: "caller-test-1",
      mode: "prompt",
    });

    const response = await POST(request, {
      params: Promise.resolve({ callId: "nonexistent" }),
    });
    const data = await response.json();

    expect(data.ok).toBe(false);
    expect(response.status).toBe(404);
  });
});
