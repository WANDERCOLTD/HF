/**
 * #606 — TUTOR_ONLY filter regression net.
 *
 * Verifies that `ContentQuestion` rows tagged `assessmentUse=TUTOR_ONLY` (or
 * `questionType=TUTOR_QUESTION`) never reach the learner-facing PRACTICE
 * QUESTIONS section of the composed teaching content.
 *
 * Two layers of defense both need to hold:
 *   1. Loader filter — `SectionDataLoader.ts::registerLoader("curriculumQuestions")`
 *      excludes `assessmentUse: { not: "TUTOR_ONLY" }` at the query boundary.
 *      (Tested indirectly — this file feeds the transform pre-filtered data.)
 *   2. Render-time filter — `transforms/teaching-content.ts` re-excludes
 *      TUTOR_ONLY rows when splitting into `practiceQuestions`. This is the
 *      defense-in-depth guard that protects against a loader regression.
 *
 * The render-time check is what this test pins.
 *
 * See: docs/epic-100-chain-walk.md (Link 3 — CURRICULUM → CALL)
 *      gh issue view 606
 */

import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  CurriculumAssertionData,
  CurriculumQuestionData,
} from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/teaching-content";

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "teaching-content",
    name: "Teaching Content",
    priority: 5,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "renderTeachingContent",
    outputKey: "teaching.content",
  };
}

function makeAssertion(overrides: Partial<CurriculumAssertionData> = {}): CurriculumAssertionData {
  return {
    id: "a-1",
    assertion: "Speak in full sentences when answering Part 1 questions.",
    category: "fact",
    chapter: "Part 1",
    section: null,
    pageRef: null,
    tags: [],
    trustLevel: null,
    examRelevance: 0.8,
    learningOutcomeRef: null,
    learningObjectiveId: null,
    sourceName: "Test Source",
    sourceTrustLevel: "vetted",
    sourceId: "src-1",
    sourceOrder: 0,
    sourceDocumentType: "TEXTBOOK",
    ...overrides,
  } as unknown as CurriculumAssertionData;
}

function makeQuestion(overrides: Partial<CurriculumQuestionData> = {}): CurriculumQuestionData {
  return {
    id: "q-1",
    questionText: "What is your hometown like?",
    questionType: "MCQ",
    assessmentUse: null,
    options: null,
    correctAnswer: null,
    chapter: null,
    learningOutcomeRef: null,
    difficulty: null,
    skillRef: null,
    metadata: null,
    ...overrides,
  };
}

function makeContext(
  questions: CurriculumQuestionData[],
  assertions: CurriculumAssertionData[] = [makeAssertion()],
): AssembledContext {
  return {
    loadedData: {
      caller: { id: "c1", name: "Test", email: null, phone: null, externalId: null, domain: null },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
            nextLearnerFacingNumber: 2,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
      onboardingSession: null,
      subjectSources: null,
      curriculumAssertions: assertions,
      curriculumQuestions: questions,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [],
      isFirstCall: false,
      isFirstCallInDomain: false,
      daysSinceLastCall: 1,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: null,
      reviewReason: null,
      thresholds: { high: 0.65, low: 0.35 },
      callNumber: 1,
      channel: "voice" as const,
      isFinalSession: false,
      schedulerDecision: null,
      lessonPlanEntry: null,
    },
    specConfig: {},
  } as unknown as AssembledContext;
}

describe("#606 — TUTOR_ONLY contract enforcement at render time", () => {
  it("transform is registered", () => {
    expect(getTransform("renderTeachingContent")).toBeDefined();
  });

  it("excludes assessmentUse=TUTOR_ONLY questions from PRACTICE QUESTIONS", () => {
    const transform = getTransform("renderTeachingContent")!;
    const questions: CurriculumQuestionData[] = [
      makeQuestion({
        id: "q-tutor-only",
        questionText: "A student answers with one sentence — what should the tutor do next?",
        questionType: "MCQ",
        assessmentUse: "TUTOR_ONLY",
        correctAnswer: "B",
      }),
      makeQuestion({
        id: "q-practice",
        questionText: "What is your hometown like?",
        questionType: "MCQ",
        assessmentUse: null,
      }),
    ];
    const context = makeContext(questions);
    const result = transform({}, context, makeSectionDef()) as {
      teachingPoints: string | null;
    };
    const rendered = result.teachingPoints ?? "";

    expect(rendered).toContain("What is your hometown like?");
    // The TUTOR_ONLY row's question MUST NOT appear in the learner prompt.
    expect(rendered).not.toContain("what should the tutor do next");
    // Defense-in-depth check: the meta-pedagogy "[Answer: B]" giveaway must
    // also not leak through (the practice question has no correctAnswer set).
    expect(rendered).not.toContain("[Answer: B]");
  });

  it("excludes questionType=TUTOR_QUESTION from PRACTICE QUESTIONS (existing contract)", () => {
    const transform = getTransform("renderTeachingContent")!;
    const questions: CurriculumQuestionData[] = [
      makeQuestion({
        id: "q-tutor-question",
        questionText: "Ask the learner to compare two photos.",
        questionType: "TUTOR_QUESTION",
        assessmentUse: null,
        skillRef: "SKILL-001:fluency",
      }),
      makeQuestion({
        id: "q-practice",
        questionText: "Describe a typical day in your life.",
        questionType: "MCQ",
        assessmentUse: null,
      }),
    ];
    const context = makeContext(questions);
    const result = transform({}, context, makeSectionDef()) as {
      teachingPoints: string | null;
    };
    const rendered = result.teachingPoints ?? "";

    expect(rendered).toContain("Describe a typical day in your life.");
    // TUTOR_QUESTION goes to TUTOR QUESTIONS section, not PRACTICE QUESTIONS.
    expect(rendered).toContain("TUTOR QUESTIONS");
    // PRACTICE QUESTIONS section should not contain the tutor-question text.
    const practiceSection = rendered.split("PRACTICE QUESTIONS")[1] ?? "";
    expect(practiceSection).not.toContain("Ask the learner to compare two photos.");
  });

  it("renders learner-facing questions when assessmentUse is null or non-TUTOR_ONLY", () => {
    const transform = getTransform("renderTeachingContent")!;
    const questions: CurriculumQuestionData[] = [
      makeQuestion({ id: "q1", questionText: "Q-A", questionType: "MCQ", assessmentUse: null }),
      makeQuestion({
        id: "q2",
        questionText: "Q-B",
        questionType: "MCQ",
        assessmentUse: "ASSESSMENT",
      }),
      makeQuestion({
        id: "q3",
        questionText: "Q-C",
        questionType: "TRUE_FALSE",
        assessmentUse: "PRACTICE",
      }),
    ];
    const context = makeContext(questions);
    const result = transform({}, context, makeSectionDef()) as {
      teachingPoints: string | null;
    };
    const rendered = result.teachingPoints ?? "";

    expect(rendered).toContain("PRACTICE QUESTIONS (3)");
    expect(rendered).toContain("Q-A");
    expect(rendered).toContain("Q-B");
    expect(rendered).toContain("Q-C");
  });

  it("emits empty practice section when ALL questions are TUTOR_ONLY", () => {
    const transform = getTransform("renderTeachingContent")!;
    const questions: CurriculumQuestionData[] = [
      makeQuestion({
        id: "q1",
        questionText: "Tutor pedagogy Q1",
        assessmentUse: "TUTOR_ONLY",
      }),
      makeQuestion({
        id: "q2",
        questionText: "Tutor pedagogy Q2",
        assessmentUse: "TUTOR_ONLY",
      }),
    ];
    const context = makeContext(questions);
    const result = transform({}, context, makeSectionDef()) as {
      teachingPoints: string | null;
    };
    const rendered = result.teachingPoints ?? "";

    expect(rendered).not.toContain("PRACTICE QUESTIONS");
    expect(rendered).not.toContain("Tutor pedagogy");
  });
});
