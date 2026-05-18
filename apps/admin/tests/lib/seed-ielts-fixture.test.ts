/**
 * Validate that the canonical IELTS seed fixture parses cleanly through the
 * projection pipeline (`projectCourseReference`).
 *
 * The fixture at `tests/fixtures/course-reference-ielts-v2.2.md` drives
 * `prisma/seed-ielts-course.ts`. If this test fails, the seed will produce
 * a degenerate playbook — so failure here is a hard blocker, not advisory.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { projectCourseReference } from "@/lib/wizard/project-course-reference";

const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "course-reference-ielts-v2.2.md");

describe("IELTS seed fixture", () => {
  const bodyText = fs.readFileSync(FIXTURE_PATH, "utf-8");
  const projection = projectCourseReference(bodyText, { sourceContentId: "test-source" });

  it("detects the 4 IELTS skills (SKILL-01..SKILL-04)", () => {
    expect(projection.skills).toHaveLength(4);
    expect(projection.skills.map((s) => s.ref)).toEqual([
      "SKILL-01",
      "SKILL-02",
      "SKILL-03",
      "SKILL-04",
    ]);
    expect(projection.skills.map((s) => s.name)).toEqual([
      "Fluency and Coherence",
      "Lexical Resource",
      "Grammatical Range and Accuracy",
      "Pronunciation",
    ]);
  });

  it("every skill has all three tiers populated", () => {
    for (const skill of projection.skills) {
      expect(skill.tiers.emerging, `${skill.ref} missing emerging`).toBeTruthy();
      expect(skill.tiers.developing, `${skill.ref} missing developing`).toBeTruthy();
      expect(skill.tiers.secure, `${skill.ref} missing secure`).toBeTruthy();
    }
  });

  it("emits 4 BehaviorTargets — one per skill — with targetValue 1.0 (Secure) and skillRef", () => {
    expect(projection.behaviorTargets).toHaveLength(4);
    for (const bt of projection.behaviorTargets) {
      expect(bt.targetValue).toBe(1.0);
      expect(bt.skillRef).toMatch(/^SKILL-0\d$/);
      expect(bt.parameterName).toMatch(/^skill_/);
      expect(bt.scope).toBe("PLAYBOOK");
    }
  });

  it("emits 4 Parameters — one per skill — typed BEHAVIOR", () => {
    expect(projection.parameters).toHaveLength(4);
    for (const p of projection.parameters) {
      expect(p.type).toBe("BEHAVIOR");
      expect(p.name).toMatch(/^skill_/);
    }
  });

  it("emits a per-playbook MEASURE spec with 4 triggers (one per skill)", () => {
    expect(projection.measureSpec).toBeDefined();
    expect(projection.measureSpec?.triggers).toHaveLength(4);
  });

  it("extracts 8 outcome statements (OUT-01..OUT-08)", () => {
    const outcomes = projection.configPatch.outcomes ?? {};
    expect(Object.keys(outcomes)).toHaveLength(8);
    expect(outcomes["OUT-01"]).toMatch(/extends part 1 answers/i);
    expect(outcomes["OUT-04"]).toMatch(/sustains the part 2 long turn/i);
    expect(outcomes["OUT-08"]).toMatch(/band 7 grammar/i);
  });

  it("emits ACHIEVE goals for every skill (4 total)", () => {
    const achieveGoals = projection.configPatch.goalTemplates.filter((g) => g.type === "ACHIEVE");
    expect(achieveGoals).toHaveLength(4);
    for (const g of achieveGoals) {
      expect(g.ref).toMatch(/^SKILL-0\d$/);
      expect(g.isAssessmentTarget).toBe(true);
    }
  });

  it("emits LEARN goals for every outcome (8 total)", () => {
    const learnGoals = projection.configPatch.goalTemplates.filter((g) => g.type === "LEARN");
    expect(learnGoals).toHaveLength(8);
    for (const g of learnGoals) {
      expect(g.ref).toMatch(/^OUT-0\d$/);
    }
  });

  it("detects 4 authored modules with stable slugs", () => {
    expect(projection.curriculumModules).toHaveLength(4);
    expect(projection.curriculumModules.map((m) => m.slug).sort()).toEqual([
      "baseline",
      "part1",
      "part2",
      "part3",
    ]);
  });

  it("each module links to its primary outcomes", () => {
    const part2 = projection.curriculumModules.find((m) => m.slug === "part2");
    expect(part2).toBeDefined();
    const refs = part2!.learningObjectives.map((lo) => lo.ref).sort();
    expect(refs).toEqual(["OUT-04", "OUT-05", "OUT-07"]);
  });

  it("produces zero validation warnings — all skills have complete tier descriptors", () => {
    // skillWarnings would fire if any tier was missing. The fixture is the
    // canonical seed source; warnings here mean the markdown is malformed.
    const skillCodes = new Set([
      "SKILL_MISSING_SECURE_TIER",
      "SKILL_INCOMPLETE_TIERS",
    ]);
    const skillRelatedWarnings = projection.validationWarnings.filter((w) =>
      skillCodes.has(w.code),
    );
    expect(skillRelatedWarnings).toEqual([]);
  });
});
