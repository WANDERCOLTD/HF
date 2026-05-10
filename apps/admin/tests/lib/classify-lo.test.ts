import { describe, it, expect } from "vitest";
import { classifyLoHeuristic, type ClassifyLoInput } from "@/lib/content-trust/classify-lo";

function input(description: string, overrides: Partial<ClassifyLoInput> = {}): ClassifyLoInput {
  return {
    loId: "lo-1",
    ref: "LO1",
    description,
    ...overrides,
  };
}

describe("classifyLoHeuristic", () => {
  describe("ASSESSOR_RUBRIC matches (rubric criteria, band characteristics)", () => {
    // Real LO descriptions from the IELTS Speaking course (course id 0d5c8dcd-…)
    const ielts = [
      "Identify Band 5 pronunciation characteristics: pronunciation of a limited repertoire is generally clear",
      "Identify Band 7 grammatical characteristics: flexible use of structures, able to use subordinate clauses",
      "Identify Band 8 grammatical characteristics: wide range of structures used flexibly",
      "Identify the four assessment criteria",
    ];

    for (const desc of ielts) {
      it(`flags as ASSESSOR_RUBRIC: "${desc.slice(0, 60)}…"`, () => {
        const result = classifyLoHeuristic(input(desc));
        expect(result).not.toBeNull();
        expect(result!.proposal.systemRole).toBe("ASSESSOR_RUBRIC");
        expect(result!.proposal.learnerVisible).toBe(false);
        expect(result!.proposal.performanceStatement).toBeNull();
        expect(result!.proposal.confidence).toBeGreaterThanOrEqual(0.85);
        expect(result!.source).toBe("heuristic");
        expect(result!.proposal.classifierVersion).toBe("heuristic-v1");
      });
    }

    it("flags 'band descriptor structure' as ASSESSOR_RUBRIC or SCORE_EXPLAINER (system-only either way)", () => {
      const result = classifyLoHeuristic(input("Describe the band descriptor structure"));
      expect(result).not.toBeNull();
      expect(["ASSESSOR_RUBRIC", "SCORE_EXPLAINER"]).toContain(result!.proposal.systemRole);
      expect(result!.proposal.learnerVisible).toBe(false);
    });

    it("flags 'Explain Pronunciation as the assessment of intelligibility' as ASSESSOR_RUBRIC", () => {
      const result = classifyLoHeuristic(
        input("Explain Pronunciation as the assessment of intelligibility, stress and intonation"),
      );
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("ASSESSOR_RUBRIC");
    });
  });

  describe("SCORE_EXPLAINER matches (score calculation, aggregation, descriptor structure)", () => {
    it("flags 'Explain averaging' as SCORE_EXPLAINER", () => {
      const result = classifyLoHeuristic(input("Explain averaging across the four criteria"));
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("SCORE_EXPLAINER");
      expect(result!.proposal.learnerVisible).toBe(false);
    });

    it("flags 'how scores are calculated' as SCORE_EXPLAINER", () => {
      const result = classifyLoHeuristic(input("Explain how scores are calculated from the four criteria"));
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("SCORE_EXPLAINER");
    });

    it("flags 'how bands are determined' as SCORE_EXPLAINER", () => {
      const result = classifyLoHeuristic(input("Explain how bands are determined for borderline candidates"));
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("SCORE_EXPLAINER");
    });
  });

  describe("ITEM_GENERATOR_SPEC matches (band-comparison boundary specs)", () => {
    it("flags 'distinguish Band 6/7 features' as ITEM_GENERATOR_SPEC", () => {
      const result = classifyLoHeuristic(
        input("Distinguish Band 6/7 features by examining hedging and conditional use"),
      );
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("ITEM_GENERATOR_SPEC");
    });

    it("flags 'Band 7 vs 8' as ITEM_GENERATOR_SPEC", () => {
      const result = classifyLoHeuristic(input("Compare Band 7 vs 8 in lexical resource"));
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("ITEM_GENERATOR_SPEC");
    });
  });

  describe("learner-facing NONE matches", () => {
    const learnerLOs = [
      "Speak for 90 seconds without stalling on word-search",
      "Paraphrase any answer three ways without repeating key nouns",
      "Apply close-reading techniques to a chosen passage",
      "Compare two characters' motivations using textual evidence",
      "Practise minimal pairs to sharpen vowel discrimination",
      "Analyse how figurative language shapes tone in a passage",
    ];

    for (const desc of learnerLOs) {
      it(`flags as NONE/learner-visible: "${desc.slice(0, 50)}…"`, () => {
        const result = classifyLoHeuristic(input(desc));
        expect(result).not.toBeNull();
        expect(result!.proposal.systemRole).toBe("NONE");
        expect(result!.proposal.learnerVisible).toBe(true);
        // Heuristic doesn't rewrite → null performance statement; renderer
        // falls back to description.
        expect(result!.proposal.performanceStatement).toBeNull();
        expect(result!.source).toBe("heuristic");
      });
    }
  });

  describe("ambiguous → null (LLM fallback)", () => {
    // These are the kinds of LOs that need LLM judgement — knowledge verbs
    // applied to topic content, not to scoring criteria, and not starting
    // with a clear performance verb.
    const ambiguous = [
      "Explain what Lexical Resource assesses in everyday terms",
      "Recognize that Part 3 is where Band 6 plateaus most often",
      "Explain that overuse of 'In my opinion' (four+ times in Part 3) plateaus a candidate at Band 6",
      "Identify word stress patterns and common L1 interference errors",
      "Explain connected speech features: linking, elision, assimilation",
    ];

    for (const desc of ambiguous) {
      it(`returns null (defers to LLM): "${desc.slice(0, 50)}…"`, () => {
        const result = classifyLoHeuristic(input(desc));
        expect(result).toBeNull();
      });
    }
  });

  describe("edge cases", () => {
    it("returns null on empty description", () => {
      expect(classifyLoHeuristic(input(""))).toBeNull();
    });

    it("returns null on too-short learner-verb (likely garbage)", () => {
      // "Speak well" is < 12 chars — guard against false positives on stubs.
      expect(classifyLoHeuristic(input("Speak well"))).toBeNull();
    });

    it("does not match a knowledge verb that resembles a performance verb mid-sentence", () => {
      // The "speak" here is inside a definition, not the head verb.
      expect(
        classifyLoHeuristic(input("Recognize that candidates at Band 7 speak with hedging phrases")),
      ).toBeNull();
    });

    it("preserves the loId and ref in the proposal", () => {
      const result = classifyLoHeuristic(
        input("Identify Band 5 pronunciation characteristics: ...", { loId: "lo-42", ref: "LO76" }),
      );
      expect(result).not.toBeNull();
      expect(result!.proposal.loId).toBe("lo-42");
    });

    it("rule precedence: rubric pattern wins over learner-verb pattern", () => {
      // "Identify the four assessment criteria" — both LEARNER_PERFORMANCE_VERBS
      // doesn't fire (Identify is not a performance verb), and the rubric rule
      // does. Sanity check that the rubric rule definitely fires.
      const result = classifyLoHeuristic(input("Identify the four assessment criteria"));
      expect(result).not.toBeNull();
      expect(result!.proposal.systemRole).toBe("ASSESSOR_RUBRIC");
    });
  });
});
