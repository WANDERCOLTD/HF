import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSkillsFramework,
  projectCourseReference,
  skillNameToParameterName,
} from "../project-course-reference";

const FIXTURES = join(__dirname, "fixtures");
const IELTS_V22 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.2.md"), "utf-8");

const SOURCE_ID = "src_test_00000000-0000-0000-0000-000000000000";

// ── parseSkillsFramework ───────────────────────────────────────────────────

describe("parseSkillsFramework", () => {
  it("returns empty when no Skills Framework section is present", () => {
    const result = parseSkillsFramework("# Title\n\nNo skills here.\n");
    expect(result.skills).toEqual([]);
    expect(result.validationWarnings).toEqual([]);
  });

  it("captures the 4 IELTS Speaking criteria from the v2.2 fixture", () => {
    const result = parseSkillsFramework(IELTS_V22);
    expect(result.skills).toHaveLength(4);
    expect(result.skills.map((s) => s.ref)).toEqual([
      "SKILL-01",
      "SKILL-02",
      "SKILL-03",
      "SKILL-04",
    ]);
    expect(result.skills.map((s) => s.name)).toEqual([
      "Fluency and Coherence",
      "Lexical Resource",
      "Grammatical Range and Accuracy",
      "Pronunciation",
    ]);
  });

  it("captures all three tiers for each IELTS skill", () => {
    const result = parseSkillsFramework(IELTS_V22);
    for (const skill of result.skills) {
      expect(skill.tiers.emerging, `${skill.ref} emerging`).toBeTruthy();
      expect(skill.tiers.developing, `${skill.ref} developing`).toBeTruthy();
      expect(skill.tiers.secure, `${skill.ref} secure`).toBeTruthy();
    }
  });

  it("captures the description paragraph before the tier list", () => {
    const result = parseSkillsFramework(IELTS_V22);
    const fc = result.skills.find((s) => s.ref === "SKILL-01");
    expect(fc?.description).toContain("speak at length without unnatural hesitation");
  });

  it("accepts v3.0 colon-style tier formatting (**Emerging:**)", () => {
    const v3 = `## Skills Framework

### SKILL-01: Active Listening

A short description.

- **Emerging:** weak listening signals
- **Developing:** mid-tier listening
- **Secure:** secure listening
`;
    const result = parseSkillsFramework(v3);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].tiers.emerging).toBe("weak listening signals");
    expect(result.skills[0].tiers.developing).toBe("mid-tier listening");
    expect(result.skills[0].tiers.secure).toBe("secure listening");
  });

  it("warns when a skill has no Secure tier", () => {
    const incomplete = `## Skills Framework

### SKILL-01: Half Skill

Desc.

- **Emerging:** thin
- **Developing:** mid
`;
    const result = parseSkillsFramework(incomplete);
    expect(result.skills).toHaveLength(1);
    expect(result.validationWarnings.some((w) => w.code === "SKILL_MISSING_SECURE_TIER")).toBe(true);
  });

  it("stops at the next ## section boundary", () => {
    const noisy = `## Skills Framework

### SKILL-01: Real Skill

Desc.

- **Emerging:** a
- **Developing:** b
- **Secure:** c

## Teaching Approach

### SKILL-99: Should Not Match

This is not a skill — it's a heading in another section.
`;
    const result = parseSkillsFramework(noisy);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].ref).toBe("SKILL-01");
  });
});

// ── skillNameToParameterName ───────────────────────────────────────────────

describe("skillNameToParameterName", () => {
  it("slugifies common IELTS skill names deterministically", () => {
    expect(skillNameToParameterName("Fluency & Coherence")).toBe("skill_fluency_and_coherence");
    expect(skillNameToParameterName("Lexical Resource")).toBe("skill_lexical_resource");
    expect(skillNameToParameterName("Grammatical Range & Accuracy")).toBe("skill_grammatical_range_and_accuracy");
    expect(skillNameToParameterName("Pronunciation")).toBe("skill_pronunciation");
  });

  it("collapses multiple non-alphanumeric runs to a single underscore", () => {
    expect(skillNameToParameterName("X / Y -- Z")).toBe("skill_x_y_z");
  });
});

// ── projectCourseReference — IELTS v2.2 smoke test ─────────────────────────

describe("projectCourseReference — IELTS v2.2 fixture", () => {
  const result = projectCourseReference(IELTS_V22, { sourceContentId: SOURCE_ID });

  it("returns a projection without throwing", () => {
    expect(result).toBeDefined();
    expect(result.configPatch.modulesAuthored).toBe(true);
  });

  it("derives 4 ACHIEVE goals — one per skill", () => {
    const achieve = result.configPatch.goalTemplates.filter((g) => g.type === "ACHIEVE");
    expect(achieve).toHaveLength(4);
    expect(achieve.every((g) => g.isAssessmentTarget)).toBe(true);
    expect(achieve.map((g) => g.ref)).toEqual(["SKILL-01", "SKILL-02", "SKILL-03", "SKILL-04"]);
  });

  it("derives one BehaviorTarget per skill with PLAYBOOK scope and Secure target", () => {
    expect(result.behaviorTargets).toHaveLength(4);
    expect(result.behaviorTargets.every((t) => t.scope === "PLAYBOOK")).toBe(true);
    expect(result.behaviorTargets.every((t) => t.targetValue === 1.0)).toBe(true);
  });

  it("requests 4 Parameter upserts — one per skill, all type BEHAVIOR", () => {
    expect(result.parameters).toHaveLength(4);
    expect(result.parameters.every((p) => p.type === "BEHAVIOR")).toBe(true);
    expect(result.parameters.map((p) => p.name)).toContain("skill_fluency_and_coherence");
    expect(result.parameters.map((p) => p.name)).toContain("skill_lexical_resource");
    expect(result.parameters.map((p) => p.name)).toContain("skill_grammatical_range_and_accuracy");
    expect(result.parameters.map((p) => p.name)).toContain("skill_pronunciation");
  });

  it("derives LEARN goals for every OUT-NN line in the doc", () => {
    const learn = result.configPatch.goalTemplates.filter((g) => g.type === "LEARN");
    // The IELTS v2.2 fixture has at least 3 outcome statements; assert > 0
    // and that all carry the OUT-NN ref.
    expect(learn.length).toBeGreaterThan(0);
    expect(learn.every((g) => /^OUT-\d+$/.test(g.ref))).toBe(true);
    expect(learn.every((g) => g.isAssessmentTarget === false)).toBe(true);
  });

  it("emits CurriculumModule projections for every authored module incl. examiner mode", () => {
    // The fixture has 5 authored modules: baseline (examiner), part1, part2, part3, mock
    expect(result.curriculumModules).toHaveLength(5);
    const slugs = result.curriculumModules.map((m) => m.slug);
    expect(slugs).toContain("baseline");
    expect(slugs).toContain("mock");
  });

  it("sets progressionMode based on learnerSelectable across all modules", () => {
    // IELTS v2.2 has learner-selectable modules (Part 1/2/3) → learner-picks
    expect(result.configPatch.progressionMode).toBe("learner-picks");
  });

  it("is pure — running twice yields equal output", () => {
    const a = projectCourseReference(IELTS_V22, { sourceContentId: SOURCE_ID });
    const b = projectCourseReference(IELTS_V22, { sourceContentId: SOURCE_ID });
    expect(a).toEqual(b);
  });
});

// ── projectCourseReference — empty / minimal cases ─────────────────────────

describe("projectCourseReference — edge cases", () => {
  it("returns an empty projection for an empty body", () => {
    const result = projectCourseReference("", { sourceContentId: SOURCE_ID });
    expect(result.configPatch.modules).toBeUndefined();
    expect(result.configPatch.goalTemplates).toEqual([]);
    expect(result.behaviorTargets).toEqual([]);
    expect(result.curriculumModules).toEqual([]);
    expect(result.parameters).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it("emits only LEARN goals when only OUT-NN lines are present", () => {
    const onlyOutcomes = `# Course

**OUT-01: Learn to swim.**

**OUT-02: Learn to dive.**
`;
    const result = projectCourseReference(onlyOutcomes, { sourceContentId: SOURCE_ID });
    expect(result.configPatch.goalTemplates).toHaveLength(2);
    expect(result.configPatch.goalTemplates.every((g) => g.type === "LEARN")).toBe(true);
    expect(result.behaviorTargets).toEqual([]);
    expect(result.parameters).toEqual([]);
  });

  it("emits ACHIEVE + BehaviorTarget + Parameter only when Skills Framework present", () => {
    const onlySkills = `# Course

## Skills Framework

### SKILL-01: One

Desc.

- **Emerging:** a
- **Developing:** b
- **Secure:** c
`;
    const result = projectCourseReference(onlySkills, { sourceContentId: SOURCE_ID });
    expect(result.configPatch.goalTemplates.filter((g) => g.type === "ACHIEVE")).toHaveLength(1);
    expect(result.behaviorTargets).toHaveLength(1);
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters[0].name).toBe("skill_one");
  });

  it("includes moduleSourceRef only when docVersion is provided", () => {
    const withVersion = projectCourseReference(IELTS_V22, {
      sourceContentId: SOURCE_ID,
      docVersion: "v2.2",
    });
    expect(withVersion.configPatch.moduleSourceRef).toEqual({
      docId: SOURCE_ID,
      version: "v2.2",
    });

    const withoutVersion = projectCourseReference(IELTS_V22, { sourceContentId: SOURCE_ID });
    expect(withoutVersion.configPatch.moduleSourceRef).toBeUndefined();
  });
});
