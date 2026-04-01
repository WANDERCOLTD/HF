/**
 * Seed-vs-Code Drift Detection for COMP-001
 *
 * Ensures the COMP-001 seed JSON (docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json)
 * stays in sync with the code defaults in getDefaultSections().
 *
 * WHY THIS EXISTS:
 * The COMPOSE spec can be driven by either DB sections or code defaults.
 * When the DB has sections, those are used — so if a new section is added
 * to the code but not the seed, it silently disappears from every composed
 * prompt. This caused audience guidance, teaching style, and pedagogy mode
 * to be missing for months (2026-04-01 fix).
 *
 * RULE: Every section in getDefaultSections() must exist in the seed JSON,
 * and vice versa. If you add a section to the code, add it to the seed too.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getDefaultSections } from "@/lib/prompt/composition/CompositionExecutor";

const SEED_PATH = join(
  __dirname,
  "../../../../docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json",
);

function loadSeedSections(): Array<{ id: string; outputKey: string; [k: string]: any }> {
  const raw = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
  return raw.sections || [];
}

describe("COMP-001 seed ↔ code sync", () => {
  const codeSections = getDefaultSections();
  const seedSections = loadSeedSections();

  const codeIds = new Set(codeSections.map((s) => s.id));
  const seedIds = new Set(seedSections.map((s) => s.id));

  it("every code section exists in the seed JSON", () => {
    const missingFromSeed = codeSections
      .filter((s) => !seedIds.has(s.id))
      .map((s) => `${s.id} (${s.name})`);

    expect(missingFromSeed, [
      "Sections in getDefaultSections() but missing from COMP-001 seed JSON.",
      "Add them to docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json",
      "then run db:seed to update the DB.",
    ].join("\n")).toEqual([]);
  });

  it("every seed section exists in code defaults", () => {
    const missingFromCode = seedSections
      .filter((s) => !codeIds.has(s.id))
      .map((s) => `${s.id} (${s.name})`);

    expect(missingFromCode, [
      "Sections in COMP-001 seed JSON but not in getDefaultSections().",
      "Either add them to CompositionExecutor.getDefaultSections()",
      "or remove them from the seed if they are dead.",
    ].join("\n")).toEqual([]);
  });

  it("section count matches exactly", () => {
    expect(seedSections.length, "Seed and code section counts diverged").toBe(
      codeSections.length,
    );
  });

  it("outputKeys match between seed and code", () => {
    const mismatches: string[] = [];
    for (const codeSec of codeSections) {
      const seedSec = seedSections.find((s) => s.id === codeSec.id);
      if (seedSec && seedSec.outputKey !== codeSec.outputKey) {
        mismatches.push(
          `${codeSec.id}: seed="${seedSec.outputKey}" code="${codeSec.outputKey}"`,
        );
      }
    }
    expect(mismatches, "outputKey mismatches between seed and code").toEqual([]);
  });

  it("activateWhen conditions match between seed and code", () => {
    const mismatches: string[] = [];
    for (const codeSec of codeSections) {
      const seedSec = seedSections.find((s) => s.id === codeSec.id);
      if (!seedSec) continue;
      const codeCondition = codeSec.activateWhen?.condition;
      const seedCondition = seedSec.activateWhen?.condition;
      if (codeCondition !== seedCondition) {
        mismatches.push(
          `${codeSec.id}: seed="${seedCondition}" code="${codeCondition}"`,
        );
      }
    }
    expect(mismatches, "activateWhen condition mismatches").toEqual([]);
  });

  it("instructions.dependsOn has no dead references", () => {
    const instrSeed = seedSections.find((s) => s.id === "instructions");
    if (!instrSeed?.dependsOn) return;

    const deadRefs = (instrSeed.dependsOn as string[]).filter(
      (dep) => !seedIds.has(dep),
    );
    expect(deadRefs, [
      "instructions.dependsOn references sections that don't exist in the seed.",
      "Remove dead references or add the missing sections.",
    ].join("\n")).toEqual([]);
  });
});
