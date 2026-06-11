/**
 * Shared helpers for custom-ESLint-rule tests.
 *
 * Every rule under `apps/admin/eslint-rules/` gets a sibling
 * `apps/admin/tests/eslint-rules/<rule>.test.ts`. The minimum bar:
 *
 *   - **smokeRule()** — asserts the rule has the structural pieces that the
 *     KB and the build depend on: `meta.docs.url` pointing at guard-registry,
 *     a `messages` object, and a `create()` that returns AST visitors.
 *
 *   - **RuleTester** (`eslint`-builtin) — runs at least one valid + one
 *     invalid example through the real ESLint parser so the rule's logic
 *     is exercised, not just its shape.
 *
 * The shape check is what the `check-eslint-rule-tests.ts` meta-ratchet
 * (under `apps/admin/scripts/capture/`) relies on. If a rule's
 * `meta.docs.url` is silently dropped, smokeRule fires.
 *
 * Why both: the structural checks are cheap and catch the "guard lost its
 * KB link" failure mode that the existing `check-guard-kb-links.ts`
 * meta-ratchet also catches — defence in depth.
 *
 * HF-F (2026-06-11): smoke + behavioural checks now both live in the same
 * file per rule under `apps/admin/tests/eslint-rules/`. The previous layout
 * had the smoke files at REPO-ROOT `tests/eslint-rules/`, which weren't
 * picked up by the apps/admin-rooted vitest runner — they existed for the
 * ratchet but never actually ran. The collapse means existence-checked ===
 * actually-run, closing the systemic gap noted in commit 0881b3ed.
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

// Probe filenames for create() in smokeRule. Path-scoped rules early-return `{}`
// for filenames outside their guarded fragments; probing a union of typical
// guarded paths means "the rule returns visitors for AT LEAST ONE plausible
// filename", which preserves the smokeRule intent (the rule CAN report) without
// hardcoding rule-specific paths into the helper.
//
// Add a fragment when a new rule lands whose guarded path is not yet represented.
const PROBE_FILENAMES = [
  "/repo/apps/admin/lib/chat/admin-tools.ts",                        // no-ai-forbidden-fields
  "/repo/apps/admin/lib/chat/wizard-tool-executor.ts",               // no-ai-fanout-all
  "/repo/apps/admin/lib/chat/conversational-wizard-tools.ts",        // no-ai-fanout-all (alt)
  "/repo/apps/admin/lib/chat/admin-tool-handlers.ts",                // no-ai-fanout-all (alt)
  "/repo/apps/admin/app/api/chat/route.ts",                          // no-ai-fanout-all (alt)
  "/repo/apps/admin/lib/prompt/composition/transforms/quickstart.ts", // no-hardcoded-greeting / no-orphan-instruction-fallback
  "/repo/apps/admin/app/api/intake/bootstrap/route.ts",              // no-ops-import-from-api
  "/repo/apps/admin/lib/voice/route-handlers.ts",                    // no-hardcoded-greeting (alt)
  "/repo/apps/admin/lib/voice/build-assistant-config.ts",            // no-hardcoded-greeting (alt)
  "/repo/apps/admin/lib/something-new.ts",                           // generic catch-all
  "/dev/null",                                                       // legacy probe
];

function probeVisitors(rule: Rule, name: string): number {
  let maxCount = 0;
  for (const filename of PROBE_FILENAMES) {
    const visitors = rule.create({
      report: () => {},
      getFilename: () => filename,
      filename,
      getSourceCode: () => ({ getScope: () => ({}) }),
      sourceCode: { getScope: () => ({}) },
      options: [],
      settings: {},
      parserPath: "",
      parserOptions: {},
      parserServices: {},
      id: name,
    } as never);
    const count = Object.keys(visitors).length;
    if (count > maxCount) maxCount = count;
  }
  return maxCount;
}

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

  // 4. create() must return at least one visitor for at least one plausible
  // guarded path (path-scoped rules early-return `{}` for files outside their
  // guarded fragments — see PROBE_FILENAMES above).
  expect(
    probeVisitors(rule, name),
    `${name}: create() must return at least one AST visitor for some guarded filename`,
  ).toBeGreaterThan(0);
}
