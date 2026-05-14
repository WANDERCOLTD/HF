/**
 * Tests for lib/actions/extract-actions.ts
 *
 * Action extraction from call transcripts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  callAction: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockMeteredAI = vi.fn();
const mockLogMockUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockMeteredAI(...args),
  logMockAIUsage: (...args: any[]) => mockLogMockUsage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
}));

vi.mock("@/lib/system-settings", () => ({
  ACTIONS_DEFAULTS: {
    transcriptLimit: 4000,
    minTranscriptLength: 100,
    confidenceThreshold: 0.6,
    similarityThreshold: 0.8,
  },
  getActionSettings: vi.fn().mockResolvedValue({
    transcriptLimit: 4000,
    minTranscriptLength: 100,
    confidenceThreshold: 0.6,
    similarityThreshold: 0.8,
  }),
  getAITimeoutSettings: vi.fn().mockResolvedValue({
    pipelineTimeoutMs: 60000,
    extractionTimeoutMs: 120000,
    classificationTimeoutMs: 15000,
    postPipelineTimeoutMs: 30000,
    quickExtractTimeoutMs: 15000,
    curriculumTimeoutMs: 90000,
  }),
  getSystemSetting: vi.fn().mockImplementation(async (_key: string, defaultValue?: any) => defaultValue ?? null),
  clearSystemSettingsCache: vi.fn(),
  SETTINGS_REGISTRY: [],
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// =====================================================
// TESTS
// =====================================================

describe("extractActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should skip extraction for short transcripts", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    const result = await extractActions(
      { id: "call-1", transcript: "Hi" },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.actionsSkipped).toBe(0);
    expect(mockMeteredAI).not.toHaveBeenCalled();
  });

  it("should skip extraction for null transcripts", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    const result = await extractActions(
      { id: "call-1", transcript: null },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
  });

  it("should use mock engine without calling AI", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "mock" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(mockMeteredAI).not.toHaveBeenCalled();
    expect(mockLogMockUsage).toHaveBeenCalled();
  });

  it("should extract actions from AI response", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);
    mockPrisma.callAction.create.mockResolvedValue({ id: "act-1" });

    mockMeteredAI.mockResolvedValue({
      content: JSON.stringify({
        actions: [
          {
            t: "HOMEWORK",
            a: "CALLER",
            ti: "Practice times tables",
            d: "Practice 7x and 8x multiplication tables",
            p: "MEDIUM",
            co: 0.9,
            ev: "for homework try the seven and eight times tables",
          },
          {
            t: "FOLLOWUP",
            a: "AGENT",
            ti: "Explain compound interest",
            d: "Cover compound interest next session",
            p: "MEDIUM",
            co: 0.85,
            ev: "next time I'll explain compound interest",
          },
        ],
      }),
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(2);
    expect(result.actionsSkipped).toBe(0);
    expect(mockPrisma.callAction.create).toHaveBeenCalledTimes(2);

    // Check first action was created correctly
    const firstCreate = mockPrisma.callAction.create.mock.calls[0][0].data;
    expect(firstCreate.type).toBe("HOMEWORK");
    expect(firstCreate.assignee).toBe("CALLER");
    expect(firstCreate.title).toBe("Practice times tables");
    expect(firstCreate.source).toBe("EXTRACTED");
    expect(firstCreate.confidence).toBe(0.9);
  });

  it("should skip low confidence actions", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);

    mockMeteredAI.mockResolvedValue({
      content: JSON.stringify({
        actions: [
          {
            t: "REMINDER",
            a: "CALLER",
            ti: "Maybe check that thing",
            d: "",
            p: "LOW",
            co: 0.3, // Below 0.6 threshold
            ev: "might want to look into that",
          },
        ],
      }),
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.actionsSkipped).toBe(1);
  });

  it("should deduplicate against existing actions", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    // Existing action with similar title
    mockPrisma.callAction.findMany.mockResolvedValue([
      { id: "existing-1", type: "HOMEWORK", title: "Practice times tables" },
    ]);

    mockMeteredAI.mockResolvedValue({
      content: JSON.stringify({
        actions: [
          {
            t: "HOMEWORK",
            a: "CALLER",
            ti: "Practice times tables", // Duplicate
            d: "Same homework",
            p: "MEDIUM",
            co: 0.9,
            ev: "practice those times tables",
          },
        ],
      }),
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.actionsSkipped).toBe(1);
  });

  it("should handle malformed AI response gracefully", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);

    mockMeteredAI.mockResolvedValue({
      content: "not valid json at all",
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("JSON parse error");
  });

  it("should handle empty actions array", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);

    mockMeteredAI.mockResolvedValue({
      content: JSON.stringify({ actions: [] }),
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.actionsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should skip actions with invalid type", async () => {
    const { extractActions } = await import("@/lib/actions/extract-actions");

    mockPrisma.callAction.findMany.mockResolvedValue([]);

    mockMeteredAI.mockResolvedValue({
      content: JSON.stringify({
        actions: [
          {
            t: "INVALID_TYPE",
            a: "CALLER",
            ti: "Something",
            d: "",
            p: "MEDIUM",
            co: 0.9,
            ev: "evidence",
          },
        ],
      }),
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await extractActions(
      { id: "call-1", transcript: "A".repeat(200) },
      "caller-1",
      "gpt-4o" as any,
      mockLog
    );

    expect(result.actionsCreated).toBe(0);
    expect(result.actionsSkipped).toBe(1);
  });
});
