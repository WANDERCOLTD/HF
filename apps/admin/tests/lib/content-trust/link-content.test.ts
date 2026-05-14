/**
 * Tests for link-content.ts
 *
 * Tests the scoring algorithm and keyword extraction.
 * Database operations are mocked via prisma mock.
 *
 * Verifies:
 * - LO reference matching gives highest boost
 * - Chapter/section matching boosts score
 * - Keyword overlap (Jaccard) contributes to score
 * - Tag overlap contributes to score
 * - Items below threshold remain orphaned
 * - Linking is non-destructive (only updates NULL assertionId)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    contentQuestion: { findMany: vi.fn(), update: vi.fn() },
    contentVocabulary: { findMany: vi.fn(), update: vi.fn() },
    subjectSource: { findMany: vi.fn() },
  },
  getContentLinkingSettings: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma, db: (tx?: unknown) => tx ?? mocks.prisma }));
vi.mock("@prisma/client", () => ({ Prisma: { sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }) } }));
vi.mock("@/lib/system-settings", () => ({
  getContentLinkingSettings: mocks.getContentLinkingSettings,
  CONTENT_LINKING_DEFAULTS: {
    minKeywordScore: 0.15,
    loRefMatchBoost: 0.5,
    chapterMatchBoost: 0.2,
    minLinkScore: 0.35,
    useVectorSimilarity: false, // Disable vector for unit tests
    minVectorSimilarity: 0.6,
  },
}));
vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(),
  toVectorLiteral: vi.fn(),
}));

import { linkContentForSource } from "@/lib/content-trust/link-content";

describe("linkContentForSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContentLinkingSettings.mockResolvedValue({
      minKeywordScore: 0.15,
      loRefMatchBoost: 0.5,
      chapterMatchBoost: 0.2,
      minLinkScore: 0.35,
      useVectorSimilarity: false,
      minVectorSimilarity: 0.6,
    });
  });

  it("returns zeros when no assertions exist and no sibling sources either", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
    mocks.prisma.subjectSource.findMany.mockResolvedValueOnce([]); // no siblings

    const result = await linkContentForSource("source-1");

    expect(result.questionsLinked).toBe(0);
    expect(result.questionsOrphaned).toBe(0);
    expect(result.vocabularyLinked).toBe(0);
    expect(result.vocabularyOrphaned).toBe(0);
    expect(result.warnings).toContain("No assertions found for source or its siblings");
  });

  it("returns zeros when no unlinked questions or vocabulary", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "The ISA allowance is £20,000", chapter: "Ch 1", section: null, learningOutcomeRef: "LO1", tags: ["tax"], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([]);

    const result = await linkContentForSource("source-1");

    expect(result.questionsLinked).toBe(0);
    expect(result.questionsOrphaned).toBe(0);
  });

  it("links a question to assertion via LO reference match", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "The ISA allowance is £20,000 for 2025/26", chapter: "Ch 1", section: null, learningOutcomeRef: "R04-LO2", tags: ["tax", "isa"], hasEmbedding: false },
      { id: "a2", assertion: "Capital gains tax rate is 20%", chapter: "Ch 2", section: null, learningOutcomeRef: "R04-LO3", tags: ["tax", "cgt"], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([
      { id: "q1", questionText: "What is the ISA allowance?", chapter: null, section: null, learningOutcomeRef: "R04-LO2", tags: [] },
    ]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([]);

    const result = await linkContentForSource("source-1");

    expect(result.questionsLinked).toBe(1);
    expect(mocks.prisma.contentQuestion.update).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { assertionId: "a1" },
    });
  });

  it("links a question via chapter match when no LO ref", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "Photosynthesis converts sunlight into energy", chapter: "Chapter 3", section: null, learningOutcomeRef: null, tags: ["biology"], hasEmbedding: false },
      { id: "a2", assertion: "Mitosis is cell division", chapter: "Chapter 4", section: null, learningOutcomeRef: null, tags: ["biology"], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([
      { id: "q1", questionText: "How does photosynthesis convert sunlight into energy for the plant?", chapter: "Chapter 3", section: null, learningOutcomeRef: null, tags: ["biology"] },
    ]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([]);

    const result = await linkContentForSource("source-1");

    // Chapter match (0.2) + keyword overlap (photosynthesis, sunlight, energy, converts) + tag overlap
    expect(result.questionsLinked).toBe(1);
    expect(mocks.prisma.contentQuestion.update).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { assertionId: "a1" },
    });
  });

  it("leaves questions orphaned when score is below threshold", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "The ISA allowance is £20,000", chapter: "Ch 1", section: null, learningOutcomeRef: "LO1", tags: ["tax"], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([
      { id: "q1", questionText: "What color is the sky?", chapter: "Ch 99", section: null, learningOutcomeRef: "LO99", tags: ["weather"] },
    ]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([]);

    const result = await linkContentForSource("source-1");

    expect(result.questionsOrphaned).toBe(1);
    expect(result.questionsLinked).toBe(0);
    expect(mocks.prisma.contentQuestion.update).not.toHaveBeenCalled();
  });

  it("links vocabulary via keyword overlap", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "An Individual Savings Account (ISA) provides tax-free returns on investments", chapter: "Ch 1", section: null, learningOutcomeRef: null, tags: ["isa"], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([
      { id: "v1", term: "ISA", definition: "Individual Savings Account — a tax-free wrapper for investments and savings", chapter: "Ch 1", topic: "savings", tags: ["isa"] },
    ]);

    const result = await linkContentForSource("source-1");

    // Chapter match (0.2) + keyword overlap (individual, savings, account, isa, tax, investments) + tag overlap
    expect(result.vocabularyLinked).toBe(1);
    expect(mocks.prisma.contentVocabulary.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { assertionId: "a1" },
    });
  });

  it("generates warnings for orphaned items", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { id: "a1", assertion: "Something about maths", chapter: null, section: null, learningOutcomeRef: null, tags: [], hasEmbedding: false },
    ]);
    mocks.prisma.contentQuestion.findMany.mockResolvedValueOnce([
      { id: "q1", questionText: "Completely unrelated question about history", chapter: null, section: null, learningOutcomeRef: null, tags: [] },
    ]);
    mocks.prisma.contentVocabulary.findMany.mockResolvedValueOnce([
      { id: "v1", term: "quasar", definition: "a massive and extremely remote celestial object", chapter: null, topic: null, tags: [] },
    ]);

    const result = await linkContentForSource("source-1");

    expect(result.warnings.some((w) => w.includes("could not be linked"))).toBe(true);
  });
});
