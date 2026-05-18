/**
 * Guards the `content-trust.extract` call-point against regressing to a maxTokens
 * value too low for IELTS-sized markdown (24-30 KB) docs. #466.
 *
 * Live wizard run on 2026-05-18 produced 3× truncation warnings when this was
 * 4000, with jsonrepair silently salvaging partial JSON — likely cause of the
 * 11-modules-not-4 curriculum bug (#469).
 *
 * Specialist extractors (-question-bank, -comprehension, -assessment) already
 * had ≥8192. This test ensures the generic + curriculum extractor path stays
 * in line.
 */

import { describe, it, expect } from "vitest";
import { CALL_POINTS } from "@/lib/ai/call-points";

describe("content-trust.extract maxTokens floor (#466)", () => {
  it("default maxTokens is ≥ 8192", () => {
    const point = CALL_POINTS.find(p => p.id === "content-trust.extract");
    expect(point).toBeDefined();
    expect(point!.defaults.maxTokens).toBeGreaterThanOrEqual(8192);
  });

  it("matches the floor used by sibling specialist extractors", () => {
    const generic = CALL_POINTS.find(p => p.id === "content-trust.extract");
    const comprehension = CALL_POINTS.find(p => p.id === "content-trust.extract-comprehension");
    const assessment = CALL_POINTS.find(p => p.id === "content-trust.extract-assessment");
    expect(generic!.defaults.maxTokens).toBeGreaterThanOrEqual(comprehension!.defaults.maxTokens!);
    expect(generic!.defaults.maxTokens).toBeGreaterThanOrEqual(assessment!.defaults.maxTokens!);
  });
});
