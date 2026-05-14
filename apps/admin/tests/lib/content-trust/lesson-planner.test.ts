/**
 * Tests for lesson-planner.ts
 *
 * Verifies:
 * - Empty source returns empty plan
 * - Single topic fits in one session
 * - Large topic splits into multiple sessions
 * - Assessment session added when questions exist
 * - Review session added when > 2 sessions
 * - Prerequisite links are sequential
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assertionFindMany: vi.fn(),
  questionFindMany: vi.fn(),
  vocabularyFindMany: vi.fn(),
  assertionMediaFindMany: vi.fn(),
  getConfiguredMeteredAICompletion: vi.fn(),
  logAssistantCall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentAssertion: { findMany: mocks.assertionFindMany },
    contentQuestion: { findMany: mocks.questionFindMany },
    contentVocabulary: { findMany: mocks.vocabularyFindMany },
    assertionMedia: { findMany: mocks.assertionMediaFindMany },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: mocks.getConfiguredMeteredAICompletion,
}));

vi.mock("@/lib/ai/assistant-wrapper", () => ({
  logAssistantCall: mocks.logAssistantCall,
}));

import { generateLessonPlan } from "@/lib/content-trust/lesson-planner";

function makeAssertions(count: number, loRef = "LO1") {
  return Array.from({ length: count }, (_, i) => ({
    id: `a-${loRef}-${i}`,
    assertion: `Assertion ${i} for ${loRef}`,
    category: "key_fact",
    chapter: "Ch 1",
    learningOutcomeRef: loRef,
    depth: i === 0 ? 0 : 2,
    topicSlug: null,
  }));
}

function makeQuestions(count: number, loRef = "LO1") {
  return Array.from({ length: count }, (_, i) => ({
    id: `q-${loRef}-${i}`,
    questionText: `Question ${i}?`,
    questionType: "MCQ",
    chapter: "Ch 1",
    learningOutcomeRef: loRef,
  }));
}

function makeVocab(count: number, topic = "LO1") {
  return Array.from({ length: count }, (_, i) => ({
    id: `v-${topic}-${i}`,
    term: `Term ${i}`,
    topic,
    chapter: "Ch 1",
  }));
}

describe("generateLessonPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertionFindMany.mockResolvedValue([]);
    mocks.questionFindMany.mockResolvedValue([]);
    mocks.vocabularyFindMany.mockResolvedValue([]);
    mocks.assertionMediaFindMany.mockResolvedValue([]);
    // AI refinement returns unchanged titles
    mocks.getConfiguredMeteredAICompletion.mockResolvedValue({
      content: "[]",
    });
  });

  it("returns empty plan when no assertions exist", async () => {
    const plan = await generateLessonPlan("src-1");
    expect(plan.totalSessions).toBe(0);
    expect(plan.sessions).toEqual([]);
    expect(plan.prerequisites).toEqual([]);
    expect(plan.generatedAt).toBeDefined();
  });

  it("creates a single session for a small topic", async () => {
    // 3 assertions × 2min + 1 question × 3min + 1 vocab × 1min = 10min < 30min
    mocks.assertionFindMany.mockResolvedValue(makeAssertions(3, "LO1"));
    mocks.questionFindMany.mockResolvedValue(makeQuestions(1, "LO1"));
    mocks.vocabularyFindMany.mockResolvedValue(makeVocab(1, "LO1"));

    const plan = await generateLessonPlan("src-1");

    // Should have 1 content session + 1 assessment + 0 review (only 2 sessions total, review needs > 2)
    expect(plan.sessions.length).toBeGreaterThanOrEqual(1);
    const contentSessions = plan.sessions.filter((s) => s.sessionType === "introduce" || s.sessionType === "practice");
    expect(contentSessions.length).toBe(1);
    expect(contentSessions[0].assertionIds).toHaveLength(3);
  });

  it("splits large topic into multiple sessions", async () => {
    // 20 assertions × 2min = 40min > 30min default
    mocks.assertionFindMany.mockResolvedValue(makeAssertions(20, "LO1"));

    const plan = await generateLessonPlan("src-1");

    const contentSessions = plan.sessions.filter(
      (s) => s.sessionType === "introduce" || s.sessionType === "practice",
    );
    expect(contentSessions.length).toBeGreaterThan(1);

    // All assertion IDs should be distributed across sessions
    const allIds = contentSessions.flatMap((s) => s.assertionIds);
    expect(allIds).toHaveLength(20);
  });

  it("adds assessment session when questions exist", async () => {
    mocks.assertionFindMany.mockResolvedValue(makeAssertions(5, "LO1"));
    mocks.questionFindMany.mockResolvedValue(makeQuestions(3, "LO1"));

    const plan = await generateLessonPlan("src-1");

    const assessSession = plan.sessions.find((s) => s.sessionType === "assess");
    expect(assessSession).toBeDefined();
    expect(assessSession!.questionIds).toHaveLength(3);
    expect(assessSession!.title).toBe("Assessment");
  });

  it("skips assessment session when disabled", async () => {
    mocks.assertionFindMany.mockResolvedValue(makeAssertions(5, "LO1"));
    mocks.questionFindMany.mockResolvedValue(makeQuestions(3, "LO1"));

    const plan = await generateLessonPlan("src-1", { includeAssessment: false });

    const assessSession = plan.sessions.find((s) => s.sessionType === "assess");
    expect(assessSession).toBeUndefined();
  });

  it("adds review session when > 2 total sessions", async () => {
    // Create enough content for 3+ sessions before review
    mocks.assertionFindMany.mockResolvedValue([
      ...makeAssertions(10, "LO1"),
      ...makeAssertions(10, "LO2"),
    ]);
    mocks.questionFindMany.mockResolvedValue(makeQuestions(2, "LO1"));

    const plan = await generateLessonPlan("src-1");

    const reviewSession = plan.sessions.find((s) => s.sessionType === "review");
    expect(reviewSession).toBeDefined();
    expect(reviewSession!.title).toBe("Review & Consolidation");
  });

  it("skips review when disabled", async () => {
    mocks.assertionFindMany.mockResolvedValue([
      ...makeAssertions(10, "LO1"),
      ...makeAssertions(10, "LO2"),
    ]);
    mocks.questionFindMany.mockResolvedValue(makeQuestions(2, "LO1"));

    const plan = await generateLessonPlan("src-1", { includeReview: false });

    const reviewSession = plan.sessions.find((s) => s.sessionType === "review");
    expect(reviewSession).toBeUndefined();
  });

  it("builds sequential prerequisite links", async () => {
    mocks.assertionFindMany.mockResolvedValue([
      ...makeAssertions(10, "LO1"),
      ...makeAssertions(10, "LO2"),
    ]);

    const plan = await generateLessonPlan("src-1");

    // Each session after the first should depend on the previous
    for (const prereq of plan.prerequisites) {
      expect(prereq.requiresSession).toBe(prereq.sessionNumber - 1);
    }
  });

  it("respects custom session length", async () => {
    // 10 assertions × 2min = 20min — fits in 60min session but not 10min
    mocks.assertionFindMany.mockResolvedValue(makeAssertions(10, "LO1"));

    const plan60 = await generateLessonPlan("src-1", { sessionLength: 60 });
    const plan10 = await generateLessonPlan("src-1", { sessionLength: 10 });

    const content60 = plan60.sessions.filter((s) => s.sessionType !== "assess" && s.sessionType !== "review");
    const content10 = plan10.sessions.filter((s) => s.sessionType !== "assess" && s.sessionType !== "review");

    expect(content10.length).toBeGreaterThan(content60.length);
  });

  it("groups content from multiple LOs into separate sessions", async () => {
    mocks.assertionFindMany.mockResolvedValue([
      ...makeAssertions(3, "LO1"),
      ...makeAssertions(3, "LO2"),
    ]);

    const plan = await generateLessonPlan("src-1");

    const contentSessions = plan.sessions.filter(
      (s) => s.sessionType === "introduce" || s.sessionType === "practice",
    );
    // Should have at least 2 content sessions (one per LO)
    expect(contentSessions.length).toBeGreaterThanOrEqual(2);
  });
});
