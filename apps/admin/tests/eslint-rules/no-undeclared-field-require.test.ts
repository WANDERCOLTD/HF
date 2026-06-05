/**
 * Tests for eslint-rules/no-undeclared-field-require.mjs (#1078).
 *
 * Pins the rule contract: `has('typo')` inside a `defineCrawcusSpec` block
 * fires when the referenced field is not declared. Bare `.has()` outside
 * a spec is ignored. Both destructured and method-call shapes match.
 */

import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-undeclared-field-require.mjs";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-undeclared-field-require", rule as never, {
  valid: [
    // Declared key — passes.
    {
      code: `
        defineCrawcusSpec({
          fields: {
            title: field.string(),
            servings: field.integer().dependsOn({
              when: (ctx) => ctx.has('title'),
            }),
          },
        });
      `,
    },
    // Destructured ctx with declared keys — passes.
    {
      code: `
        defineCrawcusSpec({
          fields: {
            a: field.string(),
            b: field.string(),
          },
          readiness: ({ has }) => has('a', 'b'),
        });
      `,
    },
    // `.has()` outside any spec — rule does not fire.
    {
      code: `
        const set = new Set(['x']);
        if (set.has('y')) { console.log('hi'); }
      `,
    },
    // Empty fields block — rule short-circuits (can't validate).
    {
      code: `
        defineCrawcusSpec({
          fields: {},
          readiness: ({ has }) => has('anything'),
        });
      `,
    },
  ],
  invalid: [
    // Typo in dependsOn.
    {
      code: `
        defineCrawcusSpec({
          fields: {
            title: field.string(),
            servings: field.integer().dependsOn({
              when: (ctx) => ctx.has('titel'),
            }),
          },
        });
      `,
      errors: [
        {
          messageId: "undeclaredField",
        },
      ],
    },
    // Typo in readiness (destructured form).
    {
      code: `
        defineCrawcusSpec({
          fields: { title: field.string(), servings: field.integer() },
          readiness: ({ has }) => has('titel', 'servings'),
        });
      `,
      errors: [
        {
          messageId: "undeclaredField",
        },
      ],
    },
    // Multiple typos reported as multiple errors.
    {
      code: `
        defineCrawcusSpec({
          fields: { a: field.string() },
          readiness: ({ has }) => has('x', 'y'),
        });
      `,
      errors: [{ messageId: "undeclaredField" }, { messageId: "undeclaredField" }],
    },
  ],
});
