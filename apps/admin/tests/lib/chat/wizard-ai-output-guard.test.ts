import { describe, it, expect } from "vitest";
import { guardAILearningOutcomes } from "@/lib/chat/wizard-ai-output-guard";
import type { GoalTemplate } from "@/lib/types/json-fields";

const noTemplates: GoalTemplate[] = [];

describe("guardAILearningOutcomes (#447)", () => {
  it("passes through legitimate learner outcomes unchanged", () => {
    const result = guardAILearningOutcomes(
      [
        "Speak naturally about familiar topics for 4-5 minutes",
        "Extend Part 1 answers with one supporting detail",
      ],
      noTemplates,
    );

    expect(result.accepted).toEqual([
      "Speak naturally about familiar topics for 4-5 minutes",
      "Extend Part 1 answers with one supporting detail",
    ]);
    expect(result.filtered).toEqual([]);
    expect(result.skippedByGate).toBe(false);
  });

  it("drops IELTS band-descriptor strings", () => {
    const inputs = [
      "Band 2 LR: Only produces isolated words or memorised utterances",
      "Band 4 P: Uses a limited range of pronunciation features",
      "Band 2 GRA: Cannot produce basic sentence forms",
      "Band 4 FC: Unable to keep going without noticeable pauses",
    ];
    const result = guardAILearningOutcomes(inputs, noTemplates);

    expect(result.accepted).toEqual([]);
    expect(result.filtered).toHaveLength(4);
    expect(result.filtered.every((f) => f.pattern.includes("Band"))).toBe(true);
  });

  it("drops calibration prose lines", () => {
    const inputs = [
      "A candidate can legitimately score Band 7 on one criterion and Band 5 on another",
      "Approaching: learner produces fragmented utterances",
      "Developing: learner sustains short turns with hesitation",
      "Secure. Fluent across all four criteria",
    ];
    const result = guardAILearningOutcomes(inputs, noTemplates);

    expect(result.accepted).toEqual([]);
    expect(result.filtered).toHaveLength(4);
  });

  it("retains learner outcomes that happen to mention 'Band' but are not band-descriptors", () => {
    const result = guardAILearningOutcomes(
      ["Aim for IELTS Band 6 in next mock exam"], // legitimate goal
      noTemplates,
    );
    // Doesn't start with "Band <N> <CODE>:" so the regex misses it on purpose.
    expect(result.accepted).toEqual(["Aim for IELTS Band 6 in next mock exam"]);
    expect(result.filtered).toEqual([]);
  });

  it("soft-gates when the playbook has an OUT-NN LEARN template", () => {
    const existing: GoalTemplate[] = [
      { type: "LEARN", name: "Speak naturally about familiar topics", ref: "OUT-01", isDefault: true },
    ];
    const result = guardAILearningOutcomes(
      ["Some new AI-suggested outcome", "Another one"],
      existing,
    );

    expect(result.skippedByGate).toBe(true);
    expect(result.gateReason).toContain("OUT-NN");
    expect(result.accepted).toEqual([]);
    expect(result.filtered).toEqual([]);
  });

  it("soft-gates when the playbook has a LEARN template carrying sourceContentId", () => {
    const existing: GoalTemplate[] = [
      {
        type: "LEARN",
        name: "Projection-written outcome",
        sourceContentId: "src-123",
        isDefault: true,
      },
    ];
    const result = guardAILearningOutcomes(["Anything"], existing);

    expect(result.skippedByGate).toBe(true);
    expect(result.gateReason).toContain("sourceContentId");
    expect(result.accepted).toEqual([]);
  });

  it("does NOT soft-gate when only ACHIEVE templates exist", () => {
    const existing: GoalTemplate[] = [
      { type: "ACHIEVE", name: "Reach Secure on FC", ref: "SKILL-01", isAssessmentTarget: true },
    ];
    const result = guardAILearningOutcomes(["A legitimate LO"], existing);

    expect(result.skippedByGate).toBe(false);
    expect(result.accepted).toEqual(["A legitimate LO"]);
  });

  it("does NOT soft-gate when only hand-authored bare LEARN templates exist (no OUT ref, no sourceContentId)", () => {
    const existing: GoalTemplate[] = [
      { type: "LEARN", name: "Some hand-authored goal", isDefault: true },
    ];
    const result = guardAILearningOutcomes(["A new LO"], existing);

    expect(result.skippedByGate).toBe(false);
    expect(result.accepted).toEqual(["A new LO"]);
  });

  it("filters empty/whitespace strings without counting them as drops", () => {
    const result = guardAILearningOutcomes(["", "   ", "Valid outcome"], noTemplates);
    expect(result.accepted).toEqual(["Valid outcome"]);
    expect(result.filtered).toEqual([]);
  });

  it("handles a mix of valid + rogue + gated scenario correctly when not gated", () => {
    const result = guardAILearningOutcomes(
      [
        "Speak naturally about familiar topics",
        "Band 2 LR: Only produces isolated words",
        "A candidate can legitimately score Band 7",
        "Extend Part 1 answers with one supporting detail",
      ],
      noTemplates,
    );

    expect(result.accepted).toEqual([
      "Speak naturally about familiar topics",
      "Extend Part 1 answers with one supporting detail",
    ]);
    expect(result.filtered).toHaveLength(2);
  });
});
