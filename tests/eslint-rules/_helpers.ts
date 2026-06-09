/**
 * Shared helpers for custom-ESLint-rule tests.
 *
 * Every rule under `apps/admin/eslint-rules/` gets a sibling
 * `tests/eslint-rules/<rule>.test.ts`. The minimum bar:
 *
 *   - **smokeRule()** — asserts the rule has the structural pieces that the
 *     KB and the build depend on: `meta.docs.url` pointing at guard-registry,
 *     a `messages` object, and a `create()` that returns AST visitors.
 *
 *   - **RuleTester** (`eslint`-builtin) — runs at least one valid + one
 *     invalid example through the real ESLint parser so the rule's logic
 *     is exercised, not just its shape.
 *
 * The shape check is what the `check-eslint-rule-tests.sh` meta-ratchet
 * relies on. If a rule's `meta.docs.url` is silently dropped, this fires.
 *
 * Why both: the structural checks are cheap and catch the "guard lost its
 * KB link" failure mode that the existing `check-guard-kb-links.ts`
 * meta-ratchet also catches — defence in depth.
 */
import { expect } from "vitest";

const KB_NEEDLE = "docs/kb/guard-registry.md#guard-";

export type Rule = {
  meta?: {
    type?: string;
    docs?: { description?: string; url?: string };
    schema?: unknown;
    messages?: Record<string, string>;
  };
  create: (context: unknown) => Record<string, unknown>;
};

/**
 * Asserts the structural pieces every HF rule must have.
 * Call from one `it(...)` inside the rule's sibling test file.
 */
export function smokeRule(name: string, rule: Rule) {
  // 1. Must be a `problem`-type rule (HF convention).
  expect(rule.meta?.type, `${name}: meta.type missing`).toBeDefined();

  // 2. Must carry a KB back-link to the guard registry.
  expect(
    rule.meta?.docs?.url,
    `${name}: meta.docs.url missing (KB back-link)`,
  ).toBeTruthy();
  expect(
    rule.meta?.docs?.url,
    `${name}: meta.docs.url must point at docs/kb/guard-registry.md#guard-<name>`,
  ).toContain(KB_NEEDLE);

  // 3. Must define at least one message.
  expect(
    Object.keys(rule.meta?.messages ?? {}).length,
    `${name}: meta.messages must contain at least one message`,
  ).toBeGreaterThan(0);

  // 4. create() must return at least one visitor.
  const visitors = rule.create({
    report: () => {},
    getFilename: () => "/dev/null",
    getSourceCode: () => ({ getScope: () => ({}) }),
    options: [],
    settings: {},
    parserPath: "",
    parserOptions: {},
    parserServices: {},
    id: name,
  } as never);
  expect(
    Object.keys(visitors).length,
    `${name}: create() must return at least one AST visitor`,
  ).toBeGreaterThan(0);
}
