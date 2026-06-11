/**
 * Behavioral + structural tests for `eslint-rules/no-hardcoded-spec-slug.mjs` (audit HF-I).
 *
 * smokeRule (HF-F: one location per rule, both checks here) + RuleTester behavioural cases.
 *
 * Pins:
 *   - fires on a spec-slug literal in lib/ runtime code (GOAL-001, PIPELINE-001,
 *     CONTENT-EXTRACT-001)
 *   - does NOT fire in lib/config.ts (slugs live there as defaults)
 *   - does NOT fire in tests / scripts / prisma seed
 *   - does NOT fire on non-slug-shaped strings or config.specs.* identifiers
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-hardcoded-spec-slug.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-hardcoded-spec-slug", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-hardcoded-spec-slug", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const LIB = "/repo/apps/admin/lib/goals/extract-goals.ts";
const TRANSFORM = "/repo/apps/admin/lib/prompt/composition/transforms/pedagogy.ts";
const CONFIG = "/repo/apps/admin/lib/config.ts";
const TEST = "/repo/apps/admin/tests/lib/goals.test.ts";
const SEED = "/repo/apps/admin/prisma/seed-from-specs.ts";

tester.run("no-hardcoded-spec-slug", rule as never, {
  valid: [
    // Slug literal in config.ts — that's where slugs live.
    { filename: CONFIG, code: `const x = "GOAL-001";` },
    // In a test file — fixtures are fine.
    { filename: TEST, code: `const x = "PIPELINE-001";` },
    // In seed — seed data is allowed.
    { filename: SEED, code: `const slug = "INIT-001";` },
    // config.specs.* member access — identifier, not a literal.
    { filename: LIB, code: `const x = config.specs.goal;` },
    // Non-slug-shaped string in runtime code.
    { filename: LIB, code: `const x = "hello-world";` },
    // Lowercase / wrong shape — not a slug.
    { filename: LIB, code: `const x = "abc-12";` },
  ],
  invalid: [
    {
      filename: LIB,
      code: `const x = "GOAL-001";`,
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: TRANSFORM,
      code: `const m = specs.find((s) => s.slug.includes("TUT-001"));`,
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: LIB,
      code: `const x = "CONTENT-EXTRACT-001";`,
      errors: [{ messageId: "hardcoded" }],
    },
  ],
});
