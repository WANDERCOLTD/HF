/**
 * Tests for artifact extraction from transcripts.
 *
 * Validates:
 * - Extraction from transcripts with proper AI call
 * - Deduplication against existing artifacts
 * - Trust level assignment (VERIFIED when assertionIds present)
 * - Confidence filtering
 * - Mock engine handling
 * - Short transcript skip
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  conversationArtifact: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
  contentAssertion: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockMeteredCompletion = vi.fn();
const mockLogMockUsage = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockMeteredCompletion(...args),
  logMockAIUsage: (...args: any[]) => mockLogMockUsage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
}));

vi.mock("@/lib/system-settings", () => ({
  getArtifactSettings: vi.fn().mockResolvedValue({
    confidenceThreshold: 0.6,
    similarityThreshold: 0.8,
    transcriptMinChars: 100,
    transcriptLimitChars: 4000,
  }),
  getAITimeoutSettings: vi.fn().mockResolvedValue({
    pipelineTimeoutMs: 60000,
    extractionTimeoutMs: 120000,
    classificationTimeoutMs: 15000,
    postPipelineTimeoutMs: 30000,
    quickExtractTimeoutMs: 15000,
    curriculumTimeoutMs: 90000,
  }),
}));

// =====================================================
// HELPERS
// =====================================================

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const SAMPLE_TRANSCRIPT =
  "User: Can you explain the ISA allowance?\n" +
  "Assistant: Of course! The annual ISA allowance for 2025/26 is twenty thousand pounds.\n" +
  "User: That's helpful. What about the pension lifetime allowance?\n" +
  "Assistant: The pension lifetime allowance was abolished in April 2024.\n" +
  "User: Great, can you give me a practice question on this?\n" +
  "Assistant: Sure! Here's one: A client has used £12,000 of their ISA allowance. How much can they still contribute this tax year?";

function makeAIResponse(artifacts: any[]) {
  return {
    content: JSON.stringify({ artifacts }),
    model: "claude-3-haiku",
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

// =====================================================
// TESTS
// =====================================================

describe("extractArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.conversationArtifact.findMany.mockResolvedValue([]);
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1", domainId: null });
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.conversationArtifact.create.mockImplementation(({ data }: any) => ({
      id: `artifact-${Date.now()}`,
      ...data,
    }));
  });

  it("should extract artifacts from a transcript", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockMeteredCompletion.mockResolvedValue(
      makeAIResponse([
        {
          t: "KEY_FACT",
          ti: "ISA Annual Allowance",
          c: "The annual ISA allowance for 2025/26 is £20,000.",
          co: 0.95,
          ev: "the annual ISA allowance for 2025/26 is twenty thousand pounds",
        },
        {
          t: "EXERCISE",
          ti: "ISA Remaining Allowance",
          c: "A client has used £12,000 of their ISA allowance. How much can they still contribute this tax year?",
          co: 0.9,
          ev: "Here's one: A client has used £12,000",
        },
      ])
    );

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(2);
    expect(result.artifactsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockPrisma.conversationArtifact.create).toHaveBeenCalledTimes(2);

    // Check first artifact was created with correct data
    const firstCall = mockPrisma.conversationArtifact.create.mock.calls[0][0].data;
    expect(firstCall.type).toBe("KEY_FACT");
    expect(firstCall.title).toBe("ISA Annual Allowance");
    expect(firstCall.callId).toBe("call-1");
    expect(firstCall.callerId).toBe("caller-1");
    expect(firstCall.trustLevel).toBe("INFERRED"); // No assertionIds
  });

  it("should set trust level to VERIFIED when assertionIds present", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockMeteredCompletion.mockResolvedValue(
      makeAIResponse([
        {
          t: "KEY_FACT",
          ti: "ISA Allowance",
          c: "The ISA allowance is £20,000.",
          co: 0.95,
          ev: "ISA allowance",
          aids: ["assertion-1", "assertion-2"],
        },
      ])
    );

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(1);
    const createData = mockPrisma.conversationArtifact.create.mock.calls[0][0].data;
    expect(createData.trustLevel).toBe("VERIFIED");
    expect(createData.contentAssertionIds).toEqual(["assertion-1", "assertion-2"]);
  });

  it("should skip artifacts below confidence threshold", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockMeteredCompletion.mockResolvedValue(
      makeAIResponse([
        {
          t: "KEY_FACT",
          ti: "Low Confidence Fact",
          c: "Maybe something about pensions.",
          co: 0.3, // Below 0.6 threshold
          ev: "vague mention",
        },
      ])
    );

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(result.artifactsSkipped).toBe(1);
  });

  it("should deduplicate against existing artifacts", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockPrisma.conversationArtifact.findMany.mockResolvedValue([
      { id: "existing-1", type: "KEY_FACT", title: "ISA Annual Allowance" },
    ]);

    mockMeteredCompletion.mockResolvedValue(
      makeAIResponse([
        {
          t: "KEY_FACT",
          ti: "ISA Annual Allowance", // Exact duplicate
          c: "The ISA allowance is £20,000.",
          co: 0.95,
          ev: "ISA allowance",
        },
      ])
    );

    const result = await extractArtifacts(
      { id: "call-2", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(result.artifactsSkipped).toBe(1);
  });

  it("should skip extraction for short transcripts", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    const result = await extractArtifacts(
      { id: "call-1", transcript: "Hi" },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(mockMeteredCompletion).not.toHaveBeenCalled();
  });

  it("should handle mock engine gracefully", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "mock",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(mockMeteredCompletion).not.toHaveBeenCalled();
    expect(mockLogMockUsage).toHaveBeenCalled();
  });

  it("should handle null transcript", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    const result = await extractArtifacts(
      { id: "call-1", transcript: null },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(mockMeteredCompletion).not.toHaveBeenCalled();
  });

  it("should handle malformed AI response", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockMeteredCompletion.mockResolvedValue({
      content: "not valid json {{{",
      model: "claude-3-haiku",
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should handle empty artifacts array from AI", async () => {
    const { extractArtifacts } = await import("@/lib/artifacts/extract-artifacts");

    mockMeteredCompletion.mockResolvedValue(makeAIResponse([]));

    const result = await extractArtifacts(
      { id: "call-1", transcript: SAMPLE_TRANSCRIPT },
      "caller-1",
      "claude",
      mockLog
    );

    expect(result.artifactsCreated).toBe(0);
    expect(result.artifactsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
