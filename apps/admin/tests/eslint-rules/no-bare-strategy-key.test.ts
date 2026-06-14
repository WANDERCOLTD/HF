/**
 * Behavioral + structural tests for `eslint-rules/no-bare-strategy-key.mjs` — #1599.
 *
 * smokeRule + RuleTester behavioural cases.
 *
 * Pins:
 *   - fires on `progressStrategy: "LO_MASTERY"` (the #1554 fingerprint)
 *   - fires on any other non-enum string literal
 *   - does NOT fire on `progressStrategy: "lo_rollup"` (or any other valid enum member)
 *   - does NOT fire in `lib/goals/strategies/registry.ts` (the alias map carries
 *     historical keys like `lo_mastery` as MAP keys, not property values)
 *   - does NOT fire in test files / `__tests__/`
 *   - does NOT fire on non-Literal values (identifier, member-expression)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-strategy-key.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-strategy-key", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-strategy-key", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const LIB = "/repo/apps/admin/lib/goals/strategies/lo_rollup.ts";
const SCRIPT = "/repo/apps/admin/scripts/fix-cio-cto-playbooks.ts";
const REGISTRY = "/repo/apps/admin/lib/goals/strategies/registry.ts";
const TEST = "/repo/apps/admin/tests/lib/goals-track-progress.test.ts";
const TESTS_DIR_TEST = "/repo/apps/admin/__tests__/goals.test.ts";

tester.run("no-bare-strategy-key", rule as never, {
  valid: [
    // Valid canonical enum members in runtime code.
    { filename: LIB, code: `const g = { progressStrategy: "lo_rollup" };` },
    { filename: LIB, code: `const g = { progressStrategy: "skill_ema" };` },
    { filename: SCRIPT, code: `const g = { progressStrategy: "manual_only" };` },
    // Reference via StrategyKey.<member> — the canonical write shape.
    {
      filename: SCRIPT,
      code: `const g = { progressStrategy: StrategyKey.lo_rollup };`,
    },
    // The registry — alias map carries historical keys as MAP keys, not as
    // property values. Note: the rule key-checks for property name
    // `progressStrategy` specifically, so unrelated keys like the alias map
    // never trip it. We test the explicit allow-list path with a property
    // shape that WOULD trigger if the rule weren't allow-listing.
    {
      filename: REGISTRY,
      code: `const x = { progressStrategy: "LO_MASTERY" };`,
    },
    // Test files — fixtures intentionally exercise edge-case casings.
    {
      filename: TEST,
      code: `const g = { progressStrategy: "LO_MASTERY" };`,
    },
    {
      filename: TESTS_DIR_TEST,
      code: `const g = { progressStrategy: "GARBAGE_KEY" };`,
    },
    // Non-Literal value — passes (identifier route).
    {
      filename: LIB,
      code: `const k = "lo_rollup"; const g = { progressStrategy: k };`,
    },
    // Member expression — passes (the canonical write shape).
    {
      filename: LIB,
      code: `const g = { progressStrategy: StrategyKey.lo_rollup };`,
    },
    // Unrelated property — passes.
    { filename: LIB, code: `const g = { someOtherKey: "LO_MASTERY" };` },
  ],
  invalid: [
    {
      filename: LIB,
      code: `const g = { progressStrategy: "LO_MASTERY" };`,
      errors: [{ messageId: "bareLiteral" }],
    },
    {
      filename: SCRIPT,
      code: `const g = { progressStrategy: "lo_mastery" };`,
      errors: [{ messageId: "bareLiteral" }],
    },
    {
      filename: SCRIPT,
      code: `const g = { progressStrategy: "GARBAGE_KEY" };`,
      errors: [{ messageId: "bareLiteral" }],
    },
    // String-form property key.
    {
      filename: LIB,
      code: `const g = { "progressStrategy": "LO_MASTERY" };`,
      errors: [{ messageId: "bareLiteral" }],
    },
  ],
});
