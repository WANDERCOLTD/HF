/**
 * Journey setting registry — completeness + integrity pins.
 *
 * Catches at CI (issue #1676 AC §6):
 *   1. Every entry has non-empty id, group, educatorLabel, storagePath
 *   2. Every entry's group is a valid JourneyGroup or SettingsGroup
 *   3. Every composeImpact.sections[] element is a valid ComposeSectionKey
 *   4. Every composeImpact.kinds[] element is a valid ComposeImpactKind
 *   5. No duplicate ids within JOURNEY_SETTINGS
 *   6. Every group G1..G7 has entries
 *   7. Exact group counts: G1:5 G2:6 G3:4 G4:17 G5:3 G6:4 G7:6
 *   8. JOURNEY_SETTINGS.length === 45
 *   9. VOICE_SETTINGS.length === 11
 *  10. Cross-registry `interruptSensitivity` shares storagePath
 *  11. writeGate === "operator-only" → composeImpact.requiresReprompt
 *      OR composeImpact.sections.length === 0 (operator-only settings
 *      that change pipeline behaviour need explicit reprompt; pure
 *      operator gates have no compose impact and don't need it)
 *  12. previewLocators[].section references valid ComposeSectionKey
 *  13. JOURNEY_PHASE_FILTERS has exactly 7 values including "All"
 */

import { describe, it, expect } from "vitest";

import { COMPOSE_SECTION_KEYS } from "@/lib/compose/section";
import {
  JOURNEY_GROUPS,
  JOURNEY_PHASE_FILTERS,
} from "@/lib/journey/setting-groups";
import {
  COMPOSE_IMPACT_KINDS,
} from "@/lib/journey/setting-contracts";
import {
  JOURNEY_SETTINGS,
  JOURNEY_SETTINGS_BY_ID,
  JOURNEY_SETTINGS_BY_GROUP,
} from "@/lib/journey/setting-contracts.entries";
import {
  SETTINGS_GROUPS,
  VOICE_SETTINGS,
  VOICE_SETTINGS_BY_ID,
} from "@/lib/settings/voice-setting-contracts";

describe("Journey setting registry — Phase 0 completeness (AC §6 issue #1676)", () => {
  it("(1) every entry has non-empty id, group, educatorLabel, storagePath", () => {
    for (const s of JOURNEY_SETTINGS) {
      expect(s.id).toBeTruthy();
      expect(s.group).toBeTruthy();
      expect(s.educatorLabel).toBeTruthy();
      expect(s.storagePath).toBeTruthy();
    }
  });

  it("(2) every entry's group is a valid JourneyGroup", () => {
    const validGroups = Object.keys(JOURNEY_GROUPS);
    for (const s of JOURNEY_SETTINGS) {
      expect(validGroups).toContain(s.group);
    }
  });

  it("(3) every composeImpact.sections[] entry is a real ComposeSectionKey", () => {
    for (const s of JOURNEY_SETTINGS) {
      for (const sec of s.composeImpact.sections) {
        expect(COMPOSE_SECTION_KEYS).toContain(sec);
      }
    }
  });

  it("(4) every composeImpact.kinds[] entry is a valid ComposeImpactKind", () => {
    for (const s of JOURNEY_SETTINGS) {
      for (const k of s.composeImpact.kinds) {
        expect(COMPOSE_IMPACT_KINDS).toContain(k);
      }
    }
  });

  it("(5) no duplicate ids within JOURNEY_SETTINGS", () => {
    const ids = JOURNEY_SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("(6) every group G1..G7 has at least one entry", () => {
    for (const g of Object.keys(JOURNEY_GROUPS) as Array<
      keyof typeof JOURNEY_GROUPS
    >) {
      expect(JOURNEY_SETTINGS_BY_GROUP[g].length).toBeGreaterThan(0);
    }
  });

  it("(7) exact group counts match the audit", () => {
    expect(JOURNEY_SETTINGS_BY_GROUP.G1.length).toBe(5);
    expect(JOURNEY_SETTINGS_BY_GROUP.G2.length).toBe(6);
    expect(JOURNEY_SETTINGS_BY_GROUP.G3.length).toBe(4);
    expect(JOURNEY_SETTINGS_BY_GROUP.G4.length).toBe(17);
    expect(JOURNEY_SETTINGS_BY_GROUP.G5.length).toBe(3);
    expect(JOURNEY_SETTINGS_BY_GROUP.G6.length).toBe(4);
    expect(JOURNEY_SETTINGS_BY_GROUP.G7.length).toBe(6);
  });

  it("(8) JOURNEY_SETTINGS.length === 45", () => {
    expect(JOURNEY_SETTINGS.length).toBe(45);
  });

  it("(9) VOICE_SETTINGS.length === 11", () => {
    expect(VOICE_SETTINGS.length).toBe(11);
  });

  it("(10) cross-registry `interruptSensitivity` shares storagePath", () => {
    const journeyEntry = JOURNEY_SETTINGS_BY_ID.interruptSensitivity;
    const voiceEntry = VOICE_SETTINGS_BY_ID.interruptSensitivity;
    expect(journeyEntry).toBeDefined();
    expect(voiceEntry).toBeDefined();
    expect(journeyEntry.storagePath).toEqual(voiceEntry.storagePath);
  });

  it("(11) operator-only writeGate implies reprompt OR empty sections", () => {
    for (const s of JOURNEY_SETTINGS) {
      if (s.writeGate !== "operator-only") continue;
      const ok =
        s.composeImpact.requiresReprompt === true ||
        s.composeImpact.sections.length === 0;
      expect(ok, `${s.id} is operator-only but has compose impact without reprompt`).toBe(true);
    }
  });

  it("(12) every previewLocators[].section references a real ComposeSectionKey", () => {
    for (const s of JOURNEY_SETTINGS) {
      for (const loc of s.previewLocators) {
        expect(COMPOSE_SECTION_KEYS).toContain(loc.section);
      }
    }
  });

  it("(13) JOURNEY_PHASE_FILTERS has exactly 7 values including 'All'", () => {
    expect(JOURNEY_PHASE_FILTERS.length).toBe(7);
    expect(JOURNEY_PHASE_FILTERS).toContain("All");
  });
});

describe("Voice registry — secondary integrity pins", () => {
  it("every voice entry uses an SettingsGroup key", () => {
    const valid = Object.keys(SETTINGS_GROUPS);
    for (const s of VOICE_SETTINGS) {
      expect(valid).toContain(s.group);
    }
  });

  it("autoEnableLink.targetId refs resolve within journey or voice registry", () => {
    const allIds = new Set([
      ...JOURNEY_SETTINGS.map((s) => s.id),
      ...VOICE_SETTINGS.map((s) => s.id),
    ]);
    for (const s of [...JOURNEY_SETTINGS, ...VOICE_SETTINGS]) {
      for (const l of s.autoEnableLinks ?? []) {
        expect(allIds.has(l.targetId), `${s.id} autoEnableLink → ${l.targetId} (missing)`).toBe(true);
      }
    }
  });
});
