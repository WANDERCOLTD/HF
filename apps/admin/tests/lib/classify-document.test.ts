import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractionConfig } from "@/lib/content-trust/resolve-config";
import type { ClassificationExample } from "@/lib/content-trust/classify-document";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getConfiguredMeteredAICompletion: vi.fn(),
  logAssistantCall: vi.fn(),
  getAITimeoutSettings: vi.fn().mockResolvedValue({ classificationTimeoutMs: 30000 }),
  prisma: {
    subjectSource: { findMany: vi.fn() },
    contentSource: { findMany: vi.fn() },
    subject: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: mocks.getConfiguredMeteredAICompletion,
}));

vi.mock("@/lib/ai/assistant-wrapper", () => ({
  logAssistantCall: mocks.logAssistantCall,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
  db: (tx?: unknown) => tx ?? mocks.prisma,
}));

vi.mock("@/lib/system-settings", () => ({
  getAITimeoutSettings: mocks.getAITimeoutSettings,
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal extraction config with just the classification section used by classifyDocument */
function makeConfig(overrides: Partial<ExtractionConfig["classification"]> = {}): ExtractionConfig {
  return {
    classification: {
      systemPrompt: "test prompt",
      llmConfig: { temperature: 0.1, maxTokens: 500 },
      sampleSize: 2000,
      fewShot: {
        enabled: true,
        maxExamples: 5,
        exampleSampleSize: 500,
        domainAware: true,
      },
      ...overrides,
    },
  } as ExtractionConfig;
}

/** Shorthand to make the AI mock resolve with a given JSON object (raw string) */
function mockAIReturn(json: Record<string, unknown>) {
  mocks.getConfiguredMeteredAICompletion.mockResolvedValueOnce({
    content: JSON.stringify(json),
  });
}

// ---------------------------------------------------------------------------
// Tests — classifyDocument
// ---------------------------------------------------------------------------

describe("classifyDocument", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAITimeoutSettings.mockResolvedValue({ classificationTimeoutMs: 30000 });
  });

  // We dynamically import so the vi.mock calls above are hoisted before the module loads
  async function classify(
    text: string,
    fileName: string,
    cfg: ExtractionConfig,
    examples?: ClassificationExample[],
  ) {
    const { classifyDocument } = await import("@/lib/content-trust/classify-document");
    return classifyDocument(text, fileName, cfg, examples);
  }

  it("classifies CURRICULUM document correctly", async () => {
    mockAIReturn({
      documentType: "CURRICULUM",
      confidence: 0.92,
      reasoning: "has LOs and ACs",
    });

    const result = await classify("Some curriculum text", "syllabus.pdf", makeConfig());

    expect(result).toEqual({
      documentType: "CURRICULUM",
      confidence: 0.92,
      reasoning: "has LOs and ACs",
    });

    expect(mocks.getConfiguredMeteredAICompletion).toHaveBeenCalledOnce();
    expect(mocks.logAssistantCall).toHaveBeenCalledOnce();
  });

  it("classifies WORKSHEET with markdown fences", async () => {
    mocks.getConfiguredMeteredAICompletion.mockResolvedValueOnce({
      content: '```json\n{"documentType":"WORKSHEET","confidence":0.87,"reasoning":"has questions"}\n```',
    });

    const result = await classify("Worksheet content", "activity.docx", makeConfig());

    expect(result).toEqual({
      documentType: "WORKSHEET",
      confidence: 0.87,
      reasoning: "has questions",
    });
  });

  it("falls back to TEXTBOOK on invalid type", async () => {
    mockAIReturn({
      documentType: "INVALID_TYPE",
      confidence: 0.8,
      reasoning: "test",
    });

    const result = await classify("Some text", "unknown.pdf", makeConfig());

    expect(result.documentType).toBe("TEXTBOOK");
    expect(result.confidence).toBe(0.8);
    expect(result.reasoning).toBe("test");
  });

  it("falls back to TEXTBOOK on AI error with classificationFailed flag", async () => {
    mocks.getConfiguredMeteredAICompletion.mockRejectedValueOnce(new Error("API timeout"));

    const result = await classify("Some text", "broken.pdf", makeConfig());

    expect(result).toEqual({
      documentType: "TEXTBOOK",
      confidence: 0.0,
      reasoning: expect.stringContaining("Classification failed: API timeout"),
      classificationFailed: true,
    });

    // logAssistantCall should NOT have been called since the error happened before it
    expect(mocks.logAssistantCall).not.toHaveBeenCalled();
  });

  it("clamps confidence to 0-1", async () => {
    mockAIReturn({
      documentType: "TEXTBOOK",
      confidence: 1.5,
      reasoning: "very confident",
    });

    const result = await classify("Some text", "textbook.pdf", makeConfig());

    expect(result.confidence).toBe(1.0);
  });

  it("uses default confidence when not a number", async () => {
    mockAIReturn({
      documentType: "ASSESSMENT",
      confidence: "high" as any,
      reasoning: "has exam questions",
    });

    const result = await classify("Some text", "exam.pdf", makeConfig());

    expect(result.confidence).toBe(0.5);
    expect(result.documentType).toBe("ASSESSMENT");
  });

  it("respects sampleSize config", async () => {
    const longText = "A".repeat(5000);
    const sampleSize = 100;

    mockAIReturn({
      documentType: "TEXTBOOK",
      confidence: 0.7,
      reasoning: "short sample",
    });

    await classify(longText, "long.pdf", makeConfig({ sampleSize }));

    // The user prompt passed to the AI should contain a sample constrained by sampleSize
    const callArgs = mocks.getConfiguredMeteredAICompletion.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage).toBeDefined();

    // The sample uses multi-point sampling (start+middle+end) so total length
    // includes section markers. But the raw text content must not exceed sampleSize.
    const sampleInPrompt = userMessage.content.split("--- TEXT SAMPLE ---\n")[1].split("\n--- END SAMPLE ---")[0];
    // Multi-point sampling adds markers like [START OF DOCUMENT], [MIDDLE OF DOCUMENT], [END OF DOCUMENT]
    // Total sample text (excluding markers) should not exceed sampleSize
    const rawTextOnly = sampleInPrompt
      .replace(/\[START OF DOCUMENT\]\n?/g, "")
      .replace(/\[MIDDLE OF DOCUMENT\]\n?/g, "")
      .replace(/\[END OF DOCUMENT\]\n?/g, "")
      .replace(/\n/g, "");
    expect(rawTextOnly.length).toBeLessThanOrEqual(sampleSize);
  });

  it("provides default reasoning when missing", async () => {
    mockAIReturn({
      documentType: "REFERENCE",
      confidence: 0.6,
    });

    const result = await classify("Some text", "glossary.pdf", makeConfig());

    expect(result.reasoning).toBe("No reasoning provided");
    expect(result.documentType).toBe("REFERENCE");
  });

  it("includes few-shot examples in prompt when provided", async () => {
    mockAIReturn({
      documentType: "WORKSHEET",
      confidence: 0.95,
      reasoning: "matches worksheet pattern from examples",
    });

    const examples: ClassificationExample[] = [
      {
        textSample: "Question 1: What is the Black Death?",
        fileName: "black-death-worksheet",
        documentType: "WORKSHEET",
        reasoning: "Originally classified as TEXTBOOK, corrected to WORKSHEET",
      },
    ];

    await classify("Activity: Answer the following questions", "activity.pdf", makeConfig(), examples);

    const callArgs = mocks.getConfiguredMeteredAICompletion.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");

    // Verify examples are in the prompt
    expect(userMessage.content).toContain("EXAMPLE 1");
    expect(userMessage.content).toContain("black-death-worksheet");
    expect(userMessage.content).toContain("Question 1: What is the Black Death?");
    expect(userMessage.content).toContain("Correct classification: WORKSHEET");
    expect(userMessage.content).toContain("corrected to WORKSHEET");
  });

  it("works correctly with empty few-shot examples array", async () => {
    mockAIReturn({
      documentType: "TEXTBOOK",
      confidence: 0.8,
      reasoning: "standard textbook",
    });

    const result = await classify("Some text", "textbook.pdf", makeConfig(), []);

    expect(result.documentType).toBe("TEXTBOOK");

    // Should NOT contain example markers
    const callArgs = mocks.getConfiguredMeteredAICompletion.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).not.toContain("EXAMPLE 1");
    expect(userMessage.content).not.toContain("correctly classified documents");
  });

  it("logs fewShotCount in metadata", async () => {
    mockAIReturn({
      documentType: "WORKSHEET",
      confidence: 0.9,
      reasoning: "worksheet",
    });

    const examples: ClassificationExample[] = [
      { textSample: "Q1", fileName: "ws1", documentType: "WORKSHEET", reasoning: "corrected" },
      { textSample: "Q2", fileName: "ws2", documentType: "WORKSHEET", reasoning: "corrected" },
    ];

    await classify("Some text", "test.pdf", makeConfig(), examples);

    expect(mocks.logAssistantCall).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ fewShotCount: 2 }),
      }),
      expect.anything(),
    );
  });

  it("overrides AI classification when filename strongly signals a different type", async () => {
    // AI says TEXTBOOK, but the filename says course-reference
    mockAIReturn({
      documentType: "TEXTBOOK",
      confidence: 0.75,
      reasoning: "contains educational content",
    });

    const result = await classify(
      "The tutor should always use scaffolding before giving answers",
      "11plus-english-course-reference.md",
      makeConfig(),
    );

    expect(result.documentType).toBe("COURSE_REFERENCE");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.reasoning).toContain("Filename signal");
  });

  it("does NOT override when AI classification matches filename hint", async () => {
    // AI correctly says COURSE_REFERENCE — no override needed
    mockAIReturn({
      documentType: "COURSE_REFERENCE",
      confidence: 0.92,
      reasoning: "tutor instruction document",
    });

    const result = await classify(
      "The tutor should always use scaffolding",
      "11plus-english-course-reference.md",
      makeConfig(),
    );

    expect(result.documentType).toBe("COURSE_REFERENCE");
    expect(result.confidence).toBe(0.92);
    expect(result.reasoning).toBe("tutor instruction document");
    // No "[Filename signal" annotation since AI got it right
    expect(result.reasoning).not.toContain("Filename signal");
  });

  it("overrides question-bank filename when AI says TEXTBOOK", async () => {
    mockAIReturn({
      documentType: "TEXTBOOK",
      confidence: 0.7,
      reasoning: "has questions and answers",
    });

    const result = await classify(
      "Question 1: What happened to Mary?",
      "P1_SecretGarden_QuestionBank.docx",
      makeConfig(),
    );

    expect(result.documentType).toBe("QUESTION_BANK");
    expect(result.reasoning).toContain("Filename signal");
  });
});

// ---------------------------------------------------------------------------
// Tests — fetchFewShotExamples
// ---------------------------------------------------------------------------

describe("fetchFewShotExamples", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function fetchExamples(
    options?: { sourceId?: string; domainId?: string },
    config?: ExtractionConfig["classification"]["fewShot"],
  ) {
    const { fetchFewShotExamples } = await import("@/lib/content-trust/classify-document");
    return fetchFewShotExamples(options, config);
  }

  it("returns empty array when no corrections exist", async () => {
    mocks.prisma.contentSource.findMany.mockResolvedValue([]);

    const result = await fetchExamples();

    expect(result).toEqual([]);
  });

  it("returns corrections as few-shot examples", async () => {
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce([
      {
        name: "Black Death Worksheet",
        textSample: "Question 1: What year did the Black Death arrive in England?",
        documentType: "WORKSHEET",
        aiClassification: "TEXTBOOK:0.85",
      },
    ]);

    const result = await fetchExamples();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      textSample: "Question 1: What year did the Black Death arrive in England?",
      fileName: "Black Death Worksheet",
      documentType: "WORKSHEET",
      reasoning: "Originally classified as TEXTBOOK, corrected to WORKSHEET",
    });
  });

  it("truncates example text to exampleSampleSize", async () => {
    const longSample = "A".repeat(1000);
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce([
      {
        name: "Long Doc",
        textSample: longSample,
        documentType: "TEXTBOOK",
        aiClassification: "REFERENCE:0.5",
      },
    ]);

    const result = await fetchExamples(undefined, {
      enabled: true,
      maxExamples: 5,
      exampleSampleSize: 200,
      domainAware: true,
    });

    expect(result[0].textSample.length).toBe(200);
  });

  it("resolves domain from sourceId for domain-aware queries", async () => {
    mocks.prisma.subjectSource.findMany.mockResolvedValueOnce([
      {
        subject: {
          domains: [{ domainId: "domain-123" }],
        },
      },
    ]);
    // Domain-specific query
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce([]);
    // Global fallback query
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce([]);

    await fetchExamples({ sourceId: "source-abc" });

    // Should have queried subjectSource to find domain
    expect(mocks.prisma.subjectSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId: "source-abc" },
      }),
    );
  });

  it("fills remaining slots with global corrections", async () => {
    // Domain-specific: 2 results
    mocks.prisma.subjectSource.findMany.mockResolvedValueOnce([
      { subject: { domains: [{ domainId: "d1" }] } },
    ]);
    mocks.prisma.contentSource.findMany
      .mockResolvedValueOnce([
        { name: "D1", textSample: "domain specific", documentType: "WORKSHEET", aiClassification: "TEXTBOOK:0.8" },
        { name: "D2", textSample: "domain specific 2", documentType: "CURRICULUM", aiClassification: "TEXTBOOK:0.7" },
      ])
      // Global fallback: 3 more
      .mockResolvedValueOnce([
        { name: "G1", textSample: "global", documentType: "ASSESSMENT", aiClassification: "TEXTBOOK:0.6" },
      ]);

    const result = await fetchExamples({ sourceId: "src-1" }, {
      enabled: true,
      maxExamples: 5,
      exampleSampleSize: 500,
      domainAware: true,
    });

    expect(result).toHaveLength(3); // 2 domain + 1 global
  });

  it("handles missing aiClassification gracefully", async () => {
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce([
      {
        name: "Manual Source",
        textSample: "Some content",
        documentType: "EXAMPLE",
        aiClassification: null,
      },
    ]);

    const result = await fetchExamples();

    expect(result[0].reasoning).toBe("Classified as EXAMPLE by admin");
  });

  it("respects maxExamples limit", async () => {
    const manySources = Array.from({ length: 10 }, (_, i) => ({
      name: `Source ${i}`,
      textSample: `Content ${i}`,
      documentType: "WORKSHEET",
      aiClassification: "TEXTBOOK:0.5",
    }));
    mocks.prisma.contentSource.findMany.mockResolvedValueOnce(manySources);

    const result = await fetchExamples(undefined, {
      enabled: true,
      maxExamples: 3,
      exampleSampleSize: 500,
      domainAware: true,
    });

    // The query itself should have take: 3
    expect(mocks.prisma.contentSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });
});
