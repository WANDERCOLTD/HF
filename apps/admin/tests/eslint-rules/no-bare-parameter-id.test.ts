/**
 * Behavioral + structural tests for `eslint-rules/no-bare-parameter-id.mjs` — #1950.
 *
 * smokeRule + RuleTester behavioural cases.
 *
 * Pins:
 *   - fires on a string Literal equal to a legacy parameter id renamed by S2
 *     (e.g. `"abstract_vs_concrete"`, `"B5-A"`, `"COMP-ENERGY"`)
 *   - does NOT fire on a canonical BEH-* id
 *   - does NOT fire on an unrelated string literal
 *   - does NOT fire inside `lib/registry/` (the resolver's data file)
 *   - does NOT fire inside `prisma/migrations/` (historical migrations)
 *   - does NOT fire inside `docs/` (rename map + dedup docs)
 *   - does NOT fire inside `tests/` or test files (fixtures intentionally
 *     exercise legacy ids to verify the alias fallback)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-parameter-id.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-parameter-id", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-parameter-id", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const LIB = "/repo/apps/admin/lib/wizard/apply-projection.ts";
const SCRIPT = "/repo/apps/admin/scripts/some-script.ts";
const RESOLVER = "/repo/apps/admin/lib/registry/resolve.ts";
const MIGRATION = "/repo/apps/admin/prisma/migrations/20260618170000_rename/migration.sql.ts";
const DOC = "/repo/docs/PARAMETER-RENAME-MAP.md.ts";
const TEST = "/repo/apps/admin/tests/lib/wizard/apply-projection.test.ts";
const TESTS_DIR_TEST = "/repo/apps/admin/__tests__/projection.test.ts";

tester.run("no-bare-parameter-id", rule as never, {
  valid: [
    // Canonical BEH-* ids in runtime code.
    { filename: LIB, code: `const id = "BEH-ABSTRACT-VS-CONCRETE";` },
    { filename: LIB, code: `const id = "BEH-WARMTH";` },
    { filename: LIB, code: `const id = "BEH-B5-A";` },
    // Unrelated string literals.
    { filename: LIB, code: `const x = "abstract_vs_concrete_thinking";` }, // contains legacy but isn't exact
    { filename: LIB, code: `const x = "warmth";` },
    // Allow-listed paths — resolver, migrations, docs, tests.
    { filename: RESOLVER, code: `const id = "abstract-vs-concrete";` },
    { filename: MIGRATION, code: `const id = "abstract-vs-concrete";` },
    { filename: DOC, code: `const id = "abstract-vs-concrete";` },
    { filename: TEST, code: `const id = "abstract-vs-concrete";` },
    { filename: TESTS_DIR_TEST, code: `const id = "B5-A";` },
    // Non-string literal — passes (rule guards on `typeof === "string"`).
    { filename: LIB, code: `const id = 42;` },
    // String literal that's NOT in the legacy set — passes.
    { filename: LIB, code: `const id = "totally-unknown-param";` },
  ],
  invalid: [
    {
      // `abstract-vs-concrete` is in LEGACY_PARAMETER_IDS (kebab form
      // pre-rename; snake_case never existed in the registry).
      filename: LIB,
      code: `const id = "abstract-vs-concrete";`,
      errors: [{ messageId: "bareLegacy" }],
    },
    {
      filename: LIB,
      code: `const id = "B5-A";`,
      errors: [{ messageId: "bareLegacy" }],
    },
    {
      filename: LIB,
      code: `const id = "COMP-ENERGY";`,
      errors: [{ messageId: "bareLegacy" }],
    },
    {
      filename: SCRIPT,
      // Wrap in function so `return` parses.
      code: `function f(p) { if (p.id === "CONV_DOM") return; }`,
      errors: [{ messageId: "bareLegacy" }],
    },
    {
      filename: LIB,
      code: `const id = "welcome_quality";`,
      errors: [{ messageId: "bareLegacy" }],
    },
  ],
});
