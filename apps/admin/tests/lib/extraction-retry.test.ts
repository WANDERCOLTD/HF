import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the metered AI completion
const mockAICompletion = vi.fn();

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockAICompletion(...args),
}));

vi.mock("@/lib/ai/assistant-wrapper", () => ({
  logAssistantCall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    analysisSpec: { findFirst: vi.fn().mockResolvedValue(null) },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// Mock resolve-config to return a predictable config
vi.mock("@/lib/content-trust/resolve-config", () => ({
  resolveExtractionConfig: vi.fn().mockResolvedValue({
    extraction: {
      categories: [
        { id: "fact", description: "A factual statement" },
        { id: "definition", description: "A definition" },
      ],
      systemPrompt: "Extract teaching points as JSON array.",
      llmConfig: { temperature: 0.3, maxTokens: 4000 },
      chunkSize: 8000,
      maxAssertionsPerDocument: 500,
    },
  }),
}));

describe("extractAssertions retry logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("retries failed chunks with exponential backoff", async () => {
    // Fail twice, succeed on 3rd attempt
    mockAICompletion
      .mockRejectedValueOnce(new Error("Rate limit exceeded"))
      .mockRejectedValueOnce(new Error("Server error"))
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { assertion: "Tax rates apply at 20%", category: "fact", tags: ["tax"] },
        ]),
      });

    const { extractAssertions } = await import("@/lib/content-trust/extract-assertions");

    const result = await extractAssertions("This is a short test document about tax rates.", {
      sourceSlug: "test-source",
    });

    expect(result.ok).toBe(true);
    expect(result.assertions.length).toBe(1);
    expect(result.assertions[0].assertion).toBe("Tax rates apply at 20%");
    // Called 3 times total (2 failures + 1 success)
    expect(mockAICompletion).toHaveBeenCalledTimes(3);
  }, 15000);

  it("returns empty after all retries exhausted", async () => {
    // Fail all 3 attempts
    mockAICompletion
      .mockRejectedValueOnce(new Error("Error 1"))
      .mockRejectedValueOnce(new Error("Error 2"))
      .mockRejectedValueOnce(new Error("Error 3"));

    const { extractAssertions } = await import("@/lib/content-trust/extract-assertions");

    const result = await extractAssertions(
      "A".repeat(200), // non-trivial chunk to trigger the warning
      { sourceSlug: "test-source" },
    );

    expect(result.ok).toBe(true);
    expect(result.assertions.length).toBe(0);
    expect(mockAICompletion).toHaveBeenCalledTimes(3);
    // Should have a warning about failed chunks
    expect(result.warnings.some((w) => w.includes("failed extraction"))).toBe(true);
  }, 15000);

  it("succeeds on first attempt without retrying", async () => {
    mockAICompletion.mockResolvedValueOnce({
      content: JSON.stringify([
        { assertion: "The sky is blue", category: "fact", tags: [] },
      ]),
    });

    const { extractAssertions } = await import("@/lib/content-trust/extract-assertions");

    const result = await extractAssertions("The sky is blue and clear.", {
      sourceSlug: "test-source",
    });

    expect(result.ok).toBe(true);
    expect(result.assertions.length).toBe(1);
    expect(mockAICompletion).toHaveBeenCalledTimes(1);
    // No failure warnings
    expect(result.warnings.some((w) => w.includes("failed"))).toBe(false);
  }, 10000);
});
