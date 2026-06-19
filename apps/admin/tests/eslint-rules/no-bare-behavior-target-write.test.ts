/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bare-behavior-target-write.mjs` — #2031 S2.
 *
 * The rule blocks bare `prisma.behaviorTarget.{create,update,upsert,
 * delete,createMany,updateMany,deleteMany}` outside an explicit
 * allow-list. ADAPT-stage SYSTEM-scope writes must flow through
 * `updateSystemBehaviorTargetForAdapt`; customer-driven PLAYBOOK /
 * CALLER writes must flow through `writeBehaviorTarget` /
 * `writeCallerBehaviorTarget`. Both helpers enforce the parameterId
 * whitelist (BEHAVIOR + isAdjustable), the [0, 1] clamp, the
 * `BehaviorTargetSource` stamp, and the `invalidateKnob` cascade-cache
 * drop.
 *
 * Born of the 2026-06-19 Track D audit of epic #2031 — `app/api/calls/
 * [callId]/ops/[opId]/route.ts:880` (the ADAPT op) was hand-rolling
 * `prisma.behaviorTarget.updateMany` with neither clamp nor whitelist
 * nor cache invalidation. The refactor lands the canonical helper at
 * `lib/ops/update-system-targets.ts`; this rule pins the chokepoint.
 *
 * Pins:
 *   - fires on bare `prisma.behaviorTarget.updateMany` outside allow-list
 *     (the literal #2031 fingerprint)
 *   - fires on bare `prisma.behaviorTarget.create`
 *   - fires on bare `prisma.behaviorTarget.delete` / `.deleteMany`
 *   - does NOT fire in the canonical ADAPT writer (lib/ops/update-system-targets.ts)
 *   - does NOT fire in the canonical PLAYBOOK / CALLER writer
 *     (lib/agent-tuner/write-target.ts)
 *   - does NOT fire in admin seed routes (x/seed-system, x/create-domains)
 *   - does NOT fire in the wizard apply-projection helper
 *   - does NOT fire in `/scripts/` or `/prisma/seed*`
 *   - does NOT fire in `/tests/`
 *   - does NOT fire on unrelated prisma writes (`prisma.parameter.create`)
 *   - does NOT fire on reads (`prisma.behaviorTarget.findMany`)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-behavior-target-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-behavior-target-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-behavior-target-write", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Sites that MUST trigger the rule when bare-writing.
const RUNTIME_BAD = "/repo/apps/admin/lib/pipeline/some-new-helper.ts";
const OPS_BAD = "/repo/apps/admin/app/api/calls/[callId]/ops/[opId]/route.ts";
// NOTE: ops/[opId]/route.ts is intentionally NOT in the allow-list — the
// canonical refactor moved its sole BehaviorTarget write into
// `lib/ops/update-system-targets.ts`. The rule keeps the back-door
// closed by keeping ops/[opId]/route.ts in the BAD column.

// Allow-listed canonical writers + helpers.
const UPDATE_SYSTEM = "/repo/apps/admin/lib/ops/update-system-targets.ts";
const AGENT_TUNER = "/repo/apps/admin/lib/agent-tuner/write-target.ts";
const PLAYBOOK_NEW_VERSION =
  "/repo/apps/admin/app/api/playbooks/[playbookId]/new-version/route.ts";
const PLAYBOOK_COMPILE =
  "/repo/apps/admin/app/api/playbooks/[playbookId]/compile-targets/route.ts";
const APPLY_PROJECTION = "/repo/apps/admin/lib/wizard/apply-projection.ts";
const UPDATE_TARGETS = "/repo/apps/admin/lib/ops/update-targets.ts";
const AGENT_TUNING = "/repo/apps/admin/lib/domain/agent-tuning.ts";

// Allow-listed admin seed / reset routes.
const SEED_SYSTEM = "/repo/apps/admin/app/api/x/seed-system/route.ts";
const CREATE_DOMAINS = "/repo/apps/admin/app/api/x/create-domains/route.ts";
const SEED_DOMAINS = "/repo/apps/admin/app/api/x/seed-domains/route.ts";
const SEED_TRANSCRIPTS = "/repo/apps/admin/app/api/x/seed-transcripts/route.ts";

// Substring allow-lists.
const SEED_SCRIPT = "/repo/apps/admin/prisma/seed-from-specs.ts";
const SCRIPTS_DIR = "/repo/apps/admin/scripts/seed-system-behavior-defaults.ts";
const TESTS_DIR = "/repo/apps/admin/tests/lib/some-test.test.ts";
const CANARY_FIXTURE =
  "/repo/apps/admin/tests/integration/journey/canary-fixture.ts";
const ARCHIVED_SEED = "/repo/apps/admin/prisma/_archived/seed-master.ts";
const ARCHIVED_LEGACY = "/repo/apps/admin/_archived/legacy-api/behavior-targets/route.ts";

tester.run("no-bare-behavior-target-write", rule as never, {
  valid: [
    // Canonical writers.
    {
      filename: UPDATE_SYSTEM,
      code: `await prisma.behaviorTarget.updateMany({ where: { parameterId, scope: "SYSTEM" }, data: { targetValue: 0.5 } });`,
    },
    {
      filename: AGENT_TUNER,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, playbookId, scope: "PLAYBOOK", targetValue: 0.7, source: "MANUAL" } });`,
    },
    {
      filename: AGENT_TUNER,
      code: `await prisma.behaviorTarget.delete({ where: { id: existing.id } });`,
    },
    {
      filename: PLAYBOOK_NEW_VERSION,
      code: `await prisma.behaviorTarget.createMany({ data: rows });`,
    },
    {
      filename: PLAYBOOK_COMPILE,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, playbookId, scope: "PLAYBOOK", targetValue } });`,
    },
    // Implicit canonical helpers writing through tx.behaviorTarget.
    {
      filename: APPLY_PROJECTION,
      code: `await tx.behaviorTarget.create({ data: { parameterId, playbookId, scope: "PLAYBOOK", targetValue } });`,
    },
    {
      filename: APPLY_PROJECTION,
      code: `await tx.behaviorTarget.delete({ where: { id: e.id } });`,
    },
    {
      filename: UPDATE_TARGETS,
      code: `await prisma.behaviorTarget.update({ where: { id }, data: { targetValue } });`,
    },
    {
      filename: AGENT_TUNING,
      code: `await p.behaviorTarget.create({ data: { parameterId, scope: "DOMAIN", targetValue } });`,
    },
    // Admin seed / reset routes — destructive-OK.
    {
      filename: SEED_SYSTEM,
      code: `await prisma.behaviorTarget.deleteMany({ where: { playbookId: pb.id } });`,
    },
    {
      filename: CREATE_DOMAINS,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, playbookId, scope: "PLAYBOOK", targetValue } });`,
    },
    {
      filename: SEED_DOMAINS,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "DOMAIN", targetValue } });`,
    },
    {
      filename: SEED_TRANSCRIPTS,
      code: `await prisma.behaviorTarget.deleteMany({ where: { scope: "CALLER" } });`,
    },
    // Seed + script + test substring allow-lists.
    {
      filename: SEED_SCRIPT,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "SYSTEM", targetValue } });`,
    },
    {
      filename: ARCHIVED_SEED,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "SYSTEM", targetValue } });`,
    },
    {
      filename: ARCHIVED_LEGACY,
      code: `await prisma.behaviorTarget.update({ where: { id }, data: { targetValue } });`,
    },
    {
      filename: SCRIPTS_DIR,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "SYSTEM", targetValue } });`,
    },
    {
      filename: TESTS_DIR,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "PLAYBOOK", targetValue } });`,
    },
    {
      filename: CANARY_FIXTURE,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "PLAYBOOK", targetValue } });`,
    },
    // Unrelated prisma writes — must pass.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.parameter.create({ data: { parameterId, name } });`,
    },
    {
      filename: RUNTIME_BAD,
      code: `await prisma.call.create({ data: { callerId } });`,
    },
    // Reads always pass (no rule applies).
    {
      filename: RUNTIME_BAD,
      code: `const rows = await prisma.behaviorTarget.findMany({ where: { scope: "SYSTEM" } });`,
    },
    {
      filename: RUNTIME_BAD,
      code: `const row = await prisma.behaviorTarget.findFirst({ where: { parameterId } });`,
    },
  ],
  invalid: [
    // The literal ops:880 fingerprint — bare updateMany at SYSTEM scope
    // from a non-canonical runtime path.
    {
      filename: OPS_BAD,
      code: `await prisma.behaviorTarget.updateMany({ where: { parameterId, scope: "SYSTEM" }, data: { targetValue: 0.6 } });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare create from a runtime path.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "SYSTEM", targetValue: 0.5 } });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare update — same shape.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.update({ where: { id }, data: { targetValue: 0.7 } });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare upsert — same shape.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.upsert({ where: { id }, create: {}, update: {} });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare deleteMany — bulk reset from a non-allowed path.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.deleteMany({ where: { scope: "SYSTEM" } });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare createMany.
    {
      filename: RUNTIME_BAD,
      code: `await prisma.behaviorTarget.createMany({ data: [{ parameterId, scope: "PLAYBOOK", targetValue: 0.5 }] });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
    // Bare write under app/api/ in a NEW route that isn't allow-listed.
    {
      filename: "/repo/apps/admin/app/api/voice/calls/start/route.ts",
      code: `await prisma.behaviorTarget.create({ data: { parameterId, scope: "CALLER", targetValue: 0.6 } });`,
      errors: [{ messageId: "bareBehaviorTargetWrite" }],
    },
  ],
});
