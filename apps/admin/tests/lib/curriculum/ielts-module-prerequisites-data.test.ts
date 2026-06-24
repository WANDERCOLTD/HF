/**
 * #2318 — IELTS module prerequisites declared in seed.
 *
 * Source-walk test: parses `prisma/seed-ielts-course.ts` and asserts the
 * PREREQS dictionary carries the BDD-required shape (HF-IELTS-Pre-Voice-
 * Testing-Checklist Unit 5). Pure regex + structural assertions — no DB
 * required. Fires CI if a future refactor silently drops a prereq row
 * OR loosens the Mock minCompletions counts.
 *
 * The runtime resolver shape is pinned separately by
 * `tests/lib/curriculum/check-module-unlock.test.ts`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SEED_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "prisma",
  "seed-ielts-course.ts",
);

describe("IELTS module prerequisites in seed-ielts-course.ts (#2318)", () => {
  const source = fs.readFileSync(SEED_PATH, "utf-8");

  it("declares the #2318 prereqs section anchored to the issue number", () => {
    expect(source).toMatch(/4a-prereqs.*#2318/);
    expect(source).toMatch(/PREREQS:\s*Record<string,/);
  });

  it("declares baseline as an entry-gate (empty prereqs array)", () => {
    expect(source).toMatch(/baseline:\s*\[\s*\]/);
  });

  it.each(["part1", "part2", "part3"])(
    "declares %s as requiring 1× baseline COMPLETED (legacy string form)",
    (slug) => {
      // string form == "needs ≥ 1 COMPLETED attempt" per
      // check-module-unlock.ts:50-51 normalisation
      expect(source).toMatch(new RegExp(`${slug}:\\s*\\["baseline"\\]`));
    },
  );

  it("declares Mock prereqs with minCompletions matching BDD Unit 5", () => {
    // 1× baseline + 2× part1 + 2× part3
    expect(source).toMatch(
      /mock:\s*\[[\s\S]*?\{\s*moduleId:\s*"baseline",\s*minCompletions:\s*1\s*\}/,
    );
    expect(source).toMatch(
      /\{\s*moduleId:\s*"part1",\s*minCompletions:\s*2\s*\}/,
    );
    expect(source).toMatch(
      /\{\s*moduleId:\s*"part3",\s*minCompletions:\s*2\s*\}/,
    );
  });

  it("does NOT declare a part2 prereq on Mock (Part 2 is auto-included via Mock's coversModules)", () => {
    // Per the IELTS course-ref + BDD Unit 5: Mock covers Part 1/2/3 in one
    // call (coversModules fan-out). The minCompletions gate is on the
    // INDEPENDENT Part 1 + Part 3 practice modules — Part 2 monologue
    // practice does not feed the same gate.
    const mockBlock = source.match(/mock:\s*\[([\s\S]*?)\]/);
    expect(mockBlock).not.toBeNull();
    if (mockBlock) {
      expect(mockBlock[1]).not.toMatch(/moduleId:\s*"part2"/);
    }
  });

  it("routes through updatePlaybookConfig (canonical chokepoint, not a bare prisma.playbook.update)", () => {
    // #2318 Lattice survey result: prereqs go through the canonical
    // PlaybookConfig writer so composeInputsUpdatedAt bumps correctly.
    expect(source).toMatch(/updatePlaybookConfig\(\s*playbook\.id/);
    expect(source).toMatch(/reason:\s*["']#2318/);
  });
});
