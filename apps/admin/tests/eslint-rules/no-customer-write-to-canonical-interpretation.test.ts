/**
 * Behavioural + structural tests for
 * `eslint-rules/no-customer-write-to-canonical-interpretation.mjs` —
 * epic #1984 S1.
 *
 * The rule blocks customer-driven writes to spec-readonly
 * `Parameter` fields (`definition`, `interpretationHigh`,
 * `interpretationLow`). Spec fields are HF-canonical IP — only
 * seeds, the registry generator, and migrations may write them.
 *
 * Pairs with the declarative boundary at
 * `lib/cascade/spec-readonly-fields.ts` (S4 PR #1979) and the
 * coverage test at `tests/lib/cascade/spec-readonly-fields-coverage.test.ts`
 * (this PR S2) which pins constant ↔ rule pairing.
 *
 * Pins:
 *   - fires on `prisma.parameter.create({ data: { definition: ... } })`
 *   - fires on `prisma.parameter.update({ data: { interpretationHigh: ... } })`
 *   - fires on `prisma.parameter.upsert({ create: { ... }, update: { ... } })`
 *     in either branch
 *   - does NOT fire in seed paths (`prisma/seed-*.ts`)
 *   - does NOT fire in migrations (`prisma/migrations/`)
 *   - does NOT fire in `scripts/generate-registry.ts`
 *   - does NOT fire in test files
 *   - does NOT fire on unrelated fields (`name`, `domainGroup`, `config`)
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
    // Valid customer-driven Parameter.update — config / aliases / isCanonical.
    {
      filename: POST_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { aliases: ["foo"], config: { bandThresholds: [] } } });`,
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
    // Reads always pass.
    {
      filename: WIZARD,
      code: `const rows = await prisma.parameter.findMany({ where: { parameterId } });`,
    },
  ],
  invalid: [
    // Wizard create with `definition` — the #1984 mitigation target.
    {
      filename: WIZARD,
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
    // helper before it lands.
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId, definition: "..." }, update: { config } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    {
      filename: "/repo/apps/admin/lib/something-new.ts",
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: { parameterId }, update: { interpretationHigh: "..." } });`,
      errors: [{ messageId: "customerWriteToSpecField" }],
    },
    // Multiple spec fields in one payload — fires once per field.
    {
      filename: WIZARD,
      code: `await prisma.parameter.create({ data: { parameterId: "X", definition: "a", interpretationHigh: "b", interpretationLow: "c" } });`,
      errors: [
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
        { messageId: "customerWriteToSpecField" },
      ],
    },
  ],
});
