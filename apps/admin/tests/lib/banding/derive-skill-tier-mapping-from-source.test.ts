/**
 * Tests for `lib/banding/derive-skill-tier-mapping-from-source.ts` (#1630) —
 * the pure function that lifts a per-skill `tierScheme` signal up to the
 * course-level `skillTierMapping` shape.
 *
 * Pins the decision contract set by TL review:
 *
 *   - `cto` scheme → 5-level mapping with Foundation/Practitioner/Distinction
 *     labels + `derivedFromScheme: "cto"`.
 *   - `cefr` scheme → the CEFR preset's mapping + labels, so BandingPicker's
 *     `detectPresetId()` auto-detects it.
 *   - `three` (the default scheme) and unrecognised schemes → null (IELTS
 *     default still serves; operator decides).
 *   - **Q2 advisory-null on disagreement**: a course mixing two schemes
 *     produces no derivation (the union has >1 scheme).
 *   - Empty input → null.
 */

import { describe, it, expect } from "vitest";
import { deriveSkillTierMappingFromSkills } from "@/lib/banding/derive-skill-tier-mapping-from-source";
import { TIER_PRESETS } from "@/lib/banding/presets";
import type { ParsedSkill } from "@/lib/wizard/project-course-reference";

/** Minimal ParsedSkill with only the field the deriver reads (`tierScheme`). */
function skill(tierScheme: string[]): ParsedSkill {
  return {
    ref: `SKILL-${tierScheme.join("-")}`,
    name: "test skill",
    tiers: {},
    tierScheme,
  };
}

const CTO = ["foundation", "developing", "practitioner", "distinction"];
const CEFR = ["a1", "a2", "b1", "b2", "c1", "c2"];
const THREE = ["emerging", "developing", "secure"];

describe("deriveSkillTierMappingFromSkills — recognised schemes", () => {
  it("derives the CTO mapping with native labels", () => {
    const result = deriveSkillTierMappingFromSkills([skill(CTO)]);
    expect(result).not.toBeNull();
    expect(result!.derivedFromScheme).toBe("cto");
    expect(result!.tierLabels.approachingEmerging).toBe("Foundation");
    expect(result!.tierLabels.secure).toBe("Distinction");
    expect(result!.mapping).toBe(TIER_PRESETS["5-level"].mapping);
  });

  it("derives the CEFR mapping from the CEFR preset", () => {
    const result = deriveSkillTierMappingFromSkills([skill(CEFR)]);
    expect(result).not.toBeNull();
    expect(result!.derivedFromScheme).toBe("cefr");
    expect(result!.mapping).toBe(TIER_PRESETS.cefr.mapping);
    expect(result!.tierLabels).toEqual(TIER_PRESETS.cefr.tierLabels);
  });

  it("derives from a unanimous multi-skill course", () => {
    const result = deriveSkillTierMappingFromSkills([skill(CTO), skill(CTO), skill(CTO)]);
    expect(result?.derivedFromScheme).toBe("cto");
  });
});

describe("deriveSkillTierMappingFromSkills — null cases", () => {
  it("returns null for the default 3-tier scheme", () => {
    expect(deriveSkillTierMappingFromSkills([skill(THREE)])).toBeNull();
  });

  it("returns null for an unrecognised scheme", () => {
    expect(deriveSkillTierMappingFromSkills([skill(["low", "mid", "high"])])).toBeNull();
  });

  it("returns null (advisory) when skills disagree on scheme — Q2", () => {
    expect(deriveSkillTierMappingFromSkills([skill(CTO), skill(CEFR)])).toBeNull();
  });

  it("returns null when one skill is unrecognised even if others agree", () => {
    expect(deriveSkillTierMappingFromSkills([skill(CTO), skill(["x", "y"])])).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(deriveSkillTierMappingFromSkills([])).toBeNull();
  });

  it("does not match a scheme when tier order differs", () => {
    const reordered = ["distinction", "practitioner", "developing", "foundation"];
    expect(deriveSkillTierMappingFromSkills([skill(reordered)])).toBeNull();
  });
});
