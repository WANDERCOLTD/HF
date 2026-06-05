/**
 * #1081 Slice 2B.1 — deriveQualificationAnchor() unit tests.
 *
 * The helper labels Curricula teaching the same regulated qualification with
 * a stable anchor string. NOT a mastery-sharing mechanism (sharing comes from
 * PlaybookCurriculum role=linked).
 *
 * Cases:
 *   1. Override match (canonical case)
 *   2. Override match (case-insensitive)
 *   3. Override match (alternative body — "SIAS" instead of "Ofqual")
 *   4. Fallback slugify (no override)
 *   5. Fallback diacritic strip
 *   6. Null/empty inputs → null
 *   7. Whitespace-only inputs → null
 *   8. One null, one valid — derive from ref alone
 *   9. Slugify length cap (<= 80 chars)
 */

import { describe, it, expect } from "vitest";
import { deriveQualificationAnchor } from "@/lib/curriculum/qualification-anchor";

describe("deriveQualificationAnchor", () => {
  it("returns canonical anchor for known-qualification override match (Ofqual case)", () => {
    expect(deriveQualificationAnchor("Ofqual", "SIAS / The CIO/CTO Standard V6.0")).toBe(
      "sias-cio-cto-v6",
    );
  });

  it("override lookup is case-insensitive", () => {
    expect(deriveQualificationAnchor("ofqual", "sias / the cio/cto standard v6.0")).toBe(
      "sias-cio-cto-v6",
    );
  });

  it("matches alternative known body 'SIAS' with the same ref", () => {
    expect(deriveQualificationAnchor("SIAS", "The CIO/CTO Standard V6.0")).toBe("sias-cio-cto-v6");
  });

  it("falls back to slugify(body + ref) when no override matches", () => {
    expect(deriveQualificationAnchor("Ofqual", "NMC English Language Requirement V2")).toBe(
      "ofqual-nmc-english-language-requirement-v2",
    );
  });

  it("strips diacritics in slugify fallback", () => {
    expect(deriveQualificationAnchor(null, "Café Français Standard")).toBe(
      "cafe-francais-standard",
    );
  });

  it("returns null for null/empty inputs", () => {
    expect(deriveQualificationAnchor(null, null)).toBeNull();
    expect(deriveQualificationAnchor("", "")).toBeNull();
    expect(deriveQualificationAnchor("", null)).toBeNull();
    expect(deriveQualificationAnchor(undefined, undefined)).toBeNull();
  });

  it("returns null when both inputs are whitespace-only", () => {
    expect(deriveQualificationAnchor("   ", "  ")).toBeNull();
  });

  it("derives from ref alone when body is null", () => {
    expect(deriveQualificationAnchor(null, "Some Standard V1")).toBe("some-standard-v1");
  });

  it("caps slugified output at 80 chars", () => {
    const huge = "x".repeat(200);
    const result = deriveQualificationAnchor(null, huge);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(80);
  });
});
