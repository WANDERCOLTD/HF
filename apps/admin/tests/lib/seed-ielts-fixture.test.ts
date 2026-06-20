/**
 * Validate that the canonical IELTS course-reference doc parses cleanly
 * through the projection pipeline (`projectCourseReference`).
 *
 * The doc at `docs/external/ielts/ielts-speaking/Upload Docs/course-ref.md`
 * drives both `prisma/seed-ielts-course.ts` AND the operator wizard upload
 * path — that's the parity invariant PR #2125 establishes. If this test
 * fails, the seed will produce a degenerate playbook AND the wizard upload
 * of the same doc will too — so failure here is a hard blocker.
 *
 * The previous 227-line "Seed Edition" at
 * `tests/fixtures/course-reference-ielts-v2.2.md` is kept on disk for
 * history but no longer drives the seed.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { projectCourseReference } from "@/lib/wizard/project-course-reference";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "external",
  "ielts",
  "ielts-speaking",
  "Upload Docs",
  "course-ref.md",
);

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

  it("emits 4 BehaviorTargets — one per skill — at targetValue 0.65 (Band 6.5) and PLAYBOOK scope", () => {
    expect(projection.behaviorTargets).toHaveLength(4);
    for (const bt of projection.behaviorTargets) {
      // Fixture declares `Target band: 6.5` per skill → 6.5 / 10 = 0.65.
      expect(bt.targetValue).toBe(0.65);
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

  it("extracts 27 outcome statements (OUT-01..OUT-27) from the canonical doc", () => {
    const outcomes = projection.configPatch.outcomes ?? {};
    expect(Object.keys(outcomes)).toHaveLength(27);
    expect(outcomes["OUT-01"]).toMatch(/extends every answer/i);
    expect(outcomes["OUT-04"]).toMatch(/one-topic discipline/i);
    expect(outcomes["OUT-08"]).toMatch(/1-minute preparation/i);
  });

  it("emits ACHIEVE goals for every skill (4 total)", () => {
    const achieveGoals = projection.configPatch.goalTemplates.filter((g) => g.type === "ACHIEVE");
    expect(achieveGoals).toHaveLength(4);
    for (const g of achieveGoals) {
      expect(g.ref).toMatch(/^SKILL-0\d$/);
      expect(g.isAssessmentTarget).toBe(true);
    }
  });

  it("emits LEARN goals for every outcome (27 total)", () => {
    const learnGoals = projection.configPatch.goalTemplates.filter((g) => g.type === "LEARN");
    expect(learnGoals).toHaveLength(27);
    for (const g of learnGoals) {
      expect(g.ref).toMatch(/^OUT-\d{2}$/);
    }
  });

  it("detects 5 authored modules with stable slugs", () => {
    expect(projection.curriculumModules).toHaveLength(5);
    expect(projection.curriculumModules.map((m) => m.slug).sort()).toEqual([
      "baseline",
      "mock",
      "part1",
      "part2",
      "part3",
    ]);
  });

  it("each module links to its primary outcomes — Part 2 row from the canonical Module Catalogue", () => {
    const part2 = projection.curriculumModules.find((m) => m.slug === "part2");
    expect(part2).toBeDefined();
    const refs = part2!.learningObjectives.map((lo) => lo.ref).sort();
    expect(refs).toEqual([
      "OUT-04",
      "OUT-08",
      "OUT-09",
      "OUT-10",
      "OUT-11",
      "OUT-12",
      "OUT-18",
      "OUT-22",
      "OUT-23",
    ]);
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
