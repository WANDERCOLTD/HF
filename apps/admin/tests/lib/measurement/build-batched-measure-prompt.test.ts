/**
 * Pins the structural contract of `buildBatchedMeasurePrompt` (#1539).
 *
 * The prompt body MUST interpolate each MEASURE spec's `promptTemplate`
 * verbatim. The previous inline `buildBatchedCallerPrompt` discarded
 * rubrics; this test stops a future edit silently reintroducing that
 * gap.
 */

import { describe, it, expect, vi } from "vitest";

import { buildBatchedMeasurePrompt } from "@/lib/measurement/build-batched-measure-prompt";
import type { ParameterWithSpec } from "@/lib/measurement/parameter-spec-map";

const ieltsRubric = `Score the learner on IELTS Speaking Band Descriptors for Fluency and Coherence.

Band 9: Speaks fluently with only rare repetition or self-correction.
Band 7: Speaks at length without noticeable effort or loss of coherence.
Band 5: Usually maintains flow of speech but uses repetition / self-correction.`;

const fluencyParam: ParameterWithSpec = {
  parameterId: "skill_fluency_and_coherence_fc",
  name: "Fluency and Coherence",
  definition: "How smoothly the learner speaks.",
  analysisSpecId: "spec-ielts-fc",
  specSlug: "IELTS-FLUENCY-MEASURE-001",
  promptTemplate: ieltsRubric,
  specPriority: 100,
};

const unspeccedParam: ParameterWithSpec = {
  parameterId: "PERSONALITY-OPENNESS",
  name: "Openness",
  definition: "Curiosity, imagination, willingness to try new things.",
  analysisSpecId: "spec-pers",
  specSlug: "PERS-001",
  promptTemplate: null,
  specPriority: 50,
};

describe("buildBatchedMeasurePrompt", () => {
  it("includes the parameterId:name list", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "Tutor: ... Learner: ...",
      measureParams: [fluencyParam],
      learnActions: [],
    });
    expect(prompt).toContain(
      "PARAMS TO SCORE: skill_fluency_and_coherence_fc:Fluency and Coherence",
    );
  });

  it("interpolates promptTemplate verbatim as a per-parameter rubric block", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "Tutor: ... Learner: ...",
      measureParams: [fluencyParam],
      learnActions: [],
    });
    expect(prompt).toContain(
      "RUBRIC[skill_fluency_and_coherence_fc] (from spec IELTS-FLUENCY-MEASURE-001):",
    );
    expect(prompt).toContain(ieltsRubric.trim());
  });

  it("emits SCORING RUBRICS section even when ALL params have rubrics", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "Tutor: ... Learner: ...",
      measureParams: [fluencyParam],
      learnActions: [],
    });
    expect(prompt).toContain("SCORING RUBRICS");
  });

  it("falls back to name+definition when promptTemplate is null and logs a warning", () => {
    const log = vi.fn();
    const prompt = buildBatchedMeasurePrompt({
      transcript: "Tutor: ... Learner: ...",
      measureParams: [unspeccedParam],
      learnActions: [],
      log,
    });
    expect(prompt).toContain(
      "RUBRIC[PERSONALITY-OPENNESS] (from spec PERS-001, no promptTemplate set",
    );
    expect(prompt).toContain("Openness");
    expect(prompt).toContain(
      "Curiosity, imagination, willingness to try new things.",
    );
    expect(log).toHaveBeenCalledOnce();
    const [msg, meta] = log.mock.calls[0]!;
    expect(msg).toContain("#1539");
    expect(meta).toEqual({
      unspecced: [
        { parameterId: "PERSONALITY-OPENNESS", specSlug: "PERS-001" },
      ],
    });
  });

  it("mixes specced + unspecced params and emits both rubric shapes", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "T:...L:...",
      measureParams: [fluencyParam, unspeccedParam],
      learnActions: [],
    });
    expect(prompt).toContain("from spec IELTS-FLUENCY-MEASURE-001");
    expect(prompt).toContain(
      "from spec PERS-001, no promptTemplate set",
    );
  });

  it("respects transcriptLimit", () => {
    const longTranscript = "¶".repeat(10_000); // ¶ — not present elsewhere in the template
    const prompt = buildBatchedMeasurePrompt({
      transcript: longTranscript,
      measureParams: [fluencyParam],
      learnActions: [],
      transcriptLimit: 500,
    });
    const sentinelChars = (prompt.match(/¶/g) || []).length;
    expect(sentinelChars).toBe(500);
  });

  it("emits the LEARNING OUTCOMES section when moduleContext is provided", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "T:...L:...",
      measureParams: [fluencyParam],
      learnActions: [],
      moduleContext: {
        moduleId: "mod-1",
        moduleName: "Part 1 — Familiar Topics",
        learningOutcomes: ["lo:speak_about_hometown", "lo:describe_routines"],
      },
    });
    expect(prompt).toContain("LEARNING OUTCOMES TO ASSESS");
    expect(prompt).toContain("lo:speak_about_hometown");
    expect(prompt).toContain('"learning":{"moduleId":"mod-1"');
  });

  it("does NOT log unspecced warnings when every param has a rubric", () => {
    const log = vi.fn();
    buildBatchedMeasurePrompt({
      transcript: "T:...L:...",
      measureParams: [fluencyParam],
      learnActions: [],
      log,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("instructs the LLM to use rubric — not infer from parameter name", () => {
    const prompt = buildBatchedMeasurePrompt({
      transcript: "T:...L:...",
      measureParams: [fluencyParam],
      learnActions: [],
    });
    expect(prompt).toMatch(
      /use the matching rubric for each parameter — DO NOT guess from the parameter name alone/,
    );
  });
});
