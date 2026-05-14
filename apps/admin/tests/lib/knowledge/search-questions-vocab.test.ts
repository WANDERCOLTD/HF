/**
 * Tests for question and vocabulary search + formatters in assertions.ts
 *
 * Verifies:
 * - searchQuestions returns scored results
 * - searchQuestions returns empty for no keywords
 * - searchVocabulary returns scored results
 * - searchVocabulary returns empty for no keywords
 * - formatQuestion formats correctly
 * - formatVocabulary formats correctly
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  questionFindMany: vi.fn(),
  vocabularyFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentQuestion: { findMany: mocks.questionFindMany },
    contentVocabulary: { findMany: mocks.vocabularyFindMany },
    contentAssertion: { findMany: vi.fn().mockResolvedValue([]) },
    callerMemory: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/embeddings", () => ({
  toVectorLiteral: vi.fn(),
}));

import {
  searchQuestions,
  searchVocabulary,
  formatQuestion,
  formatVocabulary,
} from "@/lib/knowledge/assertions";
import type { QuestionResult, VocabularyResult } from "@/lib/knowledge/assertions";

describe("searchQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for query with no valid keywords", async () => {
    const result = await searchQuestions("a b", 5);
    expect(result).toEqual([]);
    expect(mocks.questionFindMany).not.toHaveBeenCalled();
  });

  it("returns scored results matching query", async () => {
    mocks.questionFindMany.mockResolvedValue([
      {
        questionText: "What caused the Black Death?",
        questionType: "MCQ",
        correctAnswer: "Yersinia pestis",
        difficulty: 3,
        tags: ["plague", "history"],
      },
      {
        questionText: "When did the plague reach England?",
        questionType: "SHORT_ANSWER",
        correctAnswer: "1348",
        difficulty: 2,
        tags: ["plague"],
      },
    ]);

    const results = await searchQuestions("black death plague", 5);
    expect(results).toHaveLength(2);
    expect(results[0].questionText).toBeDefined();
    expect(results[0].relevanceScore).toBeGreaterThan(0);
    // Results should be sorted by relevance (descending)
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(results[1].relevanceScore);
  });

  it("respects limit", async () => {
    mocks.questionFindMany.mockResolvedValue([
      { questionText: "Q1 food safety", questionType: "MCQ", correctAnswer: "A", difficulty: 1, tags: ["food"] },
      { questionText: "Q2 food hygiene", questionType: "MCQ", correctAnswer: "B", difficulty: 2, tags: ["food"] },
      { questionText: "Q3 food temperature", questionType: "MCQ", correctAnswer: "C", difficulty: 3, tags: ["food"] },
    ]);

    const results = await searchQuestions("food safety hygiene", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("searchVocabulary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for query with no valid keywords", async () => {
    const result = await searchVocabulary("a b", 5);
    expect(result).toEqual([]);
    expect(mocks.vocabularyFindMany).not.toHaveBeenCalled();
  });

  it("returns scored results matching query", async () => {
    mocks.vocabularyFindMany.mockResolvedValue([
      {
        term: "to clash",
        definition: "to be in conflict or at odds with",
        partOfSpeech: "verb",
        topic: "Negotiation",
        tags: ["conflict"],
      },
      {
        term: "negotiation",
        definition: "a discussion aimed at reaching an agreement",
        partOfSpeech: "noun",
        topic: "Business",
        tags: ["business"],
      },
    ]);

    const results = await searchVocabulary("clash conflict negotiation", 5);
    expect(results).toHaveLength(2);
    expect(results[0].term).toBeDefined();
    expect(results[0].definition).toBeDefined();
    expect(results[0].relevanceScore).toBeGreaterThan(0);
  });

  it("boosts term matches over definition matches", async () => {
    mocks.vocabularyFindMany.mockResolvedValue([
      {
        term: "plague",
        definition: "a deadly disease",
        partOfSpeech: "noun",
        topic: null,
        tags: [],
      },
      {
        term: "epidemic",
        definition: "a widespread occurrence of plague",
        partOfSpeech: "noun",
        topic: null,
        tags: [],
      },
    ]);

    const results = await searchVocabulary("plague disease", 5);
    // "plague" has a direct term match, should score higher
    const plagueResult = results.find((r) => r.term === "plague");
    const epidemicResult = results.find((r) => r.term === "epidemic");
    expect(plagueResult).toBeDefined();
    expect(epidemicResult).toBeDefined();
    expect(plagueResult!.relevanceScore).toBeGreaterThanOrEqual(epidemicResult!.relevanceScore);
  });
});

describe("formatQuestion", () => {
  it("formats MCQ with answer and difficulty", () => {
    const q: QuestionResult = {
      questionText: "What year did the Black Death arrive?",
      questionType: "MCQ",
      correctAnswer: "1347",
      difficulty: 3,
      tags: [],
      relevanceScore: 0.8,
    };
    const formatted = formatQuestion(q);
    expect(formatted).toContain("[QUESTION: MCQ]");
    expect(formatted).toContain("What year did the Black Death arrive?");
    expect(formatted).toContain("→ 1347");
    expect(formatted).toContain("[Difficulty: 3]");
  });

  it("formats question without answer or difficulty", () => {
    const q: QuestionResult = {
      questionText: "Discuss the impact of the plague.",
      questionType: "OPEN",
      correctAnswer: null,
      difficulty: null,
      tags: [],
      relevanceScore: 0.6,
    };
    const formatted = formatQuestion(q);
    expect(formatted).toContain("[QUESTION: OPEN]");
    expect(formatted).toContain("Discuss the impact of the plague.");
    expect(formatted).not.toContain("→");
    expect(formatted).not.toContain("[Difficulty:");
  });
});

describe("formatVocabulary", () => {
  it("formats vocabulary with part of speech", () => {
    const v: VocabularyResult = {
      term: "to clash",
      definition: "to be in conflict",
      partOfSpeech: "verb",
      topic: "Negotiation",
      relevanceScore: 0.9,
    };
    const formatted = formatVocabulary(v);
    expect(formatted).toBe("[VOCABULARY] to clash (verb): to be in conflict");
  });

  it("formats vocabulary without part of speech", () => {
    const v: VocabularyResult = {
      term: "HACCP",
      definition: "Hazard Analysis and Critical Control Points",
      partOfSpeech: null,
      topic: null,
      relevanceScore: 0.7,
    };
    const formatted = formatVocabulary(v);
    expect(formatted).toBe("[VOCABULARY] HACCP: Hazard Analysis and Critical Control Points");
  });
});
