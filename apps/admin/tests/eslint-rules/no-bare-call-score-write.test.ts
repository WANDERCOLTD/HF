/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bare-call-score-write.mjs` — #1539 / epic #1967 M3.
 *
 * The rule blocks bare `prisma.callScore.{create,update,upsert}` outside
 * an explicit allow-list. Every `CallScore` row must flow through
 * `writeCallScore()` (the chokepoint helper) so each write carries a
 * non-null `analysisSpecId` — the producer side of the per-parameter
 * measurement closure (#1967 M2).
 *
 * Born of #1539 (analysisSpecId was NULL on 1125/1125 sandbox rows).
 * Re-pinned by epic #1967 M3 — the rule guarantees that every measured
 * parameter's CallScore actually exists with a real spec lineage, so
 * the M2 loop-closure test has a real producer to walk back from.
 *
 * Pins:
 *   - fires on bare `prisma.callScore.create` outside allow-list
 *   - fires on bare `prisma.callScore.update`
 *   - fires on bare `prisma.callScore.upsert`
 *   - does NOT fire on `writeCallScore(...)` calls
 *   - does NOT fire inside the chokepoint helper itself
 *   - does NOT fire in `/scripts/` (drain / migration paths)
 *   - does NOT fire in `/tests/`
 *   - does NOT fire on unrelated prisma writes (`prisma.call.create`)
 *   - does NOT fire on `prisma.callScore.findMany` or other reads
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-call-score-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-call-score-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-call-score-write", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const RUNTIME = "/repo/apps/admin/lib/pipeline/score-agent.ts";
const HELPER = "/repo/apps/admin/lib/measurement/write-call-score.ts";
const DRAIN_SCRIPT = "/repo/apps/admin/scripts/backfill-call-score-analysis-spec.ts";
const ADMIN_DEMO = "/repo/apps/admin/app/api/admin/demo-reset-scoped/route.ts";
const SCRIPTS_DIR = "/repo/apps/admin/scripts/ad-hoc-fix.ts";
const TESTS_DIR = "/repo/apps/admin/tests/lib/pipeline/some.test.ts";
const TESTS_NESTED = "/repo/apps/admin/__tests__/foo.test.ts";
const OPS_DIR = "/repo/apps/admin/lib/ops/personality-analyze.ts";

tester.run("no-bare-call-score-write", rule as never, {
  valid: [
    // The canonical write shape — through the helper.
    {
      filename: RUNTIME,
      code: `import { writeCallScore } from "@/lib/measurement/write-call-score"; await writeCallScore({ callId, callerId, parameterId, analysisSpecId, moduleId, score: 0.5, confidence: 0.8, evidence: [] });`,
    },
    // The chokepoint itself — must contain the bare write internally.
    {
      filename: HELPER,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score, analysisSpecId } });`,
    },
    // Drain script — explicit allow-list entry.
    {
      filename: DRAIN_SCRIPT,
      code: `await prisma.callScore.update({ where: { id }, data: { analysisSpecId } });`,
    },
    // Demo-reset endpoint — explicit allow-list entry (test fixtures).
    {
      filename: ADMIN_DEMO,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
    },
    // /scripts/ substring match — drain / migration / one-off paths.
    {
      filename: SCRIPTS_DIR,
      code: `await prisma.callScore.upsert({ where: { id }, create: {}, update: {} });`,
    },
    // /tests/ substring — fixture set-up.
    {
      filename: TESTS_DIR,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
    },
    // /__tests__/ alt namespace.
    {
      filename: TESTS_NESTED,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
    },
    // /lib/ops/ — personality verifier writes are pre-#1539; explicit
    // allow-list while the ops refactor lands.
    {
      filename: OPS_DIR,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
    },
    // Unrelated prisma writes — must pass.
    {
      filename: RUNTIME,
      code: `await prisma.call.create({ data: { callerId } });`,
    },
    // Reads always pass (no rule applies).
    {
      filename: RUNTIME,
      code: `const rows = await prisma.callScore.findMany({ where: { callId } });`,
    },
    {
      filename: RUNTIME,
      code: `await prisma.callScore.deleteMany({ where: { callId } });`,
    },
  ],
  invalid: [
    // Bare create from a runtime path — the #1539 fingerprint.
    {
      filename: RUNTIME,
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
      errors: [{ messageId: "bareCallScoreWrite" }],
    },
    // Bare update — same shape.
    {
      filename: RUNTIME,
      code: `await prisma.callScore.update({ where: { id }, data: { score: 0.5 } });`,
      errors: [{ messageId: "bareCallScoreWrite" }],
    },
    // Bare upsert — same shape.
    {
      filename: RUNTIME,
      code: `await prisma.callScore.upsert({ where: { id }, create: {}, update: {} });`,
      errors: [{ messageId: "bareCallScoreWrite" }],
    },
    // Bare write in an app/api/ route that isn't the demo allow-list.
    {
      filename: "/repo/apps/admin/app/api/voice/calls/start/route.ts",
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
      errors: [{ messageId: "bareCallScoreWrite" }],
    },
    // Bare write under lib/curriculum — a previously-clean path that could
    // grow a measurement shortcut over time.
    {
      filename: "/repo/apps/admin/lib/curriculum/some-new-helper.ts",
      code: `await prisma.callScore.create({ data: { callId, parameterId, score: 0.5 } });`,
      errors: [{ messageId: "bareCallScoreWrite" }],
    },
  ],
});
