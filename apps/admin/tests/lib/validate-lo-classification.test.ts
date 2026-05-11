import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateLoClassification,
  CONFIDENCE_APPLY_THRESHOLD,
  type LoClassifierProposal,
  type LoClassifierTarget,
} from "@/lib/content-trust/validate-lo-classification";

// Silence the [validate-lo-classification] info logs during tests.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function proposal(overrides: Partial<LoClassifierProposal> = {}): LoClassifierProposal {
  return {
    loId: "lo-1",
    classifierVersion: "test@v1",
    learnerVisible: true,
    performanceStatement: "Speak for 90 seconds without stalling",
    systemRole: "NONE",
    confidence: 0.95,
    rationale: "Performance verb + measurable outcome",
    ...overrides,
  };
}

function target(overrides: Partial<LoClassifierTarget> = {}): LoClassifierTarget {
  return {
    id: "lo-1",
    ref: "LO9",
    description: "Explain what Lexical Resource assesses",
    humanOverriddenAt: null,
    ...overrides,
  };
}

describe("validateLoClassification", () => {
  describe("apply path (high confidence, no override)", () => {
    it("returns outcome=apply with loRowUpdates and applied=true", () => {
      const decision = validateLoClassification(proposal(), target());

      expect(decision.outcome).toBe("apply");
      expect(decision.loRowUpdates).toEqual({
        learnerVisible: true,
        performanceStatement: "Speak for 90 seconds without stalling",
        systemRole: "NONE",
      });
      expect(decision.classificationRow.applied).toBe(true);
      expect(decision.fixes).toHaveLength(0);
    });

    it("trims performanceStatement whitespace", () => {
      const decision = validateLoClassification(
        proposal({ performanceStatement: "   Practice MCQ items.   " }),
        target(),
      );
      expect(decision.loRowUpdates?.performanceStatement).toBe("Practice MCQ items.");
    });

    it("treats whitespace-only performanceStatement as null", () => {
      const decision = validateLoClassification(
        proposal({ performanceStatement: "   " }),
        target(),
      );
      expect(decision.loRowUpdates?.performanceStatement).toBeNull();
    });
  });

  describe("queue path (confidence below threshold)", () => {
    it(`routes to queue when confidence < ${CONFIDENCE_APPLY_THRESHOLD}`, () => {
      const decision = validateLoClassification(
        proposal({ confidence: 0.55 }),
        target(),
      );
      expect(decision.outcome).toBe("queue");
      expect(decision.loRowUpdates).toBeNull();
      expect(decision.classificationRow.applied).toBe(false);
      expect(decision.classificationRow.confidence).toBe(0.55);
      expect(decision.fixes.some((f) => f.action === "queued-low-confidence")).toBe(true);
    });

    it("still records the proposed values in the history row when queueing", () => {
      const decision = validateLoClassification(
        proposal({ confidence: 0.4, systemRole: "ASSESSOR_RUBRIC", learnerVisible: false, performanceStatement: null }),
        target(),
      );
      expect(decision.outcome).toBe("queue");
      expect(decision.classificationRow.proposedSystemRole).toBe("ASSESSOR_RUBRIC");
      expect(decision.classificationRow.proposedLearnerVisible).toBe(false);
    });
  });

  describe("skip-overridden path (humanOverriddenAt sentinel)", () => {
    it("blocks LO row updates when humanOverriddenAt is set, regardless of confidence", () => {
      const decision = validateLoClassification(
        proposal({ confidence: 0.99 }),
        target({ humanOverriddenAt: new Date("2026-04-01T12:00:00Z") }),
      );
      expect(decision.outcome).toBe("skip-overridden");
      expect(decision.loRowUpdates).toBeNull();
      expect(decision.classificationRow.applied).toBe(false);
      expect(decision.fixes.some((f) => f.action === "blocked-by-human-override")).toBe(true);
    });

    it("still writes the history row when human-overridden", () => {
      const decision = validateLoClassification(
        proposal({ confidence: 0.99 }),
        target({ humanOverriddenAt: new Date() }),
      );
      // The caller should still persist this so re-runs aren't silently lost.
      expect(decision.classificationRow).toBeDefined();
      expect(decision.classificationRow.applied).toBe(false);
    });
  });

  describe("coherence: systemRole !== NONE forces learnerVisible=false", () => {
    it("flips a learner-visible+ASSESSOR_RUBRIC proposal to hidden", () => {
      const decision = validateLoClassification(
        proposal({ systemRole: "ASSESSOR_RUBRIC", learnerVisible: true, performanceStatement: "leftover" }),
        target(),
      );
      expect(decision.outcome).toBe("apply");
      expect(decision.loRowUpdates?.learnerVisible).toBe(false);
      // performanceStatement also stripped (cascade rule)
      expect(decision.loRowUpdates?.performanceStatement).toBeNull();
      expect(decision.fixes.some((f) => f.action === "forced-hidden-when-system-role")).toBe(true);
      expect(decision.fixes.some((f) => f.action === "stripped-perf-stmt-on-hidden")).toBe(true);
    });

    it("does not modify a coherent SCORE_EXPLAINER+hidden proposal", () => {
      const decision = validateLoClassification(
        proposal({
          systemRole: "SCORE_EXPLAINER",
          learnerVisible: false,
          performanceStatement: null,
          rationale: "Averaging math is system explanation",
        }),
        target({ ref: "LO15", description: "Explain averaging" }),
      );
      expect(decision.outcome).toBe("apply");
      expect(decision.fixes.filter((f) => f.action !== "queued-low-confidence" && f.action !== "blocked-by-human-override")).toHaveLength(0);
      expect(decision.loRowUpdates).toEqual({
        learnerVisible: false,
        performanceStatement: null,
        systemRole: "SCORE_EXPLAINER",
      });
    });
  });

  describe("coherence: learnerVisible=false strips performanceStatement", () => {
    it("nulls out a performanceStatement when learnerVisible=false", () => {
      const decision = validateLoClassification(
        proposal({ learnerVisible: false, performanceStatement: "Speak fluently", systemRole: "NONE" }),
        target(),
      );
      // Note: this is a contradictory proposal (hidden LO with NONE role and a perf statement).
      // The guard strips perfStmt; learnerVisible stays false (no systemRole reason to flip it).
      expect(decision.loRowUpdates?.performanceStatement).toBeNull();
      expect(decision.fixes.some((f) => f.action === "stripped-perf-stmt-on-hidden")).toBe(true);
    });
  });

  describe("invalid enum coercion", () => {
    it("coerces an unknown systemRole to NONE", () => {
      const decision = validateLoClassification(
        proposal({ systemRole: "UNKNOWN_ROLE" as unknown as "NONE" }),
        target(),
      );
      expect(decision.loRowUpdates?.systemRole).toBe("NONE");
      expect(decision.fixes.some((f) => f.action === "coerced-system-role")).toBe(true);
    });

    it("accepts TEACHING_INSTRUCTION as a valid system role", () => {
      const decision = validateLoClassification(
        proposal({
          systemRole: "TEACHING_INSTRUCTION",
          learnerVisible: false,
          performanceStatement: null,
        }),
        target({ ref: "LO95", description: "Recognize that Part 3 is where Band 6 plateaus most often" }),
      );
      expect(decision.outcome).toBe("apply");
      expect(decision.loRowUpdates?.systemRole).toBe("TEACHING_INSTRUCTION");
      expect(decision.loRowUpdates?.learnerVisible).toBe(false);
      // Coercion fixes should NOT have fired — TEACHING_INSTRUCTION is valid.
      expect(decision.fixes.some((f) => f.action === "coerced-system-role")).toBe(false);
    });

    it("forces learnerVisible=false when classifier proposes learner-visible TEACHING_INSTRUCTION", () => {
      const decision = validateLoClassification(
        proposal({
          systemRole: "TEACHING_INSTRUCTION",
          learnerVisible: true,
          performanceStatement: "should not survive",
        }),
        target(),
      );
      expect(decision.loRowUpdates?.learnerVisible).toBe(false);
      expect(decision.loRowUpdates?.performanceStatement).toBeNull();
      expect(decision.fixes.some((f) => f.action === "forced-hidden-when-system-role")).toBe(true);
    });
  });

  describe("confidence clamping", () => {
    it("clamps > 1 to 1", () => {
      const decision = validateLoClassification(proposal({ confidence: 1.5 }), target());
      expect(decision.classificationRow.confidence).toBe(1);
      expect(decision.outcome).toBe("apply");
      expect(decision.fixes.some((f) => f.action === "clamped-confidence")).toBe(true);
    });

    it("clamps < 0 to 0 and routes to queue", () => {
      const decision = validateLoClassification(proposal({ confidence: -0.3 }), target());
      expect(decision.classificationRow.confidence).toBe(0);
      expect(decision.outcome).toBe("queue");
    });

    it("clamps NaN to 0 and routes to queue", () => {
      const decision = validateLoClassification(proposal({ confidence: NaN }), target());
      expect(decision.classificationRow.confidence).toBe(0);
      expect(decision.outcome).toBe("queue");
    });

    it("does NOT add a clamp fix when confidence is in range", () => {
      const decision = validateLoClassification(proposal({ confidence: 0.85 }), target());
      expect(decision.fixes.some((f) => f.action === "clamped-confidence")).toBe(false);
    });
  });

  describe("history row contract", () => {
    it("always includes loId, classifierVersion, and the (possibly-corrected) proposed values", () => {
      const decision = validateLoClassification(
        proposal({
          loId: "lo-42",
          classifierVersion: "claude-sonnet-4-6@2026-05-09:abc",
          systemRole: "ITEM_GENERATOR_SPEC",
          learnerVisible: true, // will be coerced to false
        }),
        target({ id: "lo-42" }),
      );
      expect(decision.classificationRow.loId).toBe("lo-42");
      expect(decision.classificationRow.classifierVersion).toBe("claude-sonnet-4-6@2026-05-09:abc");
      // After coercion: ITEM_GENERATOR_SPEC + learnerVisible=false
      expect(decision.classificationRow.proposedSystemRole).toBe("ITEM_GENERATOR_SPEC");
      expect(decision.classificationRow.proposedLearnerVisible).toBe(false);
    });

    it("trims the rationale and treats empty as null", () => {
      const decision = validateLoClassification(
        proposal({ rationale: "  matched assessor verb pattern  " }),
        target(),
      );
      expect(decision.classificationRow.rationale).toBe("matched assessor verb pattern");

      const decision2 = validateLoClassification(proposal({ rationale: "" }), target());
      expect(decision2.classificationRow.rationale).toBeNull();
    });
  });
});
