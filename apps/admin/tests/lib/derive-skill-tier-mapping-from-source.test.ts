/**
 * Pins #1630 helper — source-derived skillTierMapping.
 *
 * Five cases per the TL ruling on the open questions:
 *   (a) Q2 advisory-null when skills disagree on scheme.
 *   (b) CTO scheme → derives 4-slot mapping with CTO labels.
 *   (c) CEFR scheme → derives mapping matching the existing `cefr` preset.
 *   (d) 3-tier (`three`) scheme → null (IELTS default still serves).
 *   (e) Unrecognised scheme → null (operator territory).
 *
 * Plus boundary cases: empty skills, mixed known + unknown.
 */

import { describe, it, expect } from "vitest";
import { deriveSkillTierMappingFromSkills } from "@/lib/banding/derive-skill-tier-mapping-from-source";
import { TIER_PRESETS } from "@/lib/banding/presets";
import type { ParsedSkill } from "@/lib/wizard/project-course-reference";

function skill(ref: string, scheme: string[]): ParsedSkill {
  return {
    ref,
    name: `Test ${ref}`,
    tiers: Object.fromEntries(scheme.map((t) => [t, `${t} descriptor`])),
    tierScheme: scheme,
  };
}

const CTO = ["foundation", "developing", "practitioner", "distinction"];
const CEFR = ["a1", "a2", "b1", "b2", "c1", "c2"];
const THREE = ["emerging", "developing", "secure"];
const CUSTOM = ["beginner", "intermediate", "advanced", "expert", "master"];

describe("deriveSkillTierMappingFromSkills", () => {
  it("returns null when no skills are supplied", () => {
    expect(deriveSkillTierMappingFromSkills([])).toBeNull();
  });

  it("returns null when skills disagree on tier scheme (advisory)", () => {
    const skills = [
      skill("SKILL-01", CTO),
      skill("SKILL-02", CTO),
      skill("SKILL-03", CEFR),
    ];
    expect(deriveSkillTierMappingFromSkills(skills)).toBeNull();
  });

  it("derives CTO mapping when all skills use the CTO scheme", () => {
    const skills = [
      skill("SKILL-01", CTO),
      skill("SKILL-02", CTO),
      skill("SKILL-03", CTO),
    ];
    const derived = deriveSkillTierMappingFromSkills(skills);
    expect(derived).not.toBeNull();
    expect(derived!.derivedFromScheme).toBe("cto");
    expect(derived!.tierLabels).toEqual({
      approachingEmerging: "Foundation",
      emerging: "Developing",
      developing: "Practitioner",
      secure: "Distinction",
    });
    expect(derived!.mapping.tierBands).toEqual({
      approachingEmerging: 1,
      emerging: 2,
      developing: 3,
      secure: 4,
    });
  });

  it("derives CEFR mapping matching the existing CEFR preset", () => {
    const skills = [skill("SKILL-01", CEFR), skill("SKILL-02", CEFR)];
    const derived = deriveSkillTierMappingFromSkills(skills);
    expect(derived).not.toBeNull();
    expect(derived!.derivedFromScheme).toBe("cefr");
    expect(derived!.mapping).toEqual(TIER_PRESETS["cefr"].mapping);
    expect(derived!.tierLabels).toEqual(TIER_PRESETS["cefr"].tierLabels);
  });

  it("returns null for the 3-tier scheme (IELTS default still serves)", () => {
    const skills = [skill("SKILL-01", THREE), skill("SKILL-02", THREE)];
    expect(deriveSkillTierMappingFromSkills(skills)).toBeNull();
  });

  it("returns null for unrecognised schemes", () => {
    const skills = [skill("SKILL-01", CUSTOM)];
    expect(deriveSkillTierMappingFromSkills(skills)).toBeNull();
  });

  it("returns null when one skill carries an unrecognised scheme alongside CTO skills (advisory)", () => {
    const skills = [
      skill("SKILL-01", CTO),
      skill("SKILL-02", CTO),
      skill("SKILL-03", CUSTOM),
    ];
    expect(deriveSkillTierMappingFromSkills(skills)).toBeNull();
  });
});
