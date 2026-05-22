/**
 * #605 — categoryToTeachMethod + INSTRUCTION_CATEGORIES guard.
 *
 * Covers:
 * - Every INSTRUCTION_CATEGORIES member returns "tutor_instruction"
 *   (regardless of intent — tutor directives are audience-orthogonal).
 * - Non-instruction categories still resolve to a learner-facing TeachMethod.
 * - TEACH_METHOD_CONFIG is exhaustive for INSTRUCTION_CATEGORIES (no member
 *   is silently absent from the tutor_instruction bucket).
 * - assertNoLearnerMethodOnInstructionCategory throws on violations and
 *   passes on the clean shape.
 *
 * See: gh issue view 605
 *      lib/content-trust/resolve-config.ts
 */
import { describe, it, expect } from "vitest";
import {
  assertNoLearnerMethodOnInstructionCategory,
  categoryToTeachMethod,
  INSTRUCTION_CATEGORIES,
  TEACH_METHOD_CONFIG,
  type TeachingMode,
} from "@/lib/content-trust/resolve-config";

const TEACHING_MODES: ReadonlyArray<TeachingMode> = [
  "recall",
  "comprehension",
  "practice",
  "syllabus",
];

describe("#605 — categoryToTeachMethod + INSTRUCTION_CATEGORIES guard", () => {
  describe("every INSTRUCTION_CATEGORIES member routes to tutor_instruction", () => {
    for (const category of INSTRUCTION_CATEGORIES) {
      for (const intent of TEACHING_MODES) {
        it(`category="${category}" intent="${intent}" → tutor_instruction`, () => {
          expect(categoryToTeachMethod(category, intent)).toBe("tutor_instruction");
        });
      }
    }
  });

  describe("non-instruction categories still resolve to learner-facing methods", () => {
    const learnerCases: Array<{ category: string; intent: TeachingMode; expected: string }> = [
      { category: "fact", intent: "recall", expected: "recall_quiz" },
      { category: "vocabulary", intent: "comprehension", expected: "definition_matching" },
      { category: "reading_passage", intent: "comprehension", expected: "close_reading" },
      { category: "true_false", intent: "recall", expected: "true_false" },
      { category: "matching_exercise", intent: "recall", expected: "matching_task" },
      { category: "discussion_prompt", intent: "comprehension", expected: "guided_discussion" },
      { category: "activity", intent: "practice", expected: "problem_solving" },
      { category: "worked_example", intent: "practice", expected: "worked_example" },
    ];
    for (const { category, intent, expected } of learnerCases) {
      it(`category="${category}" intent="${intent}" → ${expected}`, () => {
        expect(categoryToTeachMethod(category, intent)).toBe(expected);
      });
    }
  });

  describe("TEACH_METHOD_CONFIG exhaustively covers INSTRUCTION_CATEGORIES", () => {
    it("tutor_instruction bucket contains every INSTRUCTION_CATEGORIES member", () => {
      const tutorBucket = new Set(TEACH_METHOD_CONFIG.tutor_instruction.categories);
      for (const cat of INSTRUCTION_CATEGORIES) {
        expect(tutorBucket.has(cat)).toBe(true);
      }
    });

    it("no learner-facing bucket includes any INSTRUCTION_CATEGORIES member", () => {
      const instructionSet = new Set<string>(INSTRUCTION_CATEGORIES);
      const learnerMethods = (Object.keys(TEACH_METHOD_CONFIG) as Array<keyof typeof TEACH_METHOD_CONFIG>)
        .filter((m) => m !== "tutor_instruction");
      for (const method of learnerMethods) {
        const overlap = TEACH_METHOD_CONFIG[method].categories.filter((c) => instructionSet.has(c));
        expect(overlap, `${String(method)} must not list any INSTRUCTION_CATEGORIES`).toEqual([]);
      }
    });
  });

  describe("unknown category still falls back to recall_quiz (preserves legacy behaviour)", () => {
    it("unknown category → recall_quiz", () => {
      expect(categoryToTeachMethod("__never_seen__", "recall")).toBe("recall_quiz");
    });
  });
});

describe("#605 — assertNoLearnerMethodOnInstructionCategory", () => {
  it("passes on an empty array", () => {
    expect(() => assertNoLearnerMethodOnInstructionCategory([])).not.toThrow();
  });

  it("passes when INSTRUCTION_CATEGORIES rows carry tutor_instruction", () => {
    expect(() =>
      assertNoLearnerMethodOnInstructionCategory([
        { category: "teaching_rule", teachMethod: "tutor_instruction" },
        { category: "session_flow", teachMethod: "tutor_instruction" },
      ]),
    ).not.toThrow();
  });

  it("passes when learner categories carry learner methods", () => {
    expect(() =>
      assertNoLearnerMethodOnInstructionCategory([
        { category: "fact", teachMethod: "recall_quiz" },
        { category: "vocabulary", teachMethod: "definition_matching" },
      ]),
    ).not.toThrow();
  });

  it("ignores null teachMethod (null backfill happens elsewhere)", () => {
    expect(() =>
      assertNoLearnerMethodOnInstructionCategory([
        { category: "teaching_rule", teachMethod: null },
      ]),
    ).not.toThrow();
  });

  it("throws when an INSTRUCTION_CATEGORY row has recall_quiz", () => {
    expect(() =>
      assertNoLearnerMethodOnInstructionCategory([
        { category: "teaching_rule", teachMethod: "recall_quiz" },
      ]),
    ).toThrow(/\[#605\] 1 assertion\(s\)/);
  });

  it("throws when an INSTRUCTION_CATEGORY row has any non-tutor_instruction method", () => {
    expect(() =>
      assertNoLearnerMethodOnInstructionCategory([
        { category: "differentiation", teachMethod: "guided_discussion" },
      ]),
    ).toThrow(/differentiation → guided_discussion/);
  });
});
