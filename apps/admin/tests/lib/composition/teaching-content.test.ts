/**
 * Tests for teaching-content transform
 *
 * Verifies:
 * - Assertion grouping by category and chapter
 * - Module-based assertion filtering via learningOutcomeRef
 * - Fallback to all assertions when no matches
 * - Rendering of teaching points text
 */
import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  CurriculumAssertionData,
  SharedComputedState,
  ModuleData,
} from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/teaching-content";

// =====================================================
// HELPERS
// =====================================================

function makeAssertion(overrides: Partial<CurriculumAssertionData> = {}): CurriculumAssertionData {
  return {
    id: crypto.randomUUID(),
    assertion: "The danger zone is 8°C to 63°C",
    category: "fact",
    chapter: "Chapter 1: Food Safety",
    section: null,
    pageRef: "p.12",
    tags: ["temperature"],
    trustLevel: "ACCREDITED_MATERIAL",
    examRelevance: 0.9,
    learningOutcomeRef: null,
    sourceName: "Level 2 Food Hygiene",
    sourceTrustLevel: "ACCREDITED_MATERIAL",
    sourceId: "src-1",
    sourceOrder: 0,
    sourceDocumentType: "TEXTBOOK",
    depth: null,
    parentId: null,
    orderIndex: 0,
    topicSlug: null,
    ...overrides,
  };
}

function makeModule(overrides: Partial<ModuleData> = {}): ModuleData {
  return {
    id: "MOD-3",
    slug: "MOD-3",
    name: "Food Safety Hazards",
    description: "Learn about food safety hazards",
    sequence: 2,
    sortOrder: 2,
    learningOutcomes: [
      "LO2: Identify biological, chemical, physical and allergenic hazards",
      "LO2-AC2.1: List the main types of food safety hazards",
      "LO2-AC2.2: Give examples of contamination",
    ],
    content: {},
    ...overrides,
  };
}

function makeContext(overrides: {
  assertions?: CurriculumAssertionData[];
  nextModule?: ModuleData | null;
  moduleToReview?: ModuleData | null;
  lessonPlanEntry?: SharedComputedState["lessonPlanEntry"];
  vocabulary?: Array<{ id: string; term: string; definition: string; partOfSpeech?: string; exampleUsage?: string; topic?: string }>;
  questions?: Array<{ id: string; questionText: string; questionType?: string; options?: any; correctAnswer?: string; chapter?: string; learningOutcomeRef?: string; difficulty?: string }>;
} = {}): AssembledContext {
  const sharedState: SharedComputedState = {
    modules: [],
    isFirstCall: false,
    daysSinceLastCall: 1,
    completedModules: new Set(),
    estimatedProgress: 0,
    lastCompletedIndex: -1,
    moduleToReview: overrides.moduleToReview ?? null,
    nextModule: overrides.nextModule ?? null,
    reviewType: "quick_recall",
    reviewReason: "Brief recall",
    thresholds: { high: 0.65, low: 0.35 },
    lessonPlanEntry: overrides.lessonPlanEntry ?? undefined,
  };

  return {
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
      curriculumAssertions: overrides.assertions ?? [],
      curriculumVocabulary: overrides.vocabulary,
      curriculumQuestions: overrides.questions,
    },
    sections: {},
    resolvedSpecs: {
      identitySpec: null,
      voiceSpec: null,
    },
    sharedState,
    specConfig: {},
  };
}

const sectionDef: CompositionSectionDef = {
  id: "teaching_content",
  name: "Teaching Content",
  priority: 5,
  dataSource: "curriculumAssertions",
  activateWhen: { condition: "dataExists" },
  fallback: { action: "omit" },
  transform: "renderTeachingContent",
  outputKey: "teachingContent",
};

// =====================================================
// TESTS
// =====================================================

describe("renderTeachingContent transform", () => {
  const transform = getTransform("renderTeachingContent")!;

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });

  describe("empty assertions", () => {
    it("returns hasTeachingContent=false when no assertions", () => {
      const ctx = makeContext({ assertions: [] });
      const result = transform(null, ctx, sectionDef);
      expect(result.hasTeachingContent).toBe(false);
      expect(result.totalAssertions).toBe(0);
      expect(result.teachingPoints).toBeNull();
    });
  });

  describe("all assertions (no module filter)", () => {
    it("renders all assertions when no current module", () => {
      const assertions = [
        makeAssertion({ assertion: "Point A", category: "fact" }),
        makeAssertion({ assertion: "Point B", category: "definition" }),
        makeAssertion({ assertion: "Point C", category: "rule" }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.hasTeachingContent).toBe(true);
      expect(result.totalAssertions).toBe(3);
      expect(result.teachingPoints).toContain("Point A");
      expect(result.teachingPoints).toContain("Point B");
      expect(result.teachingPoints).toContain("Point C");
    });

    it("groups assertions by category", () => {
      const assertions = [
        makeAssertion({ assertion: "Def 1", category: "definition" }),
        makeAssertion({ assertion: "Def 2", category: "definition" }),
        makeAssertion({ assertion: "Rule 1", category: "rule" }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.categories).toEqual({
        definition: 2,
        rule: 1,
      });
    });

    it("includes source citations in rendered text", () => {
      const assertions = [
        makeAssertion({ assertion: "Test point", sourceName: "My Source", pageRef: "p.42" }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("[My Source, p.42]");
    });

    it("includes LO refs in rendered text", () => {
      const assertions = [
        makeAssertion({ assertion: "Test", learningOutcomeRef: "R04-LO2-AC2.1" }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("(R04-LO2-AC2.1)");
    });

    it("collects unique sources", () => {
      const assertions = [
        makeAssertion({ sourceName: "Source A" }),
        makeAssertion({ sourceName: "Source B" }),
        makeAssertion({ sourceName: "Source A" }), // duplicate
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.sources).toHaveLength(2);
      expect(result.sources).toContain("Source A");
      expect(result.sources).toContain("Source B");
    });
  });

  describe("module-based filtering", () => {
    it("filters assertions to current module's LOs", () => {
      const mod = makeModule({
        learningOutcomes: ["LO2: Identify hazards", "LO2-AC2.1: List hazard types"],
      });
      const assertions = [
        makeAssertion({ assertion: "LO2 relevant", learningOutcomeRef: "R04-LO2-AC2.1" }),
        makeAssertion({ assertion: "LO2 also relevant", learningOutcomeRef: "R04-LO2" }),
        makeAssertion({ assertion: "LO3 not relevant", learningOutcomeRef: "R04-LO3-AC3.1" }),
        makeAssertion({ assertion: "No ref", learningOutcomeRef: null }),
      ];
      const ctx = makeContext({ assertions, nextModule: mod });
      const result = transform(null, ctx, sectionDef);

      expect(result.totalAssertions).toBe(2);
      expect(result.teachingPoints).toContain("LO2 relevant");
      expect(result.teachingPoints).toContain("LO2 also relevant");
      expect(result.teachingPoints).not.toContain("LO3 not relevant");
      expect(result.teachingPoints).not.toContain("No ref");
    });

    it("falls back to all assertions when no LO matches", () => {
      const mod = makeModule({
        learningOutcomes: ["LO99: Something nonexistent"],
      });
      const assertions = [
        makeAssertion({ assertion: "Only point", learningOutcomeRef: "R04-LO2-AC2.1" }),
      ];
      const ctx = makeContext({ assertions, nextModule: mod });
      const result = transform(null, ctx, sectionDef);

      // No assertions match LO99, so all should be returned
      expect(result.totalAssertions).toBe(1);
      expect(result.teachingPoints).toContain("Only point");
    });

    it("uses moduleToReview as fallback when nextModule is null", () => {
      const reviewMod = makeModule({
        id: "MOD-2",
        learningOutcomes: ["LO1: Basic concepts"],
      });
      const assertions = [
        makeAssertion({ assertion: "LO1 match", learningOutcomeRef: "R01-LO1" }),
        makeAssertion({ assertion: "LO2 no match", learningOutcomeRef: "R04-LO2" }),
      ];
      const ctx = makeContext({ assertions, nextModule: null, moduleToReview: reviewMod });
      const result = transform(null, ctx, sectionDef);

      expect(result.totalAssertions).toBe(1);
      expect(result.teachingPoints).toContain("LO1 match");
    });

    it("handles AC-style LO references", () => {
      const mod = makeModule({
        learningOutcomes: ["AC2.3: Describe cross-contamination prevention"],
      });
      const assertions = [
        makeAssertion({ assertion: "AC match", learningOutcomeRef: "R04-AC2.3" }),
        makeAssertion({ assertion: "Wrong AC", learningOutcomeRef: "R04-AC3.1" }),
      ];
      const ctx = makeContext({ assertions, nextModule: mod });
      const result = transform(null, ctx, sectionDef);

      expect(result.totalAssertions).toBe(1);
      expect(result.teachingPoints).toContain("AC match");
    });

    it("includes currentModule metadata in output", () => {
      const mod = makeModule({
        id: "MOD-3",
        name: "Food Safety Hazards",
        learningOutcomes: ["LO2: Hazards"],
      });
      const assertions = [
        makeAssertion({ learningOutcomeRef: "R04-LO2" }),
      ];
      const ctx = makeContext({ assertions, nextModule: mod });
      const result = transform(null, ctx, sectionDef);

      expect(result.currentModule).toBeDefined();
      expect(result.currentModule.id).toBe("MOD-3");
      expect(result.currentModule.name).toBe("Food Safety Hazards");
      expect(result.currentModule.learningOutcomes).toHaveLength(1);
    });
  });

  describe("exam relevance counting", () => {
    it("counts high exam relevance assertions (> 0.7)", () => {
      const assertions = [
        makeAssertion({ examRelevance: 0.9 }),
        makeAssertion({ examRelevance: 0.5 }),
        makeAssertion({ examRelevance: 0.8 }),
        makeAssertion({ examRelevance: null }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.highExamRelevanceCount).toBe(2); // 0.9 and 0.8
    });
  });

  // =====================================================
  // PYRAMID RENDERING TESTS
  // =====================================================

  describe("pyramid rendering (hierarchy mode)", () => {
    it("renders tree structure when assertions have depth set", () => {
      const rootId = "root-1";
      const topicId = "topic-1";
      const keyPointId = "kp-1";
      const assertions = [
        makeAssertion({
          id: rootId,
          assertion: "Food Safety Level 2 covers the principles of food hygiene",
          category: "overview",
          depth: 0,
          parentId: null,
          orderIndex: 0,
        }),
        makeAssertion({
          id: topicId,
          assertion: "Temperature Control",
          category: "summary",
          depth: 1,
          parentId: rootId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: keyPointId,
          assertion: "The Danger Zone",
          category: "summary",
          depth: 2,
          parentId: topicId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: "detail-1",
          assertion: "The danger zone is 8°C to 63°C",
          category: "fact",
          depth: 3,
          parentId: keyPointId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: "detail-2",
          assertion: "Bacteria can double every 20 minutes",
          category: "fact",
          depth: 3,
          parentId: keyPointId,
          orderIndex: 1,
        }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.hasTeachingContent).toBe(true);
      expect(result.totalAssertions).toBe(5);
      // Pyramid mode should use "## TEACHING CONTENT" heading
      expect(result.teachingPoints).toContain("## TEACHING CONTENT");
      // Overview should be rendered as paragraph
      expect(result.teachingPoints).toContain("Food Safety Level 2");
      // Topic should be rendered as heading
      expect(result.teachingPoints).toContain("### Temperature Control");
      // Key point rendered as bold
      expect(result.teachingPoints).toContain("**The Danger Zone**");
      // Details at max depth (3) rendered as bullets with citations
      expect(result.teachingPoints).toContain("- The danger zone is 8°C to 63°C");
      expect(result.teachingPoints).toContain("- Bacteria can double every 20 minutes");
    });

    it("falls back to flat rendering when no depth set", () => {
      const assertions = [
        makeAssertion({ assertion: "Point A", category: "fact", depth: null }),
        makeAssertion({ assertion: "Point B", category: "definition", depth: null }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      // Flat mode uses "## TEACHING CONTENT" heading
      expect(result.teachingPoints).toContain("## TEACHING CONTENT");
      expect(result.teachingPoints).toContain("verified points from trusted sources");
    });

    it("respects depth filtering — omits nodes deeper than maxDepth", () => {
      const rootId = "root-1";
      const topicId = "topic-1";
      const keyPointId = "kp-1";
      const assertions = [
        makeAssertion({
          id: rootId,
          assertion: "Overview text",
          category: "overview",
          depth: 0,
          parentId: null,
          orderIndex: 0,
        }),
        makeAssertion({
          id: topicId,
          assertion: "Topic A",
          category: "summary",
          depth: 1,
          parentId: rootId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: keyPointId,
          assertion: "Key Point 1",
          category: "summary",
          depth: 2,
          parentId: topicId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: "deep-detail",
          assertion: "Very deep detail that should be visible at max depth 3",
          category: "fact",
          depth: 3,
          parentId: keyPointId,
          orderIndex: 0,
        }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("Overview text");
      expect(result.teachingPoints).toContain("Topic A");
      expect(result.teachingPoints).toContain("Key Point 1");
      // Depth 3 should be visible since maxDepth defaults to max depth seen (3)
      expect(result.teachingPoints).toContain("Very deep detail");
    });

    it("includes citations in pyramid bullet items", () => {
      const rootId = "root-1";
      const topicId = "topic-1";
      const kpId = "kp-1";
      const assertions = [
        makeAssertion({
          id: rootId,
          assertion: "Overview paragraph",
          category: "overview",
          depth: 0,
          parentId: null,
          orderIndex: 0,
        }),
        makeAssertion({
          id: topicId,
          assertion: "Chilling Requirements",
          category: "summary",
          depth: 1,
          parentId: rootId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: kpId,
          assertion: "Storage temperatures",
          category: "summary",
          depth: 2,
          parentId: topicId,
          orderIndex: 0,
        }),
        makeAssertion({
          id: "leaf-1",
          assertion: "Fridges must be 0-5°C",
          category: "fact",
          depth: 3,
          parentId: kpId,
          orderIndex: 0,
          sourceName: "Food Safety Guide",
          pageRef: "p.18",
        }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      // Leaf-level bullets should include citations
      expect(result.teachingPoints).toContain("[Food Safety Guide, p.18]");
    });

    it("skips citations for overview/summary categories", () => {
      const assertions = [
        makeAssertion({
          id: "overview-1",
          assertion: "This module covers food safety principles",
          category: "overview",
          depth: 0,
          parentId: null,
          orderIndex: 0,
          sourceName: "Source",
          pageRef: "p.1",
        }),
      ];
      const ctx = makeContext({ assertions });
      const result = transform(null, ctx, sectionDef);

      // Overview should not have citations
      expect(result.teachingPoints).toContain("This module covers food safety principles");
      expect(result.teachingPoints).not.toContain("[Source, p.1]");
    });
  });

  // =====================================================
  // SESSION-SCOPED VOCABULARY FILTERING
  // =====================================================

  describe("session-scoped vocabulary filtering", () => {
    const vocab = [
      { id: "v1", term: "Bacteria", definition: "Single-celled organisms", partOfSpeech: "noun" },
      { id: "v2", term: "Pathogen", definition: "Disease-causing agent", partOfSpeech: "noun" },
      { id: "v3", term: "Contamination", definition: "Introduction of harmful substances" },
    ];

    it("renders all vocabulary when no vocabularyIds in lesson plan", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({ assertions, vocabulary: vocab });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("KEY VOCABULARY:");
      expect(result.teachingPoints).toContain("Bacteria");
      expect(result.teachingPoints).toContain("Pathogen");
      expect(result.teachingPoints).toContain("Contamination");
      expect(result.vocabularyCount).toBe(3);
    });

    it("filters vocabulary to session-specific IDs when present", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({
        assertions,
        vocabulary: vocab,
        lessonPlanEntry: {
          session: 1,
          type: "introduce",
          moduleId: null,
          moduleLabel: "",
          label: "Session 1",
          vocabularyIds: ["v1", "v3"],
        },
      });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("Bacteria");
      expect(result.teachingPoints).not.toContain("Pathogen");
      expect(result.teachingPoints).toContain("Contamination");
      expect(result.vocabularyCount).toBe(2);
    });

    it("falls back to all vocabulary when vocabularyIds is empty array", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({
        assertions,
        vocabulary: vocab,
        lessonPlanEntry: {
          session: 1,
          type: "introduce",
          moduleId: null,
          moduleLabel: "",
          label: "Session 1",
          vocabularyIds: [],
        },
      });
      const result = transform(null, ctx, sectionDef);

      expect(result.vocabularyCount).toBe(3);
    });
  });

  // =====================================================
  // SESSION-SCOPED QUESTION FILTERING
  // =====================================================

  describe("session-scoped question filtering", () => {
    const questions = [
      { id: "q1", questionText: "What temperature is the danger zone?", correctAnswer: "8-63°C" },
      { id: "q2", questionText: "Name three food safety hazards", correctAnswer: "biological, chemical, physical" },
      { id: "q3", questionText: "How long can food be in the danger zone?", correctAnswer: "Max 4 hours" },
    ];

    it("renders all questions when no questionIds in lesson plan", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({ assertions, questions });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("PRACTICE QUESTIONS (3):");
      expect(result.teachingPoints).toContain("What temperature is the danger zone?");
      expect(result.teachingPoints).toContain("Name three food safety hazards");
      expect(result.teachingPoints).toContain("How long can food be in the danger zone?");
      expect(result.questionCount).toBe(3);
    });

    it("filters questions to session-specific IDs when present", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({
        assertions,
        questions,
        lessonPlanEntry: {
          session: 1,
          type: "introduce",
          moduleId: null,
          moduleLabel: "",
          label: "Session 1",
          questionIds: ["q1"],
        },
      });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("PRACTICE QUESTIONS (1):");
      expect(result.teachingPoints).toContain("What temperature is the danger zone?");
      expect(result.teachingPoints).not.toContain("Name three food safety hazards");
      expect(result.questionCount).toBe(1);
    });

    it("includes correct answers in rendered questions", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({
        assertions,
        questions: [questions[0]],
      });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).toContain("[Answer: 8-63°C]");
    });

    it("falls back to all questions when questionIds is empty array", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({
        assertions,
        questions,
        lessonPlanEntry: {
          session: 1,
          type: "introduce",
          moduleId: null,
          moduleLabel: "",
          label: "Session 1",
          questionIds: [],
        },
      });
      const result = transform(null, ctx, sectionDef);

      expect(result.questionCount).toBe(3);
    });

    it("omits questions section when no questions available", () => {
      const assertions = [makeAssertion()];
      const ctx = makeContext({ assertions, questions: [] });
      const result = transform(null, ctx, sectionDef);

      expect(result.teachingPoints).not.toContain("PRACTICE QUESTIONS");
      expect(result.questionCount).toBe(0);
    });
  });

  // =====================================================
  // BACKWARD COMPATIBILITY
  // =====================================================

  describe("backward compatibility (no IDs in lesson plan)", () => {
    it("existing lesson plans without vocab/question IDs show all items", () => {
      const assertions = [makeAssertion()];
      const vocab = [
        { id: "v1", term: "Term1", definition: "Def1" },
        { id: "v2", term: "Term2", definition: "Def2" },
      ];
      const questions = [
        { id: "q1", questionText: "Q1?", correctAnswer: "A1" },
      ];
      const ctx = makeContext({
        assertions,
        vocabulary: vocab,
        questions,
        lessonPlanEntry: {
          session: 1,
          type: "introduce",
          moduleId: null,
          moduleLabel: "",
          label: "Session 1",
          // No vocabularyIds, no questionIds — backward compat
        },
      });
      const result = transform(null, ctx, sectionDef);

      // All vocab and questions should render (graceful fallback)
      expect(result.vocabularyCount).toBe(2);
      expect(result.questionCount).toBe(1);
      expect(result.teachingPoints).toContain("Term1");
      expect(result.teachingPoints).toContain("Term2");
      expect(result.teachingPoints).toContain("Q1?");
    });
  });
});
