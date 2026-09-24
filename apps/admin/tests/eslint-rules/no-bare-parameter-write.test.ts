/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bare-parameter-write.mjs` — #2031 S1.
 *
 * The rule blocks bare `prisma.parameter.{create,update,upsert,delete,
 * createMany,updateMany,deleteMany}` outside an explicit allow-list.
 * Every domainGroup-bearing write must flow through
 * `resolveCanonicalDomainGroup` (#1948 / #2029 / #2030) so off-taxonomy
 * fallbacks (`"general"` / `"lab"` / `"teaching"`) are refused at write
 * time rather than detected by a vitest the next PR.
 *
 * Born of the LastParms audit 2026-06-19 — the silent fallback in
 * `sync-parameters` (closed by #2029) and the sibling fallbacks in
 * `lab/features/[id]/activate` (closed by #2030) surfaced the broader
 * gap: NO ESLint chokepoint guarded `prisma.parameter.*` writes. This
 * rule closes it.
 *
 * Pins:
 *   - fires on bare `prisma.parameter.create` outside allow-list
 *   - fires on bare `prisma.parameter.update`
 *   - fires on bare `prisma.parameter.upsert`
 *   - fires on bare `prisma.parameter.delete` / `.deleteMany`
 *   - does NOT fire in any of the 7 canonical admin routes
 *   - does NOT fire in admin seed / debug routes (x/seed-domains,
 *     x/create-domains)
 *   - does NOT fire in wizard apply-projection (band-thresholds path)
 *   - does NOT fire in `/scripts/` or `/prisma/seed*`
 *   - does NOT fire in `/tests/`
 *   - does NOT fire on unrelated prisma writes (`prisma.call.create`)
 *   - does NOT fire on reads (`prisma.parameter.findMany`)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-parameter-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-parameter-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-parameter-write", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Sites that MUST trigger the rule when bare-writing.
const RUNTIME_BAD = "/repo/apps/admin/lib/pipeline/some-new-helper.ts";
const ROUTE_BAD = "/repo/apps/admin/app/api/voice/calls/start/route.ts";
const CURRICULUM_BAD = "/repo/apps/admin/lib/curriculum/some-new-helper.ts";

// Allow-listed canonical admin routes (the 7 from epic #2031).
const PARAMS_ROUTE = "/repo/apps/admin/app/api/parameters/route.ts";
const PARAMS_ID_ROUTE = "/repo/apps/admin/app/api/parameters/[id]/route.ts";
const PARAMS_ENRICH_ROUTE = "/repo/apps/admin/app/api/parameters/[id]/enrich/route.ts";
const SYNC_PARAMS_ROUTE = "/repo/apps/admin/app/api/admin/sync-parameters/route.ts";
const LAB_ACTIVATE_ROUTE = "/repo/apps/admin/app/api/lab/features/[id]/activate/route.ts";
const OPS_PARAM_ROUTE = "/repo/apps/admin/app/api/ops/[opid]/parameters/[id]/route.ts";
const SEED_SYSTEM_ROUTE = "/repo/apps/admin/app/api/x/seed-system/route.ts";

// Allow-listed sibling paths.
const X_CREATE_DOMAINS = "/repo/apps/admin/app/api/x/create-domains/route.ts";
const X_SEED_DOMAINS = "/repo/apps/admin/app/api/x/seed-domains/route.ts";
const APPLY_PROJECTION = "/repo/apps/admin/lib/wizard/apply-projection.ts";

// Substring allow-lists.
const SEED_SCRIPT = "/repo/apps/admin/prisma/seed-from-specs.ts";
const SCRIPTS_DIR = "/repo/apps/admin/scripts/enrich-beh-parameters.ts";
const REGISTRY_HELPER = "/repo/apps/admin/lib/registry/canonical-domain-group.ts";
const TESTS_DIR = "/repo/apps/admin/tests/api/parameters.test.ts";
const ARCHIVED_SEED = "/repo/apps/admin/prisma/_archived/seed-master.ts";

tester.run("no-bare-parameter-write", rule as never, {
  valid: [
    // The 7 canonical admin routes — explicit allow-list.
    {
      filename: PARAMS_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, name, domainGroup } });`,
    },
    {
      filename: PARAMS_ID_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId: id }, data: { name } });`,
    },
    {
      filename: PARAMS_ID_ROUTE,
      code: `await prisma.parameter.delete({ where: { parameterId: id } });`,
    },
    {
      filename: PARAMS_ENRICH_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config } });`,
    },
    {
      filename: SYNC_PARAMS_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, name, domainGroup } });`,
    },
    {
      filename: LAB_ACTIVATE_ROUTE,
      code: `await prisma.parameter.create({ data: { parameterId, name, domainGroup } });`,
    },
    {
      filename: OPS_PARAM_ROUTE,
      code: `await prisma.parameter.delete({ where: { parameterId: id } });`,
    },
    {
      filename: SEED_SYSTEM_ROUTE,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config } });`,
    },
    // Sibling admin seed / demo routes — explicit allow-list.
    {
      filename: X_CREATE_DOMAINS,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
    },
    {
      filename: X_SEED_DOMAINS,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
    },
    // Wizard band-thresholds writer — config-only, no domainGroup.
    {
      filename: APPLY_PROJECTION,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config: merged } });`,
    },
    // Seed scripts — canonical authoring path.
    {
      filename: SEED_SCRIPT,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
    },
    {
      filename: ARCHIVED_SEED,
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: {}, update: {} });`,
    },
    // /scripts/ substring — drain / migration paths.
    {
      filename: SCRIPTS_DIR,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { config } });`,
    },
    // lib/registry/ — the canonical helper home itself.
    {
      filename: REGISTRY_HELPER,
      code: `await prisma.parameter.create({ data: { parameterId, domainGroup } });`,
    },
    // /tests/ — fixture set-up.
    {
      filename: TESTS_DIR,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
    },
    // Unrelated prisma writes — must pass.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.call.create({ data: { callerId } });`,
    },
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, targetValue: 0.5 } });`,
    },
    // Reads always pass (no rule applies).
    {
      filename: RUNTIME_BAD,
      code: `const rows = await prisma.parameter.findMany({ where: { domainGroup } });`,
    },
    {
      filename: RUNTIME_BAD,
      code: `const row = await prisma.parameter.findUnique({ where: { parameterId } });`,
    },
    {
      filename: RUNTIME_BAD,
      code: `const count = await prisma.parameter.count();`,
    },
  ],
  invalid: [
    // Bare create from a runtime path — the #2031 fingerprint.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.create({ data: { parameterId, name, domainGroup: "general" } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bare update — same shape.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.update({ where: { parameterId }, data: { domainGroup: "lab" } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bare upsert — same shape.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.upsert({ where: { parameterId }, create: {}, update: {} });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bare delete — same shape.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.delete({ where: { parameterId } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bulk variants — createMany / updateMany / deleteMany.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.createMany({ data: [{ parameterId, name }] });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.updateMany({ where: { domainGroup: "general" }, data: { domainGroup: "BEH" } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.deleteMany({ where: { domainGroup: "lab" } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bare write in a NEW app/api/ route that isn't allow-listed.
    {
      filename: ROUTE_BAD,
      code: `await prisma.parameter.create({ data: { parameterId, name, domainGroup: "teaching" } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
    // Bare write under lib/curriculum — a previously-clean path that
    // could grow a registry shortcut over time.
    {
      filename: CURRICULUM_BAD,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
      errors: [{ messageId: "bareParameterWrite" }],
    },
  ],
});
