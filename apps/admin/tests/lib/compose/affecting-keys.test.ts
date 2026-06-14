/**
 * Tests for the compose-section contract — #1556 (S1 of EPIC #1555).
 *
 * Covers:
 *  - Every entry in COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS appears in the
 *    section map (satisfies-enforced at compile time; this test guards
 *    against runtime drift if someone bypasses the satisfies via `as any`)
 *  - Same for Domain + AnalysisSpec affecting-keys lists
 *  - PIPELINE_STATE_SECTION_LOADERS covers all COMPOSE_SECTION_KEYS exactly
 *  - loMastery loader list is ["callerAttributes"] only (TL correction —
 *    curriculumAssertions feeds teaching content, NOT mastery state)
 *  - contentTrust loader list is ["subjectSources"] only (TL Q7 ruling —
 *    no staleAt column path)
 *  - `artifacts` and `memoryDeltas` are absent from COMPOSE_SECTION_KEYS
 *    (scoped to follow-on epic Group A.5 — composer doesn't emit them today)
 *  - Section values in all three key→section maps are valid ComposeSectionKey
 *    members
 */

import { describe, it, expect } from "vitest";

import {
  COMPOSE_SECTION_KEYS,
  PIPELINE_STATE_SECTION_LOADERS,
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS,
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEY_SECTIONS,
  COMPOSE_AFFECTING_DOMAIN_FIELDS,
  COMPOSE_AFFECTING_DOMAIN_FIELD_SECTIONS,
  COMPOSE_AFFECTING_SPEC_FIELDS,
  COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS,
} from "@/lib/compose";

describe("compose-section contract — #1556", () => {
  describe("key→section exhaustiveness", () => {
    it("every playbook config key has a section mapping", () => {
      for (const key of COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS) {
        expect(COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEY_SECTIONS[key]).toBeDefined();
      }
    });

    it("every domain field has a section mapping", () => {
      for (const key of COMPOSE_AFFECTING_DOMAIN_FIELDS) {
        expect(COMPOSE_AFFECTING_DOMAIN_FIELD_SECTIONS[key]).toBeDefined();
      }
    });

    it("every spec field has a section mapping", () => {
      for (const key of COMPOSE_AFFECTING_SPEC_FIELDS) {
        expect(COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS[key]).toBeDefined();
      }
    });
  });

  describe("PIPELINE_STATE_SECTION_LOADERS — exhaustive over COMPOSE_SECTION_KEYS", () => {
    it("covers all section keys with no extra entries", () => {
      const mapKeys = new Set(Object.keys(PIPELINE_STATE_SECTION_LOADERS));
      const unionKeys = new Set<string>(COMPOSE_SECTION_KEYS);
      expect(mapKeys).toEqual(unionKeys);
    });

    it("loMastery loader list is ['callerAttributes'] only (TL correction)", () => {
      expect(PIPELINE_STATE_SECTION_LOADERS.loMastery).toEqual([
        "callerAttributes",
      ]);
      expect(PIPELINE_STATE_SECTION_LOADERS.loMastery).not.toContain(
        "curriculumAssertions",
      );
    });

    it("contentTrust loader list is ['subjectSources'] only (TL Q7 — no staleAt column)", () => {
      expect(PIPELINE_STATE_SECTION_LOADERS.contentTrust).toEqual([
        "subjectSources",
      ]);
    });

    it("config-kind sections have empty loader lists", () => {
      expect(PIPELINE_STATE_SECTION_LOADERS.firstCallMode).toEqual([]);
      expect(PIPELINE_STATE_SECTION_LOADERS.modePolicy).toEqual([]);
    });

    it("config-sourced runtime sections (intake/welcome/etc) have empty loader lists", () => {
      expect(PIPELINE_STATE_SECTION_LOADERS.intake).toEqual([]);
      expect(PIPELINE_STATE_SECTION_LOADERS.welcome).toEqual([]);
      expect(PIPELINE_STATE_SECTION_LOADERS.onboarding).toEqual([]);
      expect(PIPELINE_STATE_SECTION_LOADERS.offboarding).toEqual([]);
      expect(PIPELINE_STATE_SECTION_LOADERS.nps).toEqual([]);
    });
  });

  describe("deferred sections — scoped to follow-on epic Group A.5", () => {
    // #1642 (Epic #1606 Group A.5) — `conversationArtifacts` shipped; lives in
    // the union now. The legacy "artifacts" string was never a real key, so
    // we still pin its absence to catch any rename regression.
    it("legacy 'artifacts' string is absent from COMPOSE_SECTION_KEYS", () => {
      expect(COMPOSE_SECTION_KEYS).not.toContain("artifacts");
    });

    it("memoryDeltas is absent from COMPOSE_SECTION_KEYS (no diff loader today)", () => {
      expect(COMPOSE_SECTION_KEYS).not.toContain("memoryDeltas");
    });
  });

  describe("section values point at valid ComposeSectionKey members", () => {
    it("playbook config map values are all valid section keys", () => {
      const validSections = new Set<string>(COMPOSE_SECTION_KEYS);
      for (const section of Object.values(
        COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEY_SECTIONS,
      )) {
        expect(validSections.has(section)).toBe(true);
      }
    });

    it("domain map values are all valid section keys", () => {
      const validSections = new Set<string>(COMPOSE_SECTION_KEYS);
      for (const section of Object.values(
        COMPOSE_AFFECTING_DOMAIN_FIELD_SECTIONS,
      )) {
        expect(validSections.has(section)).toBe(true);
      }
    });

    it("spec map values are all valid section keys", () => {
      const validSections = new Set<string>(COMPOSE_SECTION_KEYS);
      for (const section of Object.values(
        COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS,
      )) {
        expect(validSections.has(section)).toBe(true);
      }
    });
  });

  describe("union contains exactly the 15-member runtime taxonomy from the epic", () => {
    it("has 17 section keys total (2 config-kind + 15 runtime)", () => {
      // #1642 (Epic #1606 Group A.5) — added `conversationArtifacts` to
      // runtime arm, taking runtime count from 14 → 15 and total from 16 → 17.
      expect(COMPOSE_SECTION_KEYS.length).toBe(17);
    });

    it("includes the renamed sections (priorCallFeedback, contentTrust)", () => {
      expect(COMPOSE_SECTION_KEYS).toContain("priorCallFeedback");
      expect(COMPOSE_SECTION_KEYS).toContain("contentTrust");
      // The pre-correction names should NOT appear (sanity guards against
      // someone re-introducing the wrong names later).
      expect(COMPOSE_SECTION_KEYS).not.toContain("priorCallRecap");
      expect(COMPOSE_SECTION_KEYS).not.toContain("contentFreshness");
    });

    it("absorbs sub-field sections into parent sections (goalAdaptation → instructions, skillBands → behaviorTargets)", () => {
      expect(COMPOSE_SECTION_KEYS).toContain("instructions");
      expect(COMPOSE_SECTION_KEYS).toContain("behaviorTargets");
      expect(COMPOSE_SECTION_KEYS).not.toContain("goalAdaptation");
      expect(COMPOSE_SECTION_KEYS).not.toContain("skillBands");
    });
  });
});
