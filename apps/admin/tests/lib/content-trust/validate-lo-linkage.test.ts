import { describe, it, expect } from "vitest";
import {
  sanitiseLORef,
  isValidLoPair,
  parseLoLine,
  scoreCoverage,
  STRUCTURED_LO_REF_PATTERN,
} from "@/lib/content-trust/validate-lo-linkage";

describe("validate-lo-linkage", () => {
  describe("STRUCTURED_LO_REF_PATTERN", () => {
    it("matches LO1, LO10, LO123", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("LO1")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("LO10")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("LO123")).toBe(true);
    });

    it("matches AC refs", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("AC2.3")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("AC2.3.4")).toBe(true);
    });

    it("matches hierarchical R-LO-AC refs", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("R04-LO2-AC2.3")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("R1-LO1")).toBe(true);
    });

    it("rejects free text", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("Character analysis")).toBe(false);
      expect(STRUCTURED_LO_REF_PATTERN.test("Literary devices")).toBe(false);
      expect(STRUCTURED_LO_REF_PATTERN.test("Vocabulary in context")).toBe(false);
    });

    it("rejects empty and partial", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("")).toBe(false);
      expect(STRUCTURED_LO_REF_PATTERN.test("LO")).toBe(false);
      expect(STRUCTURED_LO_REF_PATTERN.test("1")).toBe(false);
    });

    // ── #292/#293: authored OUT-NN refs (course-reference markdown #258) ──

    it("matches OUT-01, OUT-12, OUT123 (authored scheme)", () => {
      expect(STRUCTURED_LO_REF_PATTERN.test("OUT-01")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("OUT-1")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("OUT12")).toBe(true);
      expect(STRUCTURED_LO_REF_PATTERN.test("out-27")).toBe(true);
    });
  });

  describe("sanitiseLORef", () => {
    it("trims and uppercases valid refs", () => {
      expect(sanitiseLORef("  lo1  ")).toBe("LO1");
      expect(sanitiseLORef("LO2")).toBe("LO2");
      expect(sanitiseLORef("r04-lo2-ac2.3")).toBe("R04-LO2-AC2.3");
    });

    it("preserves hyphenated legacy form", () => {
      expect(sanitiseLORef("LO-1")).toBe("LO-1");
      expect(sanitiseLORef("lo-2")).toBe("LO-2");
    });

    it("returns null for free text (the Secret Garden case)", () => {
      expect(sanitiseLORef("Character analysis")).toBe(null);
      expect(sanitiseLORef("Literary devices")).toBe(null);
      expect(sanitiseLORef("Vocabulary in context")).toBe(null);
    });

    it("returns null for empty, null, undefined, whitespace", () => {
      expect(sanitiseLORef(null)).toBe(null);
      expect(sanitiseLORef(undefined)).toBe(null);
      expect(sanitiseLORef("")).toBe(null);
      expect(sanitiseLORef("   ")).toBe(null);
    });

    it("preserves OUT-NN authored refs through sanitisation", () => {
      expect(sanitiseLORef("OUT-01")).toBe("OUT-01");
      expect(sanitiseLORef("out-27")).toBe("OUT-27");
      expect(sanitiseLORef("  OUT-12  ")).toBe("OUT-12");
    });
  });

  describe("isValidLoPair", () => {
    it("accepts a real ref + description pair", () => {
      expect(isValidLoPair("LO1", "Identify themes in prose")).toBe(true);
    });

    it("rejects description === ref (the Secret Garden bug)", () => {
      expect(isValidLoPair("LO1", "LO1")).toBe(false);
      expect(isValidLoPair("LO-1", "LO1")).toBe(false); // case-insensitive
    });

    it("rejects empty or short description", () => {
      expect(isValidLoPair("LO1", "")).toBe(false);
      expect(isValidLoPair("LO1", "   ")).toBe(false);
      expect(isValidLoPair("LO1", "XY")).toBe(false);
    });

    it("rejects null inputs", () => {
      expect(isValidLoPair(null, "description")).toBe(false);
      expect(isValidLoPair("LO1", null)).toBe(false);
    });
  });

  describe("parseLoLine", () => {
    it("parses LO1: Description", () => {
      expect(parseLoLine("LO1: Identify themes")).toEqual({
        ref: "LO1",
        description: "Identify themes",
      });
    });

    it("parses with dash separator", () => {
      expect(parseLoLine("LO2 - Analyse structure")).toEqual({
        ref: "LO2",
        description: "Analyse structure",
      });
    });

    it("parses with em-dash", () => {
      expect(parseLoLine("LO3 – Apply X")).toEqual({
        ref: "LO3",
        description: "Apply X",
      });
    });

    it("parses hierarchical refs", () => {
      expect(parseLoLine("R04-LO2-AC2.3: Demonstrate Y")).toEqual({
        ref: "R04-LO2-AC2.3",
        description: "Demonstrate Y",
      });
    });

    it("returns null for bare ref with no description (the Secret Garden bug)", () => {
      expect(parseLoLine("LO1")).toBe(null);
      expect(parseLoLine("LO2")).toBe(null);
    });

    it("returns null for free text with no ref", () => {
      expect(parseLoLine("Character analysis")).toBe(null);
      expect(parseLoLine("Students will understand themes")).toBe(null);
    });

    it("returns null for null/empty", () => {
      expect(parseLoLine(null)).toBe(null);
      expect(parseLoLine(undefined)).toBe(null);
      expect(parseLoLine("")).toBe(null);
      expect(parseLoLine("   ")).toBe(null);
    });

    it("rejects ref-only with separator but no description", () => {
      expect(parseLoLine("LO1:")).toBe(null);
      expect(parseLoLine("LO1: ")).toBe(null);
    });
  });

  describe("scoreCoverage", () => {
    it("computes a scorecard", () => {
      const sc = scoreCoverage({
        total: 192,
        withValidRef: 10,
        withFk: 0,
        distinctRefs: 9,
        garbageDescriptions: 3,
      });
      expect(sc.coveragePct).toBe(5);
      expect(sc.fkCoveragePct).toBe(0);
      expect(sc.orphans).toBe(182);
    });

    it("handles zero total", () => {
      const sc = scoreCoverage({
        total: 0,
        withValidRef: 0,
        withFk: 0,
        distinctRefs: 0,
        garbageDescriptions: 0,
      });
      expect(sc.coveragePct).toBe(0);
      expect(sc.fkCoveragePct).toBe(0);
    });
  });
});
