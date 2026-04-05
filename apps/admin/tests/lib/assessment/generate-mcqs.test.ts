import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentQuestion: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    contentAssertion: {
      findMany: vi.fn(),
    },
    curriculum: {
      count: vi.fn(),
    },
    subjectSource: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: vi.fn(),
}));

vi.mock("@/lib/content-trust/save-questions", () => ({
  saveQuestions: vi.fn(),
  deleteQuestionsForSource: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { saveQuestions } from "@/lib/content-trust/save-questions";
import {
  generateMcqsForSource,
  sourceNeedsMcqs,
  isLinkedSource,
  maybeGenerateMcqs,
} from "@/lib/assessment/generate-mcqs";

const mocks = {
  prisma: prisma as any,
  ai: getConfiguredMeteredAICompletion as ReturnType<typeof vi.fn>,
  save: saveQuestions as ReturnType<typeof vi.fn>,
};

describe("generate-mcqs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sourceNeedsMcqs", () => {
    it("returns true when no MCQs exist", async () => {
      mocks.prisma.contentQuestion.count.mockResolvedValue(0);
      expect(await sourceNeedsMcqs("src-1")).toBe(true);
    });

    it("returns false when MCQs exist", async () => {
      mocks.prisma.contentQuestion.count.mockResolvedValue(3);
      expect(await sourceNeedsMcqs("src-1")).toBe(false);
    });
  });

  describe("isLinkedSource", () => {
    it("returns true when source is primarySource for a curriculum", async () => {
      mocks.prisma.curriculum.count.mockResolvedValue(1);
      mocks.prisma.subjectSource.count.mockResolvedValue(0);
      expect(await isLinkedSource("src-1")).toBe(true);
    });

    it("returns true when source is linked via SubjectSource", async () => {
      mocks.prisma.curriculum.count.mockResolvedValue(0);
      mocks.prisma.subjectSource.count.mockResolvedValue(1);
      expect(await isLinkedSource("src-1")).toBe(true);
    });

    it("returns false when source has no links", async () => {
      mocks.prisma.curriculum.count.mockResolvedValue(0);
      mocks.prisma.subjectSource.count.mockResolvedValue(0);
      expect(await isLinkedSource("src-1")).toBe(false);
    });
  });

  describe("generateMcqsForSource", () => {
    it("skips when too few assertions", async () => {
      mocks.prisma.contentAssertion.findMany.mockResolvedValue([
        { id: "a1", assertion: "Fact 1", category: "concept", chapter: null, section: null },
      ]);

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("too_few_assertions");
      expect(mocks.ai).not.toHaveBeenCalled();
    });

    it("generates MCQs from assertions and saves them", async () => {
      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`,
        assertion: `Concept ${i}: important fact about topic ${i}`,
        category: "concept",
        chapter: `Chapter ${i}`,
        section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);

      const aiResponse = JSON.stringify([
        {
          question: "What is concept 0?",
          options: [
            { label: "A", text: "Correct answer", isCorrect: true },
            { label: "B", text: "Wrong 1", isCorrect: false },
            { label: "C", text: "Wrong 2", isCorrect: false },
            { label: "D", text: "Wrong 3", isCorrect: false },
          ],
          correctAnswer: "A",
          chapter: "Chapter 0",
          explanation: "Because fact 0",
        },
        {
          question: "What is concept 1?",
          options: [
            { label: "A", text: "Wrong 1", isCorrect: false },
            { label: "B", text: "Correct answer", isCorrect: true },
            { label: "C", text: "Wrong 2", isCorrect: false },
            { label: "D", text: "Wrong 3", isCorrect: false },
          ],
          correctAnswer: "B",
          chapter: "Chapter 1",
          explanation: "Because fact 1",
        },
      ]);

      mocks.ai.mockResolvedValue({ content: aiResponse });
      mocks.save.mockResolvedValue({ created: 2, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(false);
      expect(result.created).toBe(2);
      expect(mocks.save).toHaveBeenCalledWith("src-1", expect.arrayContaining([
        expect.objectContaining({
          questionText: "What is concept 0?",
          questionType: "MCQ",
          correctAnswer: "A",
          tags: ["auto-generated"],
        }),
      ]), undefined);
    });

    it("handles AI returning no content", async () => {
      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, assertion: `Fact ${i}`, category: "concept", chapter: null, section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);
      mocks.ai.mockResolvedValue({ content: null });

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("ai_no_response");
    });

    it("excludes instruction-category assertions from AI prompt", async () => {
      // Mix of student content and instruction categories
      const assertions = [
        { id: "a1", assertion: "Photosynthesis converts light to energy", category: "fact", chapter: "Ch1", section: null },
        { id: "a2", assertion: "Cells divide through mitosis", category: "definition", chapter: "Ch2", section: null },
        { id: "a3", assertion: "Students at Emerging level can identify explicit info", category: "assessment_guidance", chapter: null, section: null },
        { id: "a4", assertion: "Session 1 covers retrieval skills", category: "session_metadata", chapter: null, section: null },
        { id: "a5", assertion: "SKILL-01 focuses on recall", category: "skill_description", chapter: null, section: null },
        { id: "a6", assertion: "Water boils at 100C", category: "fact", chapter: "Ch3", section: null },
      ];
      // The query uses notIn filter — mock should only return non-instruction assertions
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(
        assertions.filter((a) => !["assessment_guidance", "session_metadata", "skill_description"].includes(a.category)),
      );
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "What does photosynthesis convert?",
          options: [
            { label: "A", text: "Light to energy", isCorrect: true },
            { label: "B", text: "Water to air", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(false);

      // Verify the AI prompt only contains subject matter, not framework language
      const aiCall = mocks.ai.mock.calls[0][0];
      const userMessage = aiCall.messages.find((m: any) => m.role === "user")?.content;
      expect(userMessage).toContain("Photosynthesis");
      expect(userMessage).toContain("Water boils");
      expect(userMessage).not.toContain("Emerging level");
      expect(userMessage).not.toContain("session_metadata");
      expect(userMessage).not.toContain("SKILL-01");
    });

    it("drops questions containing framework/rubric language", async () => {
      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, assertion: `Fact ${i}`, category: "fact", chapter: null, section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);

      // AI returns a mix of good and bad questions
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([
          {
            question: "What does photosynthesis produce?",
            options: [
              { label: "A", text: "Oxygen", isCorrect: true },
              { label: "B", text: "Carbon dioxide", isCorrect: false },
            ],
            correctAnswer: "A",
          },
          {
            question: "According to the skill framework, what characterizes a student at the Emerging level?",
            options: [
              { label: "A", text: "Can recall", isCorrect: false },
              { label: "B", text: "Describes plot events", isCorrect: true },
            ],
            correctAnswer: "B",
          },
          {
            question: "What does SKILL-02 assess in this assessment framework?",
            options: [
              { label: "A", text: "Inference", isCorrect: true },
              { label: "B", text: "Recall", isCorrect: false },
            ],
            correctAnswer: "A",
          },
        ]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(false);

      // Only the clean question should be saved
      const savedQuestions = mocks.save.mock.calls[0][1];
      expect(savedQuestions).toHaveLength(1);
      expect(savedQuestions[0].questionText).toBe("What does photosynthesis produce?");
    });

    it("deduplicates via contentHash", async () => {
      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, assertion: `Fact ${i}`, category: "concept", chapter: null, section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Q1?",
          options: [
            { label: "A", text: "Right", isCorrect: true },
            { label: "B", text: "Wrong", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 0, duplicatesSkipped: 1 });

      const result = await generateMcqsForSource("src-1");
      expect(result.duplicatesSkipped).toBe(1);
      expect(result.created).toBe(0);
    });
  });

  describe("maybeGenerateMcqs", () => {
    it("skips when source has no links", async () => {
      mocks.prisma.contentQuestion.count.mockResolvedValue(0);
      mocks.prisma.curriculum.count.mockResolvedValue(0);
      mocks.prisma.subjectSource.count.mockResolvedValue(0);

      await maybeGenerateMcqs("src-1");
      expect(mocks.ai).not.toHaveBeenCalled();
    });

    it("skips when MCQs already exist", async () => {
      mocks.prisma.contentQuestion.count.mockResolvedValue(5);
      mocks.prisma.curriculum.count.mockResolvedValue(1);
      mocks.prisma.subjectSource.count.mockResolvedValue(0);

      await maybeGenerateMcqs("src-1");
      expect(mocks.ai).not.toHaveBeenCalled();
    });

    it("generates when source is linked via SubjectSource and has no MCQs", async () => {
      // sourceNeedsMcqs → true
      mocks.prisma.contentQuestion.count.mockResolvedValue(0);
      // isLinkedSource → true (via SubjectSource, not primarySource)
      mocks.prisma.curriculum.count.mockResolvedValue(0);
      mocks.prisma.subjectSource.count.mockResolvedValue(1);
      // generateMcqsForSource needs assertions
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `a${i}`, assertion: `Fact ${i}`, category: "concept", chapter: null, section: null,
        })),
      );
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Q?",
          options: [
            { label: "A", text: "Right", isCorrect: true },
            { label: "B", text: "Wrong", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      await maybeGenerateMcqs("src-1", "user-1", "ss-1");
      expect(mocks.ai).toHaveBeenCalled();
      expect(mocks.save).toHaveBeenCalledWith("src-1", expect.any(Array), "ss-1");
    });
  });
});
