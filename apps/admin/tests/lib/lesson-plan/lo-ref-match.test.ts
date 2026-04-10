import { describe, it, expect } from "vitest";
import {
  wordBoundaryContains,
  loRefsMatch,
  assertionMatchesAnyLoRef,
} from "@/lib/lesson-plan/lo-ref-match";

describe("lo-ref-match", () => {
  describe("wordBoundaryContains", () => {
    it("matches exact string", () => {
      expect(wordBoundaryContains("LO1", "LO1")).toBe(true);
    });

    it("matches token inside a dash-separated ref", () => {
      expect(wordBoundaryContains("R04-LO2-AC2.3", "LO2")).toBe(true);
    });

    it("matches token at the start", () => {
      expect(wordBoundaryContains("LO1-AC1.1", "LO1")).toBe(true);
    });

    it("matches token at the end", () => {
      expect(wordBoundaryContains("MOD-LO3", "LO3")).toBe(true);
    });

    it("does NOT match LO1 inside LO10 (the bug)", () => {
      expect(wordBoundaryContains("LO10", "LO1")).toBe(false);
    });

    it("does NOT match LO1 inside LO11", () => {
      expect(wordBoundaryContains("LO11", "LO1")).toBe(false);
    });

    it("does NOT match LO1 inside R04-LO10-AC1.1", () => {
      expect(wordBoundaryContains("R04-LO10-AC1.1", "LO1")).toBe(false);
    });

    it("treats dots as boundaries", () => {
      expect(wordBoundaryContains("AC2.3.LO1", "LO1")).toBe(true);
    });

    it("handles empty inputs", () => {
      expect(wordBoundaryContains("", "LO1")).toBe(false);
      expect(wordBoundaryContains("LO1", "")).toBe(false);
    });
  });

  describe("loRefsMatch", () => {
    it("matches identical refs", () => {
      expect(loRefsMatch("LO1", "LO1")).toBe(true);
    });

    it("matches child assertion ref to parent LO entry", () => {
      // assertion tagged "R04-LO2-AC2.3", entry tagged "LO2"
      expect(loRefsMatch("R04-LO2-AC2.3", "LO2")).toBe(true);
    });

    it("matches parent assertion ref to child AC entry (bidirectional)", () => {
      // assertion tagged "LO2" (coarse), entry tagged "LO2-AC2.3" (specific)
      expect(loRefsMatch("LO2", "LO2-AC2.3")).toBe(true);
    });

    it("does NOT match LO1 with LO10 in either direction", () => {
      expect(loRefsMatch("LO1", "LO10")).toBe(false);
      expect(loRefsMatch("LO10", "LO1")).toBe(false);
    });

    it("does NOT match different LOs", () => {
      expect(loRefsMatch("LO1", "LO2")).toBe(false);
      expect(loRefsMatch("R04-LO1-AC1.1", "R04-LO2-AC2.1")).toBe(false);
    });

    it("handles null / undefined", () => {
      expect(loRefsMatch(null, "LO1")).toBe(false);
      expect(loRefsMatch("LO1", undefined)).toBe(false);
      expect(loRefsMatch(null, null)).toBe(false);
    });
  });

  describe("assertionMatchesAnyLoRef", () => {
    it("matches if any target ref matches", () => {
      expect(assertionMatchesAnyLoRef("R04-LO2-AC2.3", ["LO1", "LO2", "LO3"])).toBe(true);
    });

    it("returns false if no target ref matches", () => {
      expect(assertionMatchesAnyLoRef("R04-LO5-AC5.1", ["LO1", "LO2", "LO3"])).toBe(false);
    });

    it("does NOT match LO1 against assertion tagged LO10", () => {
      expect(assertionMatchesAnyLoRef("LO10", ["LO1"])).toBe(false);
    });

    it("handles empty target list", () => {
      expect(assertionMatchesAnyLoRef("LO1", [])).toBe(false);
    });

    it("handles null assertion ref", () => {
      expect(assertionMatchesAnyLoRef(null, ["LO1"])).toBe(false);
    });
  });
});
