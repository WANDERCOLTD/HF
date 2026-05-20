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

  it("drops IELTS band-descriptor strings (abbreviated form)", () => {
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

  // Real IELTS rubrics use the criterion in full prose rather than the
  // abbreviated code. The original regex (`Band N <CODE>:`) missed these
  // because the colon falls after the criterion name, not after the digit
  // (live repro on hf-dev 2026-05-19 — wizard hydrated 40 band rows as
  // skillsFramework entries).
  it("drops IELTS band-descriptor strings (prose form)", () => {
    const inputs = [
      "Band 8 Lexical Resource: Wide vocabulary used readily and flexibly",
      "Band 5 Grammatical Range and Accuracy: Basic sentence forms",
      "Band 0 Fluency and Coherence: Does not attend / does not complete",
      "Band 9 Pronunciation: Uses a full range of pronunciation features",
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

  // #555 — test-format facts (Part N lasts/involves/is, examiner/candidate
  // behaviour, "The X test is …"). Live repro 2026-05-20: IELTS Speaking course
  // produced 6 LOs that were all test-format facts, none learner-facing.
  it("drops test-format facts about Part-segment timing and structure (#555)", () => {
    const inputs = [
      "Part 1 lasts 4–5 minutes and involves introduction plus interview on familiar topics",
      "Part 3 lasts 4–5 minutes and involves two-way discussion on abstract themes linked to Part 2",
      "Part 2 involves a 1-minute prep plus a 1–2 minute monologue",
      "Part 1 is a scripted interview with no clarification allowed",
      "Part 3 takes the form of two-way discussion on abstract themes",
    ];
    const result = guardAILearningOutcomes(inputs, noTemplates);

    expect(result.accepted).toEqual([]);
    expect(result.filtered).toHaveLength(5);
    expect(result.filtered.every((f) => f.pattern.startsWith("^Part\\s"))).toBe(true);
  });

  it("drops examiner/candidate behaviour facts (#555)", () => {
    const inputs = [
      "In Part 3, the examiner asks scripted prompts and probes with follow-up questions",
      "In Part 1, the examiner asks scripted questions from a topic frame and cannot rephrase",
      "In Part 2, candidates get 1 minute preparation plus 1–2 minutes for monologue",
      "In Part 3, candidates are expected to extend their answers with examples",
    ];
    const result = guardAILearningOutcomes(inputs, noTemplates);

    expect(result.accepted).toEqual([]);
    expect(result.filtered).toHaveLength(4);
    expect(result.filtered.every((f) => f.pattern.startsWith("^In\\s+Part"))).toBe(true);
  });

  it("drops test-overview sentences (#555)", () => {
    const inputs = [
      "The IELTS Speaking test is a face-to-face interview between one candidate and one examiner, lasting 11–14 minutes in total",
      "The same test is administered to Academic and General Training candidates",
      "The test is delivered in a quiet examination room",
      "The official Speaking test is graded on four criteria",
    ];
    const result = guardAILearningOutcomes(inputs, noTemplates);

    expect(result.accepted).toEqual([]);
    expect(result.filtered).toHaveLength(4);
    expect(result.filtered.every((f) => f.pattern.startsWith("^The\\s"))).toBe(true);
  });

  it("retains legitimate learner-facing outcomes that mention Part N or 'test' mid-sentence (#555)", () => {
    const legitimate = [
      "Produce a 1–2 minute Part 2 monologue with clear discourse markers",
      "Extend Part 1 answers with one supporting detail",
      "Aim for Band 7 in Part 2 discussion",
      "Demonstrate Band 7 lexical resource through topic-specific vocabulary",
      "Use cohesive devices accurately in Part 3 abstract discussion",
      "Build confidence ahead of the test by rehearsing each Part",
      "Prepare for the IELTS Speaking test by practising fluency drills weekly",
    ];
    const result = guardAILearningOutcomes(legitimate, noTemplates);

    expect(result.accepted).toEqual(legitimate);
    expect(result.filtered).toEqual([]);
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
