import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentQuestion: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contentAssertion: {
      findMany: vi.fn(),
    },
    contentSource: {
      findUnique: vi.fn(),
    },
    curriculum: {
      count: vi.fn(),
    },
    subjectSource: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
  regenerateSiblingMcqs,
} from "@/lib/assessment/generate-mcqs";

const mocks = {
  prisma: prisma as any,
  ai: getConfiguredMeteredAICompletion as ReturnType<typeof vi.fn>,
  save: saveQuestions as ReturnType<typeof vi.fn>,
};

/** Helper: mock a non-comprehension teaching profile (default path) */
function mockDefaultTeachingProfile(): void {
  mocks.prisma.subjectSource.findUnique.mockResolvedValue(null);
  mocks.prisma.subjectSource.findFirst.mockResolvedValue(null);
}

/** Helper: mock a comprehension-led teaching profile */
function mockComprehensionProfile(subjectId = "sub-1"): void {
  mocks.prisma.subjectSource.findUnique.mockResolvedValue({
    subject: { id: subjectId, teachingProfile: "comprehension-led" },
  });
  mocks.prisma.subjectSource.findFirst.mockResolvedValue({
    subject: { id: subjectId, teachingProfile: "comprehension-led" },
  });
}

/** Helper: mock TUTOR_QUESTIONs from a question bank */
function mockTutorQuestions(count = 5): void {
  const tutorQs = Array.from({ length: count }, (_, i) => ({
    questionText: `How does the character feel in scene ${i}?`,
    skillRef: `SKILL-0${(i % 4) + 1}:${["Retrieval", "Inference", "Vocabulary", "Language Effect"][i % 4]}`,
    bloomLevel: ["REMEMBER", "UNDERSTAND", "UNDERSTAND", "ANALYZE"][i % 4],
    metadata: {
      modelResponses: {
        emerging: { response: `Simple answer ${i}`, tutorMove: `Guide ${i}` },
        developing: { response: `Better answer ${i}`, tutorMove: `Push ${i}` },
        secure: { response: `Strong analytical answer ${i}`, tutorMove: `Confirm ${i}` },
      },
      assessmentNote: `Tests comprehension skill ${i}`,
    },
  }));

  // Mock the sibling QB sources lookup
  mocks.prisma.subjectSource.findMany.mockResolvedValue(
    [{ sourceId: "qb-src-1" }],
  );
  // Mock TUTOR_QUESTION fetch
  mocks.prisma.contentQuestion.findMany.mockResolvedValue(tutorQs);
}

describe("generate-mcqs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: source is a reading passage (eligible for MCQ generation)
    mocks.prisma.contentSource.findUnique.mockResolvedValue({ documentType: "READING_PASSAGE" });
    mockDefaultTeachingProfile();
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
    it("skips COURSE_REFERENCE and QUESTION_BANK document types", async () => {
      for (const docType of ["COURSE_REFERENCE", "QUESTION_BANK"]) {
        mocks.prisma.contentSource.findUnique.mockResolvedValue({ documentType: docType });
        const result = await generateMcqsForSource("src-1");
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("excluded_doc_type");
        expect(mocks.ai).not.toHaveBeenCalled();
      }
    });

    it("skips when too few assertions", async () => {
      mocks.prisma.contentAssertion.findMany.mockResolvedValue([
        { id: "a1", assertion: "Fact 1", category: "concept", chapter: null, section: null },
      ]);

      const result = await generateMcqsForSource("src-1");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("too_few_assertions");
      expect(mocks.ai).not.toHaveBeenCalled();
    });

    it("generates bloom-distributed MCQs from assertions", async () => {
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
          bloomLevel: "REMEMBER",
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
          question: "Why does concept 1 matter?",
          bloomLevel: "UNDERSTAND",
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
          bloomLevel: "REMEMBER",
          assessmentUse: "BOTH",
          tags: expect.arrayContaining(["auto-generated", "bloom-distributed"]),
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
      const assertions = [
        { id: "a1", assertion: "Photosynthesis converts light to energy", category: "fact", chapter: "Ch1", section: null },
        { id: "a2", assertion: "Cells divide through mitosis", category: "definition", chapter: "Ch2", section: null },
        { id: "a3", assertion: "Students at Emerging level can identify explicit info", category: "assessment_guidance", chapter: null, section: null },
        { id: "a4", assertion: "Session 1 covers retrieval skills", category: "session_metadata", chapter: null, section: null },
        { id: "a5", assertion: "SKILL-01 focuses on recall", category: "skill_description", chapter: null, section: null },
        { id: "a6", assertion: "Water boils at 100C", category: "fact", chapter: "Ch3", section: null },
      ];
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(
        assertions.filter((a) => !["assessment_guidance", "session_metadata", "skill_description"].includes(a.category)),
      );
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "What does photosynthesis convert?",
          bloomLevel: "REMEMBER",
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

      mocks.ai.mockResolvedValue({
        content: JSON.stringify([
          {
            question: "What does photosynthesis produce?",
            bloomLevel: "REMEMBER",
            options: [
              { label: "A", text: "Oxygen", isCorrect: true },
              { label: "B", text: "Carbon dioxide", isCorrect: false },
            ],
            correctAnswer: "A",
          },
          {
            question: "According to the skill framework, what characterizes a student at the Emerging level?",
            bloomLevel: "UNDERSTAND",
            options: [
              { label: "A", text: "Can recall", isCorrect: false },
              { label: "B", text: "Describes plot events", isCorrect: true },
            ],
            correctAnswer: "B",
          },
          {
            question: "What does SKILL-02 assess in this assessment framework?",
            bloomLevel: "ANALYZE",
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
          bloomLevel: "REMEMBER",
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

  // ── Comprehension path tests ──
  describe("generateMcqsForSource — comprehension path", () => {
    beforeEach(() => {
      mockComprehensionProfile("sub-1");
    });

    it("uses TUTOR_QUESTIONs when comprehension-led and QB exists", async () => {
      mockTutorQuestions(5);

      const aiResponse = JSON.stringify([
        {
          question: "Based on the passage, what best describes the character's reaction?",
          questionType: "MCQ",
          bloomLevel: "UNDERSTAND",
          skillRef: "SKILL-02:Inference",
          options: [
            { label: "A", text: "Frightened", isCorrect: false },
            { label: "B", text: "Annoyed and demanding", isCorrect: true },
            { label: "C", text: "Sad about the situation", isCorrect: false },
            { label: "D", text: "Relieved to be found", isCorrect: false },
          ],
          correctAnswer: "B",
          chapter: "Inference",
          explanation: "The character stamps her foot, showing annoyance not sadness.",
        },
      ]);

      mocks.ai.mockResolvedValue({ content: aiResponse });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1", { subjectSourceId: "ss-1" });
      expect(result.skipped).toBe(false);
      expect(result.created).toBe(1);

      // Verify comprehension call point was used
      const aiCall = mocks.ai.mock.calls[0][0];
      expect(aiCall.callPoint).toBe("content-trust.generate-mcq-comprehension");

      // Verify saved question has skill-aligned metadata
      // Comprehension MCQs are POST_TEST only (passage-dependent, can't be pre-tested)
      const saved = mocks.save.mock.calls[0][1];
      expect(saved[0]).toMatchObject({
        bloomLevel: "UNDERSTAND",
        assessmentUse: "POST_TEST",
        chapter: "Inference",
        tags: expect.arrayContaining(["auto-generated", "comprehension-skill"]),
      });
    });

    it("falls back to assertion path when < 3 TUTOR_QUESTIONs but still tags POST_TEST", async () => {
      // Mock only 2 tutor questions (below threshold)
      mocks.prisma.subjectSource.findMany.mockResolvedValue([{ sourceId: "qb-src-1" }]);
      mocks.prisma.contentQuestion.findMany.mockResolvedValue([
        { questionText: "Q1?", skillRef: "SKILL-01:Retrieval", bloomLevel: "REMEMBER", metadata: {} },
        { questionText: "Q2?", skillRef: "SKILL-02:Inference", bloomLevel: "UNDERSTAND", metadata: {} },
      ]);

      // Need assertions for the fallback path
      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, assertion: `Fact ${i}`, category: "fact", chapter: null, section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);

      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Basic recall question?",
          bloomLevel: "REMEMBER",
          options: [
            { label: "A", text: "Right", isCorrect: true },
            { label: "B", text: "Wrong", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1", { subjectSourceId: "ss-1" });
      expect(result.skipped).toBe(false);

      // Should use default call point (not comprehension)
      const aiCall = mocks.ai.mock.calls[0][0];
      expect(aiCall.callPoint).toBe("content-trust.generate-mcq");

      // Comprehension fallback must still tag POST_TEST — never show in pre-test
      const saved = mocks.save.mock.calls[0][1];
      expect(saved[0]).toMatchObject({
        assessmentUse: "POST_TEST",
        tags: expect.arrayContaining(["auto-generated", "comprehension-skill"]),
      });
    });

    it("falls back to assertion path when no QB sources exist but still tags POST_TEST", async () => {
      // No QB sources for this subject
      mocks.prisma.subjectSource.findMany.mockResolvedValue([]);

      const assertions = Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, assertion: `Fact ${i}`, category: "fact", chapter: null, section: null,
      }));
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(assertions);

      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Basic question?",
          bloomLevel: "REMEMBER",
          options: [
            { label: "A", text: "Right", isCorrect: true },
            { label: "B", text: "Wrong", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      const result = await generateMcqsForSource("src-1", { subjectSourceId: "ss-1" });
      expect(result.skipped).toBe(false);

      const aiCall = mocks.ai.mock.calls[0][0];
      expect(aiCall.callPoint).toBe("content-trust.generate-mcq");

      // Comprehension fallback must still tag POST_TEST
      const saved = mocks.save.mock.calls[0][1];
      expect(saved[0]).toMatchObject({
        assessmentUse: "POST_TEST",
      });
    });
  });

  // ── Sibling MCQ regeneration tests ──
  describe("regenerateSiblingMcqs", () => {
    it("deletes auto-generated MCQs and regenerates for sibling sources", async () => {
      // Mock sibling content sources (first findMany call)
      // Then QB sources for comprehension path (second findMany call)
      mocks.prisma.subjectSource.findMany
        .mockResolvedValueOnce([{ id: "ss-1", sourceId: "reading-src-1" }])
        .mockResolvedValueOnce([{ sourceId: "qb-src-1" }]);
      mocks.prisma.contentQuestion.deleteMany.mockResolvedValue({ count: 3 });

      // Mock the regeneration path
      mocks.prisma.contentSource.findUnique.mockResolvedValue({ documentType: "READING_PASSAGE" });
      mockComprehensionProfile("sub-1");
      // Mock TUTOR_QUESTION fetch (contentQuestion.findMany called after deleteMany)
      const tutorQs = Array.from({ length: 5 }, (_, i) => ({
        questionText: `How does the character feel in scene ${i}?`,
        skillRef: `SKILL-0${(i % 4) + 1}:${["Retrieval", "Inference", "Vocabulary", "Language Effect"][i % 4]}`,
        bloomLevel: ["REMEMBER", "UNDERSTAND", "UNDERSTAND", "ANALYZE"][i % 4],
        metadata: {
          modelResponses: {
            emerging: { response: `Simple answer ${i}`, tutorMove: `Guide ${i}` },
            developing: { response: `Better answer ${i}`, tutorMove: `Push ${i}` },
            secure: { response: `Strong analytical answer ${i}`, tutorMove: `Confirm ${i}` },
          },
          assessmentNote: `Tests comprehension skill ${i}`,
        },
      }));
      mocks.prisma.contentQuestion.findMany.mockResolvedValue(tutorQs);

      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Comprehension MCQ?",
          bloomLevel: "UNDERSTAND",
          skillRef: "SKILL-02:Inference",
          options: [
            { label: "A", text: "Right", isCorrect: true },
            { label: "B", text: "Wrong", isCorrect: false },
          ],
          correctAnswer: "A",
        }]),
      });
      mocks.save.mockResolvedValue({ created: 1, duplicatesSkipped: 0 });

      await regenerateSiblingMcqs("sub-1", "qb-src-1", "user-1");

      // Verify old MCQs were deleted
      expect(mocks.prisma.contentQuestion.deleteMany).toHaveBeenCalledWith({
        where: {
          sourceId: "reading-src-1",
          questionType: { in: ["MCQ", "TRUE_FALSE"] },
          tags: { hasSome: ["auto-generated"] },
        },
      });

      // Verify new MCQs were generated
      expect(mocks.ai).toHaveBeenCalled();
    });

    it("does nothing when no sibling sources exist", async () => {
      mocks.prisma.subjectSource.findMany.mockResolvedValue([]);

      await regenerateSiblingMcqs("sub-1", "qb-src-1");

      expect(mocks.prisma.contentQuestion.deleteMany).not.toHaveBeenCalled();
      expect(mocks.ai).not.toHaveBeenCalled();
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
      mocks.prisma.contentQuestion.count.mockResolvedValue(0);
      mocks.prisma.curriculum.count.mockResolvedValue(0);
      mocks.prisma.subjectSource.count.mockResolvedValue(1);
      mocks.prisma.contentAssertion.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `a${i}`, assertion: `Fact ${i}`, category: "concept", chapter: null, section: null,
        })),
      );
      mocks.ai.mockResolvedValue({
        content: JSON.stringify([{
          question: "Q?",
          bloomLevel: "REMEMBER",
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
