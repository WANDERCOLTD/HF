/**
 * Tests for `eslint-rules/composition-directive-needs-renderer.mjs`.
 *
 * Pins:
 *   - Rule fires on `directive: "…"` literal in transforms/*.ts WITHOUT
 *     the sentinel comment.
 *   - Rule does NOT fire when the sentinel comment is present anywhere
 *     in the file (Line OR Block comment form).
 *   - Rule does NOT fire on files outside `lib/prompt/composition/transforms/`.
 *   - Rule does NOT fire when the value isn't a string literal /
 *     template literal (e.g. function call return).
 *   - Rule emits ONE message per file even when multiple `directive`
 *     fields exist (the sentinel is file-level).
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/composition-directive-needs-renderer.mjs";
import { smokeRule } from "./_helpers.js";

describe("composition-directive-needs-renderer", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("composition-directive-needs-renderer", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const TRANSFORM_PATH = "/repo/lib/prompt/composition/transforms/instructions.ts";
const NON_TRANSFORM_PATH = "/repo/lib/voice/types.ts";

tester.run("composition-directive-needs-renderer", rule as never, {
  valid: [
    // Sentinel present (Line comment) — directive field allowed.
    {
      filename: TRANSFORM_PATH,
      code: `
        // @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
        export function f() {
          return {
            module_cue_card: { directive: "speak this" },
          };
        }
      `,
    },
    // Sentinel present (Block comment / JSDoc) — directive allowed.
    {
      filename: TRANSFORM_PATH,
      code: `
        /**
         * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
         */
        export function f() {
          return { x: { directive: "..." } };
        }
      `,
    },
    // Multiple directives + sentinel → still valid.
    {
      filename: TRANSFORM_PATH,
      code: `
        // @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
        export function f() {
          return {
            a: { directive: "x" },
            b: { directive: "y" },
            c: { directive: "z" },
          };
        }
      `,
    },
    // File outside transforms/ — rule never applies.
    {
      filename: NON_TRANSFORM_PATH,
      code: `
        export const x = { directive: "anything" };
      `,
    },
    // `directive` value isn't a string literal — rule doesn't trip.
    {
      filename: TRANSFORM_PATH,
      code: `
        export function f() {
          return { x: { directive: someFunction() } };
        }
      `,
    },
    // Property key isn't `directive` — rule doesn't trip.
    {
      filename: TRANSFORM_PATH,
      code: `
        export function f() {
          return { x: { not_a_directive: "hello" } };
        }
      `,
    },
    // Template literal value WITH sentinel — allowed.
    {
      filename: TRANSFORM_PATH,
      code: `
        // @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
        export function f() {
          const x = "topic";
          return { y: { directive: \`speak about \${x}\` } };
        }
      `,
    },
  ],
  invalid: [
    // Directive string literal WITHOUT sentinel — error.
    {
      filename: TRANSFORM_PATH,
      code: `
        export function f() {
          return { module_cue_card: { directive: "speak this" } };
        }
      `,
      errors: [{ messageId: "noSentinel" }],
    },
    // Template literal directive WITHOUT sentinel — error.
    {
      filename: TRANSFORM_PATH,
      code: `
        export function f() {
          const x = "topic";
          return { y: { directive: \`speak \${x}\` } };
        }
      `,
      errors: [{ messageId: "noSentinel" }],
    },
    // Multiple directives WITHOUT sentinel — ONE error (file-level fix).
    {
      filename: TRANSFORM_PATH,
      code: `
        export function f() {
          return {
            a: { directive: "x" },
            b: { directive: "y" },
            c: { directive: "z" },
          };
        }
      `,
      errors: [{ messageId: "noSentinel" }],
    },
  ],
});
