/**
 * Behavioural + structural tests for
 * `eslint-rules/no-customer-write-to-canonical-interpretation.mjs` —
 * epic #1984 S1 + #2174 S5 defensive extension.
 *
 * The rule blocks customer-driven writes to spec-readonly
 * `Parameter` fields. Original three (#1984 S1):
 * `definition`, `interpretationHigh`, `interpretationLow`.
 * Defensive extension (#2174 S5, 2026-06-21):
 * `tiers`, `tierScheme`, `defaultTarget`, `config` — grading-rubric
 * fields classified HF-canonical by the #2174 epic audit
 * (docs/SCORING-EDITABILITY.md). Spec fields are HF-canonical IP —
 * only seeds, the registry generator, and migrations may write them.
 *
 * Pairs with the declarative boundary at
 * `lib/cascade/spec-readonly-fields.ts` (S4 PR #1979, extended #2174 S5)
 * and the coverage test at
 * `tests/lib/cascade/spec-readonly-fields-coverage.test.ts` (#1984 S2)
 * which pins constant ↔ rule pairing.
 *
 * Pins:
 *   - fires on `prisma.parameter.create({ data: { definition: ... } })`
 *   - fires on `prisma.parameter.update({ data: { interpretationHigh: ... } })`
 *   - fires on `prisma.parameter.upsert({ create: { ... }, update: { ... } })`
 *     in either branch
 *   - fires on the 4 #2174 S5 fields (`tiers`, `tierScheme`,
 *     `defaultTarget`, `config`) from customer-driven paths
 *   - does NOT fire in seed paths (`prisma/seed-*.ts`)
 *   - does NOT fire in migrations (`prisma/migrations/`)
 *   - does NOT fire in `scripts/generate-registry.ts`
 *   - does NOT fire in test files
 *   - does NOT fire on unrelated fields (`name`, `domainGroup`,
 *     `aliases`, `isCanonical`, `sourceFeatureSetId`)
 *   - does NOT fire on unrelated tables (`prisma.behaviorTarget.create`)
 *   - does NOT fire on Parameter reads
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-customer-write-to-canonical-interpretation.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-customer-write-to-canonical-interpretation", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-customer-write-to-canonical-interpretation", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const WIZARD = "/repo/apps/admin/lib/wizard/apply-projection.ts";
// #2174 S5 follow-on: WIZARD is allow-listed for `Parameter.config` writes
// (the wizard IS the HF-canonical author of per-course Parameter rows mined
// from course-ref RUB sections). Use CUSTOMER_WIZARD_SIBLING for the
// "rule fires on a customer-driven path" tests that previously stood up
// WIZARD as the convenient stand-in. CUSTOMER_WIZARD_SIBLING represents
// a hypothetical sibling under lib/wizard/ that is NOT the projection
// chokepoint — still customer-driven, still subject to the rule.
const CUSTOMER_WIZARD_SIBLING =
  "/repo/apps/admin/lib/wizard/some-future-customer-writer.ts";
const POST_ROUTE = "/repo/apps/admin/app/api/parameters/route.ts";
const SUPERADMIN_ROUTE = "/repo/apps/admin/app/api/parameters/[id]/route.ts";
const SYNC = "/repo/apps/admin/app/api/admin/sync-parameters/route.ts";
const SEED = "/repo/apps/admin/prisma/seed-from-specs.ts";
const SEED_ALT = "/repo/apps/admin/prisma/seed-parameters.ts";
const MIGRATION =
  "/repo/apps/admin/prisma/migrations/20260618000000_x/migration.sql.ts";
const SCRIPTS = "/repo/apps/admin/scripts/enrich-beh-parameters.ts";
const X_ROUTE = "/repo/apps/admin/app/api/x/seed-system/route.ts";
const LAB = "/repo/apps/admin/app/api/lab/features/[id]/activate/route.ts";
const TEST = "/repo/apps/admin/tests/lib/wizard/apply-projection.test.ts";

tester.run("no-customer-write-to-canonical-interpretation", rule as never, {
  valid: [
    // Valid customer-driven Parameter.create — no spec fields in the data.
    {
      filename: WIZARD,
      code: `await prisma.parameter.create({ data: { parameterId: "X", name: "X", domainGroup: "skill", scaleType: "0-1", directionality: "positive", parameterType: "BEHAVIOR", isAdjustable: true } });`,
    },
    // Valid customer-driven Parameter.update — aliases / isCanonical /
    // sourceFeatureSetId (operational fields, not spec). Note: `config`
    // is now SPEC-readonly per #2174 S5 — see invalid cases below.
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { aliases: ["foo"], isCanonical: false, sourceFeatureSetId: "fs1" } });`,
    },
    // Seed paths — must contain spec fields.
    {
      filename: SEED,
      code: `await prisma.parameter.create({ data: { parameterId, name, definition: spec.definition, interpretationHigh: spec.high, interpretationLow: spec.low } });`,
    },
    {
      filename: SEED_ALT,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { definition: row.definition } });`,
    },
    // #2174 S5 — seed paths must be free to write the 4 new spec fields.
    {
      filename: SEED,
      code: `await prisma.parameter.create({ data: { parameterId, name, tiers: spec.tiers, tierScheme: spec.tierScheme, defaultTarget: spec.defaultTarget, config: spec.config } });`,
    },
    {
      filename: SEED_ALT,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config: { bandThresholds: row.bandThresholds } } });`,
    },
    // Migrations — historical backfills.
    {
      filename: MIGRATION,
      code: `await prisma.parameter.update({ where: { id }, data: { interpretationHigh: "..." } });`,
    },
    // HF-authored scripts — one-off enrichment / fix.
    {
      filename: SCRIPTS,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { definition, interpretationHigh, interpretationLow } });`,
    },
    // HF admin tooling under /api/x/.
    {
      filename: X_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, definition: "..." } });`,
    },
    // HF-curated feature activation.
    {
      filename: LAB,
      code: `await prisma.parameter.create({ data: { parameterId, definition: metadata.rationale } });`,
    },
    // SUPERADMIN PUT route — allow-listed by suffix.
    {
      filename: SUPERADMIN_ROUTE,
      code: `await prisma.parameter.update({ where: { id }, data: { definition: body.definition } });`,
    },
    // ADMIN sync route — allow-listed by suffix.
    {
      filename: SYNC,
      code: `await prisma.parameter.create({ data: { parameterId, definition: paramData.description } });`,
    },
    // Tests — fixtures.
    {
      filename: TEST,
      code: `await prisma.parameter.create({ data: { parameterId, definition: "test definition" } });`,
    },
    // Unrelated tables.
    {
      filename: WIZARD,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, targetValue: 0.5 } });`,
    },
    // #2174 S5 follow-on — wizard projection is allow-listed for
    // Parameter.config writes (the wizard IS the HF-canonical author of
    // per-course Parameter rows mined from course-ref RUB sections).
    // Other customer-write paths remain blocked (see CUSTOMER_WIZARD_SIBLING
    // tests in `invalid:`).
    {
      filename: WIZARD,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config: { bandThresholds: bands } } });`,
    },
    {
      filename: WIZARD,
      code: `await prisma.parameter.create({ data: { parameterId: "X", config: { bandThresholds: {} } } });`,
    },
    // Reads always pass.
    {
      filename: WIZARD,
      code: `const rows = await prisma.parameter.findMany({ where: { parameterId } });`,
    },
  ],
  invalid: [
    // Wizard create with `definition` — the #1984 mitigation target.
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", name: "X", definition: p.description, domainGroup: "skill" } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // POST /api/parameters writing definition — the OPERATOR-tier
    // customer-facing route that's the genuine #1984 violation.
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, name, definition: body.definition } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, interpretationHigh: body.interpretationHigh } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, interpretationLow: body.interpretationLow } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // New code path under /lib/ — would catch a future customer-driven
    // helper before it lands. Fires twice post-#2174 S5: `definition`
    // in create branch + `config` in update branch (both spec-readonly).
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId, definition: "..." }, update: { config } });`,
      errors: [
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
      ],
    },
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId }, update: { interpretationHigh: "..." } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // Multiple spec fields in one payload — fires once per field.
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", definition: "a", interpretationHigh: "b", interpretationLow: "c" } });`,
      errors: [
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
      ],
    },
    // #2174 S5 — defensive extension: per-tier descriptor text from a
    // customer-callable path. The LLM grading rubric must come from
    // the canonical seed.
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", tiers: { "7": "Band 7: speaks fluently..." } } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { tiers: body.tiers } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // #2174 S5 — defensive extension: tierScheme (the band scheme,
    // e.g. [3, 4, 5.5, 7] for IELTS).
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", tierScheme: [3, 4, 5.5, 7] } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { tierScheme: body.tierScheme } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // #2174 S5 — defensive extension: defaultTarget (HF-canonical
    // default target tier; customer tunes via BehaviorTarget.targetValue
    // cascade, NOT by mutating the Parameter row).
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", defaultTarget: 0.7 } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { defaultTarget: body.defaultTarget } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // #2174 S5 — defensive extension: config (open-shape JSON bag
    // carrying bandThresholds / tierScheme / tiers / etc.). HF-only
    // until specific subfields are classified TUNABLE per the #2174
    // epic audit. Today's wizard write at
    // lib/wizard/apply-projection.ts will need either a chokepoint
    // helper or an allow-list update — surfaced in the PR body.
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", config: { bandThresholds: {} } } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config: { tierScheme: [3, 4, 5.5, 7] } } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // #2174 S5 — upsert with a new spec field in either branch.
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId, tiers: {} }, update: {} });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId }, update: { defaultTarget: 0.7 } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // #2174 S5 — multiple new spec fields in one payload fire once each.
    {
      filename: CUSTOMER_WIZARD_SIBLING,
      code: `await prisma.parameter.create({ data: { parameterId: "X", tiers: {}, tierScheme: [], defaultTarget: 0.5, config: {} } });`,
      errors: [
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
      ],
    },
  ],
});
