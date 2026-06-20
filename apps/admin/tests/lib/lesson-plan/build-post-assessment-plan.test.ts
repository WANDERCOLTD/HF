/**
 * #1954 (Boaz/Eldar gap analysis Unit 1.1) — post-Assessment lesson
 * plan trigger.
 *
 * Pure-function tests for the picker logic. Integration testing of
 * the AGGREGATE wire-up requires the live pipeline route + DB; this
 * file pins the deterministic per-criterion selection that the
 * production helper relies on.
 */

import { describe, it, expect } from "vitest";
import {
  pickWeakestIeltsCriterion,
  pickNextRecommendedModule,
} from "@/lib/lesson-plan/build-post-assessment-plan";

describe("pickWeakestIeltsCriterion (#1954)", () => {
  it("returns null when no IELTS rows are present", () => {
    expect(
      pickWeakestIeltsCriterion([
        { parameterId: "personality_warmth", score: 0.4 },
      ]),
    ).toBeNull();
  });

  it("returns null when rows have null scores", () => {
    expect(
      pickWeakestIeltsCriterion([
        { parameterId: "skill_fluency_and_coherence_fc", score: null },
      ]),
    ).toBeNull();
  });

  it("picks the lowest-scoring IELTS criterion", () => {
    const result = pickWeakestIeltsCriterion([
      { parameterId: "skill_fluency_and_coherence_fc", score: 0.8 },
      { parameterId: "skill_lexical_resource_lr", score: 0.6 },
      { parameterId: "skill_grammatical_range_and_accuracy_gra", score: 0.4 },
      { parameterId: "skill_pronunciation_p", score: 0.7 },
    ]);
    expect(result).toEqual({
      parameterId: "skill_grammatical_range_and_accuracy_gra",
      label: "Grammar",
      score: 0.4,
    });
  });

  it("breaks ties by alphabetical parameterId (stable selection)", () => {
    const result = pickWeakestIeltsCriterion([
      { parameterId: "skill_pronunciation_p", score: 0.5 },
      { parameterId: "skill_lexical_resource_lr", score: 0.5 },
    ]);
    // skill_lexical_resource_lr comes first alphabetically.
    expect(result?.parameterId).toBe("skill_lexical_resource_lr");
    expect(result?.label).toBe("Lexical Resource");
  });

  it("ignores non-IELTS rows mixed in with IELTS rows", () => {
    const result = pickWeakestIeltsCriterion([
      { parameterId: "personality_warmth", score: 0.1 },
      { parameterId: "skill_fluency_and_coherence_fc", score: 0.8 },
      { parameterId: "skill_pronunciation_p", score: 0.6 },
    ]);
    expect(result?.parameterId).toBe("skill_pronunciation_p");
  });

  it("returns label matching the canonical IELTS criterion name", () => {
    const cases = [
      ["skill_fluency_and_coherence_fc", "Fluency & Coherence"],
      ["skill_lexical_resource_lr", "Lexical Resource"],
      ["skill_grammatical_range_and_accuracy_gra", "Grammar"],
      ["skill_pronunciation_p", "Pronunciation"],
    ] as const;
    for (const [parameterId, expectedLabel] of cases) {
      const result = pickWeakestIeltsCriterion([{ parameterId, score: 0.3 }]);
      expect(result?.label).toBe(expectedLabel);
    }
  });
});

describe("pickNextRecommendedModule (#1954)", () => {
  it("recommends part1 for Fluency & Coherence (the FC drill)", () => {
    expect(
      pickNextRecommendedModule("skill_fluency_and_coherence_fc"),
    ).toBe("part1");
  });

  it("recommends part1 for Lexical Resource (vocabulary drill)", () => {
    expect(pickNextRecommendedModule("skill_lexical_resource_lr")).toBe("part1");
  });

  it("recommends part3 for Grammar (abstract discussion exposes range)", () => {
    expect(
      pickNextRecommendedModule("skill_grammatical_range_and_accuracy_gra"),
    ).toBe("part3");
  });

  it("recommends part2 for Pronunciation (monologue exposes phonology)", () => {
    expect(pickNextRecommendedModule("skill_pronunciation_p")).toBe("part2");
  });

  it("returns undefined for unknown criteria (defensive)", () => {
    expect(pickNextRecommendedModule("unknown")).toBeUndefined();
  });
});
