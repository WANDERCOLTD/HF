import { describe, it, expect } from "vitest";
import { computeAssertionSummary } from "@/lib/domain/quick-launch";
import type { ExtractedAssertion } from "@/lib/content-trust/extract-assertions";

function assertion(category: string, text: string, chapter?: string): ExtractedAssertion {
  return {
    assertion: text,
    category,
    chapter,
    tags: [],
    contentHash: `h-${text.slice(0, 16)}`,
  };
}

describe("computeAssertionSummary", () => {
  describe("categoryBreakdown", () => {
    it("counts assertions by category", () => {
      const summary = computeAssertionSummary([
        assertion("fact", "f1"),
        assertion("fact", "f2"),
        assertion("rule", "r1"),
        assertion("skill_framework", "s1"),
      ]);

      expect(summary.categoryBreakdown).toEqual({
        fact: 2,
        rule: 1,
        skill_framework: 1,
      });
    });
  });

  describe("chapters", () => {
    it("groups by chapter and sorts by count descending", () => {
      const summary = computeAssertionSummary([
        assertion("fact", "a", "Chapter A"),
        assertion("fact", "b", "Chapter A"),
        assertion("fact", "c", "Chapter A"),
        assertion("rule", "d", "Chapter B"),
        assertion("fact", "e"),
      ]);

      expect(summary.chapters).toEqual([
        { name: "Chapter A", count: 3 },
        { name: "Chapter B", count: 1 },
        { name: "Uncategorized", count: 1 },
      ]);
    });
  });

  describe("sampleAssertions — instruction-category bias (#555)", () => {
    // Repro of the IELTS Speaking shape: fact + rule dominate by count, but
    // skill_framework + assessment_approach are the outcome-shaped categories
    // we want the AI to see first when proposing learningOutcomes.
    it("floats INSTRUCTION_CATEGORIES to the front of topCategories regardless of raw count", () => {
      const assertions: ExtractedAssertion[] = [
        // 5 facts — would dominate by raw count without the bias
        assertion("fact", "fact-1"),
        assertion("fact", "fact-2"),
        assertion("fact", "fact-3"),
        assertion("fact", "fact-4"),
        assertion("fact", "fact-5"),
        // 4 rules — second-highest by count
        assertion("rule", "rule-1"),
        assertion("rule", "rule-2"),
        assertion("rule", "rule-3"),
        assertion("rule", "rule-4"),
        // 3 examples
        assertion("example", "ex-1"),
        assertion("example", "ex-2"),
        assertion("example", "ex-3"),
        // 2 skill_framework — outcome-shaped, low count but biased to front
        assertion("skill_framework", "sf-1"),
        assertion("skill_framework", "sf-2"),
        // 1 assessment_approach
        assertion("assessment_approach", "aa-1"),
      ];

      const summary = computeAssertionSummary(assertions);
      const sampledCategories = summary.sampleAssertions.map((s) => s.category);

      // First two samples must come from instruction-oriented categories
      // (skill_framework or assessment_approach), not from fact/rule.
      expect(sampledCategories[0]).toBe("skill_framework");
      expect(sampledCategories[1]).toBe("skill_framework");
      expect(sampledCategories.slice(0, 4)).toEqual([
        "skill_framework",
        "skill_framework",
        "assessment_approach",
        // Then fall through to raw-count order: fact (5), rule (4), example (3)
        "fact",
      ]);
    });

    // Regression guard: a course-reference with NO instruction categories
    // (e.g. introductory maths with only `definition` + `example`) must still
    // produce a non-empty sampleAssertions array.
    it("falls back to raw-count order when no instruction categories are present", () => {
      const summary = computeAssertionSummary([
        assertion("definition", "d1"),
        assertion("definition", "d2"),
        assertion("definition", "d3"),
        assertion("example", "e1"),
        assertion("example", "e2"),
        assertion("fact", "f1"),
      ]);

      expect(summary.sampleAssertions.length).toBeGreaterThan(0);
      // Top categories by raw count: definition (3), example (2), fact (1)
      const sampledCategories = summary.sampleAssertions.map((s) => s.category);
      expect(sampledCategories[0]).toBe("definition");
    });

    it("caps total sampleAssertions at 10", () => {
      // 20 categories × 2 picks would be 40 — must clamp to 10
      const assertions: ExtractedAssertion[] = [];
      for (let i = 0; i < 20; i++) {
        assertions.push(assertion(`cat_${i}`, `a-${i}-1`));
        assertions.push(assertion(`cat_${i}`, `a-${i}-2`));
      }

      const summary = computeAssertionSummary(assertions);

      expect(summary.sampleAssertions.length).toBeLessThanOrEqual(10);
    });

    it("preserves up to 2 picks per category from the top-5", () => {
      const assertions: ExtractedAssertion[] = [
        assertion("skill_framework", "sf-1"),
        assertion("skill_framework", "sf-2"),
        assertion("skill_framework", "sf-3"), // third pick discarded
        assertion("assessment_approach", "aa-1"),
        assertion("fact", "f-1"),
        assertion("fact", "f-2"),
      ];

      const summary = computeAssertionSummary(assertions);
      const skillSamples = summary.sampleAssertions.filter(
        (s) => s.category === "skill_framework",
      );

      expect(skillSamples).toHaveLength(2);
      expect(skillSamples.map((s) => s.assertion)).toEqual(["sf-1", "sf-2"]);
    });
  });

  describe("empty input", () => {
    it("returns empty breakdown, chapters, and samples", () => {
      const summary = computeAssertionSummary([]);
      expect(summary.categoryBreakdown).toEqual({});
      expect(summary.chapters).toEqual([]);
      expect(summary.sampleAssertions).toEqual([]);
    });
  });
});
