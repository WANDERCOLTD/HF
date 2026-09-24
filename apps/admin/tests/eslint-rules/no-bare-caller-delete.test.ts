import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bare-caller-delete.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-caller-delete", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-caller-delete", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// The chokepoint itself — the ONLY production file allowed to delete callers.
const CHOKEPOINT = "/repo/apps/admin/lib/gdpr/delete-caller-data.ts";

// Sites that must trigger. The four routes below are real: each hand-rolled
// its own FK chain, each omitted `Session`, and each was consolidated onto
// the chokepoint. They stay in the BAD column so the back-door stays shut.
const ROUTE_BAD = "/repo/apps/admin/app/api/x/cleanup-callers/route.ts";
const MERGE_BAD = "/repo/apps/admin/app/api/callers/merge/route.ts";
const SEED_BAD = "/repo/apps/admin/prisma/seed-golden.ts";
const LIB_BAD = "/repo/apps/admin/lib/some-new-helper.ts";

// Exempt by path-contains: tests, archived code.
const TEST_FILE = "/repo/apps/admin/tests/lib/gdpr/something.test.ts";
const ARCHIVED = "/repo/apps/admin/_archived/old-cleanup.ts";

tester.run("no-bare-caller-delete", rule as never, {
  valid: [
    // The chokepoint may delete callers — that is its job.
    { code: `await client.caller.deleteMany({ where: { id: { in: ids } } });`, filename: CHOKEPOINT },
    { code: `await client.caller.delete({ where: { id } });`, filename: CHOKEPOINT },
    // Allow-listed by path-contains.
    { code: `await prisma.caller.deleteMany({});`, filename: TEST_FILE },
    { code: `await prisma.caller.delete({ where: { id } });`, filename: ARCHIVED },
    // Routing through the chokepoint is always fine, anywhere.
    { code: `await deleteCallersData(ids);`, filename: ROUTE_BAD },
    { code: `await deleteCallerData(caller.id);`, filename: SEED_BAD },
    // Other models are none of this rule's business.
    { code: `await prisma.call.deleteMany({ where: { callerId } });`, filename: LIB_BAD },
    { code: `await prisma.session.deleteMany({ where: { callerId } });`, filename: LIB_BAD },
    // `caller` as a plain property, not a Prisma delegate.
    { code: `await thing.caller.notify();`, filename: LIB_BAD },
  ],
  invalid: [
    {
      code: `await prisma.caller.deleteMany({ where: { id: { in: ids } } });`,
      filename: ROUTE_BAD,
      errors: [{ messageId: "bareCallerDelete" }],
    },
    {
      code: `await prisma.caller.delete({ where: { id: caller.id } });`,
      filename: ROUTE_BAD,
      errors: [{ messageId: "bareCallerDelete" }],
    },
    // Inside a transaction is still a bare chain.
    {
      code: `await tx.caller.deleteMany({ where: { id: { in: sourceCallerIds } } });`,
      filename: MERGE_BAD,
      errors: [{ messageId: "bareCallerDelete" }],
    },
    // Seeds get no free pass — they were the original drift surface.
    {
      code: `await prisma.caller.deleteMany({ where: { externalId: { startsWith: "x" } } });`,
      filename: SEED_BAD,
      errors: [{ messageId: "bareCallerDelete" }],
    },
    {
      code: `await prisma.caller.deleteMany({});`,
      filename: LIB_BAD,
      errors: [{ messageId: "bareCallerDelete" }],
    },
  ],
});
