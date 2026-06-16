import { describe, it, expect } from "vitest";

import {
  getSectionsForSetting,
  getSettingsForSection,
  isComposeAffecting,
  requiresReprompt,
} from "@/lib/journey/section-staleness-bridge";
import {
  JOURNEY_SETTINGS,
} from "@/lib/journey/setting-contracts.entries";
import { COMPOSE_SECTION_KEYS } from "@/lib/compose/section";

describe("section-staleness-bridge — Phase 2B derivation helpers", () => {
  it("getSectionsForSetting returns composeImpact.sections from the registry", () => {
    expect(getSectionsForSetting("welcomeMessage")).toEqual(["welcome"]);
    expect(getSectionsForSetting("firstCallMode")).toContain("firstCallMode");
    expect(getSectionsForSetting("firstCallMode")).toContain("welcome");
  });

  it("getSectionsForSetting returns [] for an unknown setting", () => {
    expect(getSectionsForSetting("not_a_real_setting")).toEqual([]);
  });

  it("getSettingsForSection inverts the relation correctly", () => {
    const welcomeFeeders = getSettingsForSection("welcome").map((s) => s.id);
    expect(welcomeFeeders).toContain("welcomeMessage");
    expect(welcomeFeeders).toContain("firstCallMode");
  });

  it("isComposeAffecting reflects the section count", () => {
    expect(isComposeAffecting("welcomeMessage")).toBe(true);
    // skillScoringEmaHalfLife has [] sections (post-call only)
    expect(isComposeAffecting("skillScoringEmaHalfLife")).toBe(false);
    expect(isComposeAffecting("not_real")).toBe(false);
  });

  it("requiresReprompt reflects the AI-touching flag", () => {
    expect(requiresReprompt("recapSynthesisEnabled")).toBe(true);
    expect(requiresReprompt("welcomeMessage")).toBe(false);
  });

  it("every ComposeSectionKey is fed by at least one setting (orphan-section detection)", () => {
    const fed = new Set<string>();
    for (const s of JOURNEY_SETTINGS) {
      for (const sec of s.composeImpact.sections) fed.add(sec);
    }
    // Known orphans Phase 0 didn't yet cover — document the gap rather
    // than fail. Update this list as Phase 3 gap-fill adds settings.
    const KNOWN_ORPHANS = new Set([
      "moduleMastery",      // fed by writes from pipeline, not educator settings
      "behaviorTargets",    // BehaviorTarget model — separate route
      "carryOverActions",   // pipeline-written; no educator setting today
      "conversationArtifacts", // caller-scoped; no educator setting today
      "memoryDeltas",          // caller-scoped; no educator setting today
      "contentTrust",          // content-trust pipeline; no direct setting
    ]);
    for (const k of COMPOSE_SECTION_KEYS) {
      if (KNOWN_ORPHANS.has(k)) continue;
      expect(fed.has(k), `Section ${k} has no journey setting feeding it`).toBe(true);
    }
  });

  it("every setting either feeds a section OR is post-call/sequence/runtime", () => {
    for (const s of JOURNEY_SETTINGS) {
      if (s.composeImpact.sections.length > 0) continue;
      // No sections — must be a non-section-content kind. Widened in #1701
      // to include "stop-timing" for G8 cue-scheduler entries (consumed by
      // Theme 2 cue scheduler at runtime, not by the composer).
      const validNoSection = ["scoring-weight", "sequence-policy", "persona-style", "stop-timing"];
      const overlap = s.composeImpact.kinds.some((k) => validNoSection.includes(k));
      expect(
        overlap,
        `${s.id} has no sections but kinds=${JSON.stringify(s.composeImpact.kinds)}`,
      ).toBe(true);
    }
  });
});
