/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bare-module-progress-update.mjs` — #1703.
 *
 * Pins:
 *   - fires on `prisma.callerModuleProgress.update` in non-allow-listed files
 *   - fires on `prisma.callerModuleProgress.upsert` in non-allow-listed files
 *   - fires on `tx.callerModuleProgress.update` (transaction variant)
 *   - does NOT fire on `prisma.callerModuleProgress.createMany` (intentional —
 *     enrollment-time instantiator stays open)
 *   - does NOT fire in the canonical mastery writer (`track-progress.ts`)
 *   - does NOT fire in the chokepoint helper (`mark-module-incomplete.ts`)
 *   - does NOT fire in admin reset routes / backfill scripts / tests
 *   - does NOT fire on unrelated `.update` calls (e.g. on a different model)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-module-progress-update.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-module-progress-update", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-module-progress-update", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const LIB_OFFENDER = "/repo/apps/admin/lib/curriculum/some-new-writer.ts";
const ROUTE_OFFENDER = "/repo/apps/admin/app/api/callers/[callerId]/incomplete/route.ts";

const TRACK_PROGRESS = "/repo/apps/admin/lib/curriculum/track-progress.ts";
const HELPER = "/repo/apps/admin/lib/curriculum/mark-module-incomplete.ts";
const PIPELINE_ROUTE = "/repo/apps/admin/app/api/calls/[callId]/pipeline/route.ts";
const ADMIN_RESET = "/repo/apps/admin/app/api/admin/demo-reset-scoped/route.ts";
const BACKFILL = "/repo/apps/admin/scripts/backfill-950-stuck-module-status.ts";
const TEST = "/repo/apps/admin/tests/lib/curriculum/some.test.ts";

tester.run("no-bare-module-progress-update", rule as never, {
  valid: [
    // Allow-listed canonical mastery writer
    {
      filename: TRACK_PROGRESS,
      code: `await prisma.callerModuleProgress.upsert({ where: {}, create: {}, update: {} });`,
    },
    // Allow-listed chokepoint helper
    {
      filename: HELPER,
      code: `await tx.callerModuleProgress.update({ where: {}, data: { incompleteAttempts: { increment: 1 } } });`,
    },
    // Allow-listed pipeline route
    {
      filename: PIPELINE_ROUTE,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: { mastery: 0.9 } });`,
    },
    // Allow-listed admin reset route
    {
      filename: ADMIN_RESET,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: {} });`,
    },
    // Allow-listed backfill script
    {
      filename: BACKFILL,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: {} });`,
    },
    // Tests are exempt (path-suffix .test.ts + /tests/)
    {
      filename: TEST,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: {} });`,
    },
    // .createMany is intentionally NOT blocked — enrollment-time instantiator stays open
    {
      filename: LIB_OFFENDER,
      code: `await prisma.callerModuleProgress.createMany({ data: [] });`,
    },
    // Unrelated model.update — no false positive
    {
      filename: LIB_OFFENDER,
      code: `await prisma.caller.update({ where: {}, data: {} });`,
    },
    // .delete / .deleteMany are not blocked — admin reset semantics
    {
      filename: LIB_OFFENDER,
      code: `await prisma.callerModuleProgress.deleteMany({ where: {} });`,
    },
  ],
  invalid: [
    // Bare .update in a non-allow-listed lib file
    {
      filename: LIB_OFFENDER,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: {} });`,
      errors: [{ messageId: "bareModuleProgressUpdate" }],
    },
    // Bare .upsert in a non-allow-listed lib file
    {
      filename: LIB_OFFENDER,
      code: `await prisma.callerModuleProgress.upsert({ where: {}, create: {}, update: {} });`,
      errors: [{ messageId: "bareModuleProgressUpdate" }],
    },
    // tx.callerModuleProgress.update — transaction variant
    {
      filename: LIB_OFFENDER,
      code: `await tx.callerModuleProgress.update({ where: {}, data: {} });`,
      errors: [{ messageId: "bareModuleProgressUpdate" }],
    },
    // Non-allow-listed route file
    {
      filename: ROUTE_OFFENDER,
      code: `await prisma.callerModuleProgress.update({ where: {}, data: { incompleteAttempts: 1 } });`,
      errors: [{ messageId: "bareModuleProgressUpdate" }],
    },
  ],
});
