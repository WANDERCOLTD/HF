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
import { deriveQualificationAnchor, isAnchorSafe } from "@/lib/curriculum/qualification-anchor";

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

/**
 * #1081 Slice 2B.2 — isAnchorSafe() unit tests (AI-to-DB guard).
 *
 * The guard ensures we only use anchors that are either (a) canonical
 * known-qualifications, or (b) match strict slug shape (lowercase
 * alphanumeric + hyphens, no leading/trailing hyphens). This blocks
 * typo'd or AI-injected anchors from collapsing two unrelated
 * qualifications onto the same Curriculum.
 */
describe("isAnchorSafe", () => {
  it("accepts the canonical SIAS CIO/CTO override anchor", () => {
    expect(isAnchorSafe("sias-cio-cto-v6")).toBe(true);
  });

  it("accepts a single-char slug-form anchor", () => {
    expect(isAnchorSafe("a")).toBe(true);
    expect(isAnchorSafe("7")).toBe(true);
  });

  it("accepts well-formed slug anchors (lowercase + hyphens + digits)", () => {
    expect(isAnchorSafe("ofqual-some-quality-v2")).toBe(true);
    expect(isAnchorSafe("highfield-l2-food-safety")).toBe(true);
    expect(isAnchorSafe("a1")).toBe(true);
  });

  it("rejects null/undefined/empty", () => {
    expect(isAnchorSafe(null)).toBe(false);
    expect(isAnchorSafe(undefined)).toBe(false);
    expect(isAnchorSafe("")).toBe(false);
  });

  it("rejects anchors with uppercase letters", () => {
    expect(isAnchorSafe("SIAS-CIO-CTO-V6")).toBe(false);
    expect(isAnchorSafe("Some-Anchor")).toBe(false);
  });

  it("rejects anchors with whitespace", () => {
    expect(isAnchorSafe("sias cio cto v6")).toBe(false);
    expect(isAnchorSafe(" leading-space")).toBe(false);
  });

  it("rejects anchors with leading or trailing hyphens", () => {
    expect(isAnchorSafe("-leading-hyphen")).toBe(false);
    expect(isAnchorSafe("trailing-hyphen-")).toBe(false);
  });

  it("rejects anchors with punctuation other than hyphen", () => {
    expect(isAnchorSafe("sias_cio_cto")).toBe(false); // underscore
    expect(isAnchorSafe("sias.cio.cto")).toBe(false); // dot
    expect(isAnchorSafe("sias/cio")).toBe(false); // slash
  });

  it("rejects anchors longer than 80 chars", () => {
    const long = "a" + "b".repeat(80);
    expect(long.length).toBe(81);
    expect(isAnchorSafe(long)).toBe(false);
  });
});
