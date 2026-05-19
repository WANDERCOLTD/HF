/**
 * Tests for lib/curriculum/build-per-segment-measure-prompt.ts
 *
 * Covers:
 * - IELTS skill params are kept; non-IELTS params are stripped
 * - skill_ema_aggregate is excluded (meta-param)
 * - Returns null when no IELTS skill params present
 * - Per-part context is injected for part1/part2/part3
 * - Rubric is embedded
 * - bandToScore mapping
 */

import { describe, it, expect } from "vitest";
import {
  buildPerSegmentMeasurePrompt,
  bandToScore,
} from "@/lib/curriculum/build-per-segment-measure-prompt";

const IELTS_PARAMS = [
  {
    parameterId: "skill_fluency_and_coherence_fc",
    name: "Fluency & Coherence",
    definition: null,
  },
  {
    parameterId: "skill_lexical_resource_lr",
    name: "Lexical Resource",
    definition: null,
  },
  {
    parameterId: "skill_grammatical_range_and_accuracy_gra",
    name: "Grammatical Range & Accuracy",
    definition: null,
  },
  {
    parameterId: "skill_pronunciation_p",
    name: "Pronunciation",
    definition: null,
  },
];

const NOISE_PARAMS = [
  { parameterId: "B5-E", name: "extraversion", definition: null },
  { parameterId: "B5-O", name: "openness", definition: null },
  { parameterId: "COMP_VOCABULARY", name: "vocabulary_in_context", definition: null },
  { parameterId: "CONV_DOM", name: "conversation_dominance", definition: null },
  { parameterId: "skill_ema_aggregate", name: "Aggregate", definition: null }, // meta — excluded
];

describe("buildPerSegmentMeasurePrompt — scoping", () => {
  it("includes only the 4 IELTS skill params, drops noise + ema_aggregate", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "Assistant: Where do you live?\nUser: Warsaw.",
      measureParams: [...IELTS_PARAMS, ...NOISE_PARAMS],
      partSlug: "part1",
    });
    expect(result).not.toBeNull();
    expect(result!.scopedParams.map((p) => p.parameterId).sort()).toEqual([
      "skill_fluency_and_coherence_fc",
      "skill_grammatical_range_and_accuracy_gra",
      "skill_lexical_resource_lr",
      "skill_pronunciation_p",
    ]);
  });

  it("returns null when no IELTS skill params present (non-IELTS courses)", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "some text",
      measureParams: NOISE_PARAMS,
      partSlug: "part1",
    });
    expect(result).toBeNull();
  });

  it("returns null when only the ema_aggregate meta-param is present", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "some text",
      measureParams: [
        { parameterId: "skill_ema_aggregate", name: "Aggregate", definition: null },
      ],
      partSlug: "part1",
    });
    expect(result).toBeNull();
  });
});

describe("buildPerSegmentMeasurePrompt — prompt content", () => {
  it("injects part1 context", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part1",
    })!;
    expect(result.prompt).toContain("PART CONTEXT (part1)");
    expect(result.prompt).toContain("short Q&A on familiar everyday topics");
  });

  it("injects part2 context", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part2",
    })!;
    expect(result.prompt).toContain("PART CONTEXT (part2)");
    expect(result.prompt).toContain("2-minute long-turn monologue");
  });

  it("injects part3 context", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part3",
    })!;
    expect(result.prompt).toContain("PART CONTEXT (part3)");
    expect(result.prompt).toContain("abstract discussion");
  });

  it("falls back to a generic context for unknown part slugs", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "unknown-slug",
    })!;
    expect(result.prompt).toContain("PART CONTEXT (unknown-slug)");
  });

  it("embeds the IELTS band rubric anchors", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part1",
    })!;
    expect(result.prompt).toContain("Fluency & Coherence");
    expect(result.prompt).toContain("Lexical Resource");
    expect(result.prompt).toContain("Grammatical Range & Accuracy");
    expect(result.prompt).toContain("Pronunciation");
    expect(result.prompt).toContain("Band 5");
    expect(result.prompt).toContain("Band 6");
    expect(result.prompt).toContain("Band 7");
    expect(result.prompt).toContain("Band 8");
  });

  it("asks for band (4-9) + confidence, not free-form 0-1", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part1",
    })!;
    expect(result.prompt).toMatch(/"band":<4-9>/);
    expect(result.prompt).toMatch(/IELTS\s+(?:band\s+)?scale\s+4-9/i);
  });

  it("instructs the AI to return all 4 skill entries even with low confidence", () => {
    const result = buildPerSegmentMeasurePrompt({
      segmentText: "X",
      measureParams: IELTS_PARAMS,
      partSlug: "part1",
    })!;
    expect(result.prompt).toContain("do not omit the entry");
  });

  it("truncates the segment text at transcriptLimit", () => {
    const longText = "x".repeat(5000);
    const result = buildPerSegmentMeasurePrompt({
      segmentText: longText,
      measureParams: IELTS_PARAMS,
      partSlug: "part1",
      transcriptLimit: 1000,
    })!;
    // The promptText must contain at most 1000 chars of the "x" run
    const xRun = (result.prompt.match(/x+/g) || []).reduce(
      (max, s) => Math.max(max, s.length),
      0,
    );
    expect(xRun).toBeLessThanOrEqual(1000);
  });
});

describe("bandToScore", () => {
  it("band 9 → 1.0", () => {
    expect(bandToScore(9)).toBeCloseTo(1.0);
  });
  it("band 0 → 0", () => {
    expect(bandToScore(0)).toBe(0);
  });
  it("band 4.5 → 0.5", () => {
    expect(bandToScore(4.5)).toBeCloseTo(0.5);
  });
  it("clamps band > 9 to 1.0", () => {
    expect(bandToScore(11)).toBe(1);
  });
  it("clamps band < 0 to 0", () => {
    expect(bandToScore(-2)).toBe(0);
  });
  it("returns 0.5 for non-finite input", () => {
    expect(bandToScore(Number.NaN)).toBe(0.5);
    expect(bandToScore(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});
