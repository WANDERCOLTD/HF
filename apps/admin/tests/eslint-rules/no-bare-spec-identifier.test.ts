/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bare-spec-identifier.mjs` — #2182.
 *
 * The rule blocks bare spec-identifier string literals outside the
 * explicit allow-list. Two shapes:
 *   1. `ContractRegistry.getContract("LITERAL")` — direct call form
 *   2. `[A-Z_-]+_(V\d+|SPEC|ID)`-shaped string values in const Property
 *      declarations or VariableDeclarators (the const-map form, e.g.
 *      `PROSODY: "PROSODY-SCORE-V1"`).
 *
 * Born of the 2026-06-21 hardcoding audit. The 3 incumbent offenders
 * (`lib/pipeline/aggregate-runner.ts:184`, `lib/goals/track-progress.ts:132`,
 * `lib/measurement/write-call-score.ts:174`) are repaired in the same PR
 * (#2182) — clean sweep, `error` from day 1.
 *
 * Pins:
 *   - fires on bare `ContractRegistry.getContract("SKILL_MEASURE_V1")`
 *     in runtime lib code
 *   - fires on the const-map shape `PROSODY: "PROSODY-SCORE-V1"` in
 *     runtime lib code
 *   - fires on a top-level `const FOO = "MOCK-MEASURE-V1"`
 *   - does NOT fire when the read goes through `config.specs.*`
 *   - does NOT fire in `lib/config.ts` (the canonical home)
 *   - does NOT fire in `lib/registry/`
 *   - does NOT fire in seed scripts / migrations
 *   - does NOT fire in /tests/
 *   - does NOT fire on non-matching string literals (lowercase, slug shape)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-spec-identifier.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-spec-identifier", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-spec-identifier", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Runtime files that MUST trigger the rule when bare-using a spec identifier.
const RUNTIME_BAD_PIPELINE = "/repo/apps/admin/lib/pipeline/aggregate-runner.ts";
const RUNTIME_BAD_GOALS = "/repo/apps/admin/lib/goals/track-progress.ts";
const RUNTIME_BAD_MEASUREMENT = "/repo/apps/admin/lib/measurement/write-call-score.ts";
const RUNTIME_BAD_GENERIC = "/repo/apps/admin/lib/some-new-runtime.ts";

// Allow-listed file paths.
const CONFIG_FILE = "/repo/apps/admin/lib/config.ts";
const REGISTRY_DIR = "/repo/apps/admin/lib/registry/index.ts";
const SEED_SCRIPT = "/repo/apps/admin/prisma/seed-measurement-sentinels.ts";
const MIGRATION_FILE = "/repo/apps/admin/prisma/migrations/20260620_foo/migration.sql.ts";
const GENERATE_REGISTRY = "/repo/apps/admin/scripts/generate-registry.ts";
const TEST_FILE = "/repo/apps/admin/tests/lib/measurement/write-call-score.test.ts";

tester.run("no-bare-spec-identifier", rule as never, {
  valid: [
    // Allow-listed: lib/config.ts itself — identifiers LIVE here.
    {
      filename: CONFIG_FILE,
      code: `const v = optional("SKILL_MEASURE_V1_CONTRACT_ID", "SKILL_MEASURE_V1");`,
    },
    // Allow-listed: lib/registry/.
    {
      filename: REGISTRY_DIR,
      code: `export const SKILL_MEASURE_V1 = "SKILL_MEASURE_V1";`,
    },
    // Allow-listed: seed script.
    {
      filename: SEED_SCRIPT,
      code: `const id = "PROSODY-SCORE-V1";`,
    },
    // Allow-listed: prisma migrations.
    {
      filename: MIGRATION_FILE,
      code: `const slug = "SKILL_MEASURE_V1";`,
    },
    // Allow-listed: generator script.
    {
      filename: GENERATE_REGISTRY,
      code: `const id = "PROSODY-SCORE-V1";`,
    },
    // Allow-listed: tests.
    {
      filename: TEST_FILE,
      code: `expect(rows[0].analysisSpecId).toBe("PROSODY-SCORE-V1");`,
    },
    // Canonical read via config.specs.* — passes in any runtime file.
    {
      filename: RUNTIME_BAD_PIPELINE,
      code: `const contract = await ContractRegistry.getContract(config.specs.skillMeasureV1);`,
    },
    {
      filename: RUNTIME_BAD_MEASUREMENT,
      code: `export const SENTINELS = { PROSODY: config.specs.prosodyScoreV1 };`,
    },
    // Non-matching string literals — lowercase / mixed-case / slug shape.
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const key = "lo_rollup";`,
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const key = "PIPELINE-001";`, // slug shape — guarded by sibling rule
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const key = "SKILL_MEASURE";`, // no version suffix
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const key = "skill_measure_v1";`, // lowercase
    },
    // Feature-flag prefix exclusion — env-var convention.
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const flag = "HF_FLAG_SESSION_MODEL_V2";`,
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const flag = "HF_IELTS_LLM_MEASURE_V1";`,
    },
    // _SPEC / _ID suffixes — too broad; not enforced.
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const x = { ID: "WELCOME_SPEC" };`,
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const x = { ID: "GOAL_PROGRESS_ID" };`,
    },
    // ContractRegistry.getContract with a variable, not a literal — passes.
    {
      filename: RUNTIME_BAD_PIPELINE,
      code: `const contract = await ContractRegistry.getContract(someVariable);`,
    },
    // A method call on something else named `getContract` — does NOT match.
    {
      filename: RUNTIME_BAD_PIPELINE,
      code: `const x = await someOtherRegistry.getContract("SKILL_MEASURE_V1");`,
      // NOTE: this still trips the shape detector below at top-level
      // VariableDeclarator. Wrap in a function to make the test focus
      // on the ContractRegistry receiver check.
      // Actually — `"SKILL_MEASURE_V1"` here is inside a CallExpression,
      // not a Literal initialiser, so it shouldn't fire. Confirmed:
      // the VariableDeclarator visitor only fires when node.init IS the
      // Literal, not when it CONTAINS one.
    },
  ],
  invalid: [
    // The 3 incumbent offenders being repaired.
    {
      filename: RUNTIME_BAD_PIPELINE,
      code: `const contract = await ContractRegistry.getContract("SKILL_MEASURE_V1");`,
      errors: [{ messageId: "bareContractGet" }],
    },
    {
      filename: RUNTIME_BAD_GOALS,
      code: `const contract = await ContractRegistry.getContract("SKILL_MEASURE_V1");`,
      errors: [{ messageId: "bareContractGet" }],
    },
    // Const-map shape — the PROSODY entry in write-call-score.ts.
    {
      filename: RUNTIME_BAD_MEASUREMENT,
      code: `export const SENTINELS = { PROSODY: "PROSODY-SCORE-V1" };`,
      errors: [{ messageId: "bareIdentifierShape" }],
    },
    // Top-level VariableDeclarator with shape-matching value.
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const FOO = "MOCK-MEASURE-V1";`,
      errors: [{ messageId: "bareIdentifierShape" }],
    },
    // Various shape examples that should fire.
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const x = { K: "ADAPT-DELTA-V1" };`,
      errors: [{ messageId: "bareIdentifierShape" }],
    },
    {
      filename: RUNTIME_BAD_GENERIC,
      code: `const x = { K: "ENTITY_ACCESS_V1" };`,
      errors: [{ messageId: "bareIdentifierShape" }],
    },
    // ContractRegistry call from a previously-clean directory.
    {
      filename: "/repo/apps/admin/lib/curriculum/some-new-helper.ts",
      code: `const c = await ContractRegistry.getContract("FOO_BAR");`,
      errors: [{ messageId: "bareContractGet" }],
    },
  ],
});
