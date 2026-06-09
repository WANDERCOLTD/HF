/**
 * Tests for `eslint-rules/no-hardcoded-greeting-in-composition.mjs`
 * (#1384 / #1385). Pins:
 *   - rule fires on literal + template greeting in guarded paths
 *   - rule covers all three guarded path fragments (transforms/,
 *     build-assistant-config.ts, route-handlers.ts)
 *   - rule does NOT fire under `lib/prompt/composition/defaults/`
 *     (the allow-listed system-default template home)
 *   - rule does NOT fire on identifier-referenced greeting (i.e. the
 *     post-rollback shape where literals are imported from defaults/)
 *   - rule covers all six ASSIGNMENT_TARGETS (first_line, firstLine,
 *     firstMessage, voicePrompt, openingLine, greeting)
 *   - rule fires in Property positions (object-literal config payloads)
 *     in addition to VariableDeclarator / AssignmentExpression /
 *     ReturnStatement
 *
 * Uses ESLint's RuleTester with synthetic file paths matching the
 * guarded + allow-listed path fragments so the rule's `isGuardedFile`
 * helper picks them up.
 */

import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-hardcoded-greeting-in-composition.mjs";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Synthetic paths under each guarded + allow-listed fragment.
const GUARDED_TRANSFORM = "/repo/lib/prompt/composition/transforms/quickstart.ts";
const GUARDED_BUILDER = "/repo/lib/voice/build-assistant-config.ts";
const GUARDED_ROUTE_HANDLER = "/repo/lib/voice/route-handlers.ts";
const ALLOWED_DEFAULTS =
  "/repo/lib/prompt/composition/defaults/fallback-first-lines.ts";
const UNGUARDED_OTHER = "/repo/lib/voice/some-other-file.ts";

tester.run("no-hardcoded-greeting-in-composition", rule as never, {
  valid: [
    // Identifier reference (the post-rollback shape — literal lives in
    // defaults/, imported by name) — pass through in guarded paths.
    {
      filename: GUARDED_BUILDER,
      code: `
        import { UNKNOWN_CALLER_FIRST_LINE } from "@/lib/prompt/composition/defaults/fallback-first-lines";
        const x = { firstLine: UNKNOWN_CALLER_FIRST_LINE };
      `,
    },
    // Function-call reference (interpolated helper from defaults/).
    {
      filename: GUARDED_BUILDER,
      code: `
        import { noActivePromptFirstLine } from "@/lib/prompt/composition/defaults/fallback-first-lines";
        const x = { firstLine: noActivePromptFirstLine("Peter") };
      `,
    },
    // Non-greeting literal in guarded path — pass through.
    {
      filename: GUARDED_TRANSFORM,
      code: `const firstLine = "We're going to be working on this together.";`,
    },
    // Greeting literal under defaults/ (allow-listed home) — pass through.
    {
      filename: ALLOWED_DEFAULTS,
      code: `export const UNKNOWN_CALLER_FIRST_LINE = "Hello! What's your name?";`,
    },
    // Greeting literal in an UNGUARDED path — pass through.
    // (The rule only fires inside `GUARDED_PATH_FRAGMENTS`.)
    {
      filename: UNGUARDED_OTHER,
      code: `const firstLine = "Hi there! Good to hear from you.";`,
    },
    // Non-greeting object property in a guarded path — pass through.
    {
      filename: GUARDED_BUILDER,
      code: `const x = { voicePrompt: "You are a tutor. Stay on topic." };`,
    },
  ],
  invalid: [
    // ────────────────────────────────────────────────────────────────────
    // Guard scope #1 — transforms/
    // ────────────────────────────────────────────────────────────────────
    {
      filename: GUARDED_TRANSFORM,
      code: 'function f() { return "Hi there! Let\'s get into it."; }',
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_TRANSFORM,
      code: "function f(name) { return `Welcome back ${name}!`; }",
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_TRANSFORM,
      code: 'function f() { return "Good morning! What\'s on your mind?"; }',
      errors: [{ messageId: "hardcoded" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #2 — build-assistant-config.ts
    // ────────────────────────────────────────────────────────────────────
    {
      filename: GUARDED_BUILDER,
      code: 'const x = { firstLine: "Hello! What is your name?" };',
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_BUILDER,
      code: "const x = { first_line: `Hi ${name}!` };",
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_BUILDER,
      code: 'const firstMessage = "Hey there! Good to meet you.";',
      errors: [{ messageId: "hardcoded" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #3 — route-handlers.ts (TL-added in #1385)
    // ────────────────────────────────────────────────────────────────────
    {
      filename: GUARDED_ROUTE_HANDLER,
      code: 'const x = { firstLine: "Hello, friend! Welcome aboard." };',
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_ROUTE_HANDLER,
      code: "const x = { firstLine: `Welcome back ${user.name}!` };",
      errors: [{ messageId: "hardcoded" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // All ASSIGNMENT_TARGETS keys — Property + VariableDeclarator paths
    // ────────────────────────────────────────────────────────────────────
    {
      filename: GUARDED_BUILDER,
      code: 'const x = { openingLine: "Hi there." };',
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_BUILDER,
      code: 'const x = { greeting: "Hello, learner." };',
      errors: [{ messageId: "hardcoded" }],
    },
    {
      filename: GUARDED_BUILDER,
      code: 'const voicePrompt = "Welcome! Let\'s begin.";',
      errors: [{ messageId: "hardcoded" }],
    },
  ],
});
