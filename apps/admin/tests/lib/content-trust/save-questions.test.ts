/**
 * Tests for save-questions.ts
 *
 * Verifies:
 * - Empty array returns zero stats
 * - Deduplication by contentHash (skips existing)
 * - Creates only new questions
 * - deleteQuestionsForSource returns count
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentQuestion: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
      deleteMany: mocks.deleteMany,
    },
  },
};
  return { ..._p, db: (tx) => tx ?? _p.prisma };
});

import { saveQuestions, deleteQuestionsForSource } from "@/lib/content-trust/save-questions";
import type { ExtractedQuestion } from "@/lib/content-trust/extractors/base-extractor";

const makeQuestion = (overrides: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  questionText: "What year did the Black Death arrive?",
  questionType: "MCQ",
  options: [
    { label: "A", text: "1247", isCorrect: false },
    { label: "B", text: "1347", isCorrect: true },
  ],
  correctAnswer: "1347",
  contentHash: "abc123",
  ...overrides,
});

describe("saveQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.createMany.mockResolvedValue({ count: 0 });
  });

  it("returns zero stats for empty array", async () => {
    const result = await saveQuestions("src-1", []);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("creates all questions when none exist", async () => {
    const questions = [
      makeQuestion({ contentHash: "h1" }),
      makeQuestion({ contentHash: "h2", questionText: "True or false?" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await saveQuestions("src-1", questions);
    expect(result).toEqual({ created: 2, duplicatesSkipped: 0, semanticDuplicatesSkipped: 0 });
    expect(mocks.createMany).toHaveBeenCalledOnce();

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(2);
    expect(createData[0].sourceId).toBe("src-1");
    expect(createData[0].contentHash).toBe("h1");
    expect(createData[1].sortOrder).toBe(1);
  });

  it("skips duplicates by contentHash", async () => {
    mocks.findMany.mockResolvedValue([{ contentHash: "h1" }]);

    const questions = [
      makeQuestion({ contentHash: "h1" }),
      makeQuestion({ contentHash: "h2", questionText: "New question" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 1 });

    const result = await saveQuestions("src-1", questions);
    expect(result).toEqual({ created: 1, duplicatesSkipped: 1, semanticDuplicatesSkipped: 0 });

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0].contentHash).toBe("h2");
  });

  it("returns all skipped when all are duplicates", async () => {
    mocks.findMany.mockResolvedValue([{ contentHash: "h1" }, { contentHash: "h2" }]);

    const questions = [
      makeQuestion({ contentHash: "h1" }),
      makeQuestion({ contentHash: "h2" }),
    ];

    const result = await saveQuestions("src-1", questions);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 2, semanticDuplicatesSkipped: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  // ── #276 Slice 2: cross-question semantic dedup ──

  it("drops near-duplicate questions in the same batch (different hashes, ≥ 0.85 word overlap)", async () => {
    const questions = [
      makeQuestion({
        contentHash: "h1",
        questionText: "How many assessment criteria are used to evaluate IELTS Speaking performance",
      }),
      makeQuestion({
        contentHash: "h2",
        questionText: "How many assessment criteria are used in IELTS Speaking evaluation",
      }),
      makeQuestion({
        contentHash: "h3",
        questionText: "Why does speaking too slowly negatively impact fluency in IELTS Speaking",
      }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await saveQuestions("src-1", questions);
    // h1 + h3 keep, h2 dropped as semantic dupe of h1
    expect(result.created).toBe(2);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.semanticDuplicatesSkipped).toBe(1);
    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData.map((d: any) => d.contentHash)).toEqual(["h1", "h3"]);
  });

  it("drops a new question that's a semantic duplicate of one already persisted", async () => {
    mocks.findMany.mockResolvedValue([
      { contentHash: "old1", questionText: "How many assessment criteria are used to evaluate IELTS Speaking" },
    ]);
    const questions = [
      makeQuestion({
        contentHash: "h1",
        questionText: "How many assessment criteria are used in IELTS Speaking evaluation",
      }),
    ];
    const result = await saveQuestions("src-1", questions);
    expect(result.created).toBe(0);
    expect(result.semanticDuplicatesSkipped).toBe(1);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("keeps two genuinely different questions about the same topic", async () => {
    const questions = [
      makeQuestion({ contentHash: "h1", questionText: "What does Band 9 indicate in IELTS Speaking" }),
      makeQuestion({ contentHash: "h2", questionText: "Why is fluency assessed in IELTS Speaking" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });
    const result = await saveQuestions("src-1", questions);
    expect(result.created).toBe(2);
    expect(result.semanticDuplicatesSkipped).toBe(0);
  });

  // ── #276 Slice 3: trustLevel stamping ──

  it("stamps trustLevel: AI_ASSISTED on every persisted question", async () => {
    const questions = [makeQuestion({ contentHash: "h1" })];
    mocks.createMany.mockResolvedValue({ count: 1 });
    await saveQuestions("src-1", questions);
    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.trustLevel).toBe("AI_ASSISTED");
  });

  it("maps optional fields correctly", async () => {
    const q = makeQuestion({
      contentHash: "h1",
      answerExplanation: "Because of the timeline",
      markScheme: "1 mark for correct year",
      learningOutcomeRef: "LO1",
      difficulty: 3,
      pageRef: "p.42",
      chapter: "Ch 2",
      section: "2.1",
      tags: ["history", "plague"],
    });
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveQuestions("src-1", [q]);

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.answerExplanation).toBe("Because of the timeline");
    expect(data.markScheme).toBe("1 mark for correct year");
    expect(data.learningOutcomeRef).toBe("LO1");
    expect(data.difficulty).toBe(3);
    expect(data.pageRef).toBe("p.42");
    expect(data.chapter).toBe("Ch 2");
    expect(data.section).toBe("2.1");
    expect(data.tags).toEqual(["history", "plague"]);
  });
});

describe("deleteQuestionsForSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deleted count", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 5 });

    const result = await deleteQuestionsForSource("src-1");
    expect(result).toBe(5);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { sourceId: "src-1" } });
  });
});
