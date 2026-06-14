/**
 * Tests for `lib/compose/section-loaders.ts` — #1558 (Story 3 of EPIC #1555).
 *
 * Pins three contract properties the route + the executor `sectionsOnly`
 * option both depend on:
 *
 *   1. Every `ComposeSectionKey` has a non-empty `SECTION_OUTPUT_KEYS`
 *      entry (no structurally non-patchable sections in the S1 taxonomy).
 *   2. `getLoaderDepsForSections` returns the union, sorted, deduped.
 *   3. `getOutputKeysForSections` returns the union, sorted, deduped.
 */

import { describe, it, expect } from "vitest";
import {
  SECTION_OUTPUT_KEYS,
  getLoaderDepsForSections,
  getOutputKeysForSections,
} from "@/lib/compose/section-loaders";
import { COMPOSE_SECTION_KEYS } from "@/lib/compose/section";

describe("section-loaders — #1558", () => {
  describe("SECTION_OUTPUT_KEYS — completeness + non-emptiness", () => {
    it("covers every ComposeSectionKey", () => {
      const covered = Object.keys(SECTION_OUTPUT_KEYS).sort();
      const expected = [...COMPOSE_SECTION_KEYS].sort();
      expect(covered).toEqual(expected);
    });

    it("every section has at least one outputKey (no structurally non-patchable sections)", () => {
      for (const key of COMPOSE_SECTION_KEYS) {
        expect(SECTION_OUTPUT_KEYS[key].length).toBeGreaterThan(0);
      }
    });

    it("listed outputKeys match the conservative-overlist convention (no extraneous _ prefixes outside _quickStart / _preamble)", () => {
      const allowedUnderscorePrefixed = new Set(["_quickStart", "_preamble"]);
      for (const [section, keys] of Object.entries(SECTION_OUTPUT_KEYS)) {
        for (const k of keys) {
          if (k.startsWith("_")) {
            expect(allowedUnderscorePrefixed.has(k), `section ${section}: underscore-prefixed outputKey ${k} not in allowlist`).toBe(true);
          }
        }
      }
    });
  });

  describe("getLoaderDepsForSections — union semantics", () => {
    it("returns empty array for empty input", () => {
      expect(getLoaderDepsForSections([])).toEqual([]);
    });

    it("returns empty array for sections with no loader deps (config-sourced)", () => {
      expect(getLoaderDepsForSections(["firstCallMode"])).toEqual([]);
      expect(getLoaderDepsForSections(["welcome", "onboarding", "intake"])).toEqual([]);
    });

    it("returns the section's loader for single-section pipeline-state queries", () => {
      expect(getLoaderDepsForSections(["loMastery"])).toEqual(["callerAttributes"]);
      expect(getLoaderDepsForSections(["behaviorTargets"])).toEqual(["callerTargets"]);
    });

    it("returns sorted, deduped union for multi-section queries", () => {
      const deps = getLoaderDepsForSections(["loMastery", "moduleMastery", "behaviorTargets"]);
      // loMastery + moduleMastery share callerAttributes; behaviorTargets adds callerTargets
      expect(deps).toEqual(["callerAttributes", "callerTargets"]);
    });
  });

  describe("getOutputKeysForSections — union semantics", () => {
    it("returns empty array for empty input", () => {
      expect(getOutputKeysForSections([])).toEqual([]);
    });

    it("returns the section's outputKeys", () => {
      expect(getOutputKeysForSections(["personality"])).toEqual(["personality"]);
      expect(getOutputKeysForSections(["behaviorTargets"])).toEqual(["behaviorTargets"]);
    });

    it("dedupes overlapping outputKeys across sections", () => {
      // welcome + onboarding + intake all flow into _quickStart
      expect(getOutputKeysForSections(["welcome", "onboarding", "intake"])).toEqual(["_quickStart"]);
    });

    it("returns sorted union", () => {
      const out = getOutputKeysForSections(["personality", "behaviorTargets"]);
      expect(out).toEqual(["behaviorTargets", "personality"]);
    });
  });
});
