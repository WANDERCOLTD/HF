/**
 * Behavioural + structural tests for
 * `eslint-rules/no-course-specific-measure-query.mjs` (story #2183).
 *
 * Pins:
 *   - fires on `slug: { startsWith: "IELTS-MEASURE-" }` Prisma filters inside
 *     `app/api/calls/` + `lib/pipeline/` + `lib/measurement/`
 *   - fires on `.startsWith("IELTS-")` / `.includes("CEFR-")` literal string-
 *     method calls in the same surfaces
 *   - does NOT fire in `lib/config.ts` (the env-overridable prefix lives there)
 *   - does NOT fire in tests / scripts / prisma seed
 *   - does NOT fire on lowercase / non-prefix-shaped literals
 *   - does NOT fire when a config.specs.* member access is the argument
 *   - HONOURS the per-site escape comment
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-course-specific-measure-query.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-course-specific-measure-query", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-course-specific-measure-query", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Guarded surfaces — the rule fires here.
const PIPELINE_ROUTE =
  "/repo/apps/admin/app/api/calls/[callId]/pipeline/route.ts";
const SPECS_LOADER = "/repo/apps/admin/lib/pipeline/specs-loader.ts";
const MEASUREMENT = "/repo/apps/admin/lib/measurement/some-helper.ts";

// Unguarded surfaces — the rule never fires here.
const CONFIG = "/repo/apps/admin/lib/config.ts";
const TEST = "/repo/apps/admin/tests/lib/foo.test.ts";
const SEED = "/repo/apps/admin/prisma/seed-from-specs.ts";
const VOICE = "/repo/apps/admin/lib/voice/route-handlers.ts";

tester.run("no-course-specific-measure-query", rule as never, {
  valid: [
    // Course-agnostic Prisma filter — the canonical pattern.
    {
      filename: PIPELINE_ROUTE,
      code: `await prisma.analysisSpec.findMany({ where: { id: { in: ids }, outputType: "MEASURE" } });`,
    },
    // config.specs.* identifier passed to startsWith — config-driven, OK.
    {
      filename: SPECS_LOADER,
      code: `if (spec.slug.startsWith(config.specs.ieltsMeasurePrefix)) { }`,
    },
    // Lowercase / non-prefix shape.
    {
      filename: SPECS_LOADER,
      code: `if (spec.slug.startsWith("ielts-")) { }`,
    },
    // Two-letter prefix — too short for COURSE_PREFIX_RE.
    {
      filename: SPECS_LOADER,
      code: `if (spec.slug.startsWith("KS-")) { }`,
    },
    // Bare-CAPS form — Parameter ids (`WARMTH`, `DIRECT`, `EMPATHY`)
    // and aggregator keys are deliberately NOT matched. The rule
    // requires a trailing [-_] separator to flag "this is a dispatch
    // family prefix" — not "this is data".
    {
      filename: SPECS_LOADER,
      code: `if (spec.parameters.some(p => p.id.includes("WARMTH"))) { }`,
    },
    {
      filename: SPECS_LOADER,
      code: `const where = { name: { contains: "MVP-BEH" } };`,
    },
    // Complete spec slug — covered by hf-config/no-hardcoded-spec-slug
    // (the sibling rule), not this one.
    {
      filename: SPECS_LOADER,
      code: `const where = { slug: { startsWith: "IELTS-MEASURE-001" } };`,
    },
    // Inside lib/config.ts — prefixes legitimately live here.
    {
      filename: CONFIG,
      code: `const PREFIX = "IELTS-MEASURE-";`,
    },
    // Inside lib/config.ts — Prisma filter shape allowed here too.
    {
      filename: CONFIG,
      code: `const filter = { slug: { startsWith: "IELTS-MEASURE-" } };`,
    },
    // Inside a test file.
    {
      filename: TEST,
      code: `expect(spec.slug.startsWith("IELTS-MEASURE-")).toBe(true);`,
    },
    // Inside a seed script.
    {
      filename: SEED,
      code: `await prisma.analysisSpec.create({ data: { slug: "IELTS-MEASURE-001" } });`,
    },
    // Inside lib/voice — outside the guarded path-set.
    {
      filename: VOICE,
      code: `if (provider.kind.startsWith("VAPI-")) { }`,
    },
    // Per-site escape comment honoured.
    {
      filename: SPECS_LOADER,
      code: `
// hf-pipeline-disable-next-line no-course-specific-measure-query: per-Playbook kill-switch override #2158
if (spec.slug.startsWith("IELTS-MEASURE-")) { }
`,
    },
    // Non-string-method call with a course-prefix literal — unrelated.
    {
      filename: SPECS_LOADER,
      code: `log.info("IELTS-MEASURE- log line context");`,
    },
  ],
  invalid: [
    // Prisma filter literal — the original story-cited fingerprint.
    {
      filename: PIPELINE_ROUTE,
      code: `await prisma.analysisSpec.findMany({ where: { id: { in: ids }, slug: { startsWith: "IELTS-MEASURE-" } } });`,
      errors: [{ messageId: "prismaFilter" }],
    },
    // Contains-filter variant with separator tail.
    {
      filename: MEASUREMENT,
      code: `const where = { name: { contains: "IELTS-" } };`,
      errors: [{ messageId: "prismaFilter" }],
    },
    // endsWith variant.
    {
      filename: SPECS_LOADER,
      code: `const where = { slug: { endsWith: "TOEFL-MEASURE-" } };`,
      errors: [{ messageId: "prismaFilter" }],
    },
    // String-method dispatch — the actually-present incumbent.
    {
      filename: SPECS_LOADER,
      code: `if (spec.slug.startsWith("IELTS-MEASURE-")) { }`,
      errors: [{ messageId: "stringMethod" }],
    },
    // String-method dispatch with .includes.
    {
      filename: MEASUREMENT,
      code: `if (spec.name.includes("CEFR-")) { }`,
      errors: [{ messageId: "stringMethod" }],
    },
  ],
});
