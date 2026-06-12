// HF-M.2 — pin the rule that blocks the next [callerId] route from landing
// without the STUDENT-scope guard. Sibling structural smokeRule + behavioural
// RuleTester cases.

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-unscoped-caller-id-route.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-unscoped-caller-id-route", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-unscoped-caller-id-route", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const CALLER_ID_PATH = "/repo/apps/admin/app/api/callers/[callerId]/snapshot/route.ts";
const NON_CALLER_ID_PATH = "/repo/apps/admin/app/api/system/health/route.ts";

tester.run("no-unscoped-caller-id-route", rule as never, {
  valid: [
    // Calls studentAllowedToReadCaller → guarded.
    {
      filename: CALLER_ID_PATH,
      code: `
        import { studentAllowedToReadCaller } from "@/lib/learner-scope";
        export async function GET() {
          if (!studentAllowedToReadCaller(s, callerId)) return forbidden();
        }
      `,
    },
    // Calls resolveCallerScopeForReading → guarded (the #977 helper).
    {
      filename: CALLER_ID_PATH,
      code: `
        import { resolveCallerScopeForReading } from "@/lib/learner-scope";
        export async function GET() {
          const scope = await resolveCallerScopeForReading(session, callerId);
        }
      `,
    },
    // Non-[callerId] path — rule does not apply.
    {
      filename: NON_CALLER_ID_PATH,
      code: `
        export async function GET() { return ok(); }
      `,
    },
    // [callerId] path but no handler — rule does not apply (helper module, layout, etc).
    {
      filename: CALLER_ID_PATH,
      code: `
        export const dynamic = "force-dynamic";
        export const someHelper = () => {};
      `,
    },
  ],
  invalid: [
    // [callerId] path with a GET handler and no guard — fires.
    {
      filename: CALLER_ID_PATH,
      code: `
        export async function GET() {
          const data = await prisma.caller.findUnique({ where: { id: callerId } });
          return NextResponse.json(data);
        }
      `,
      errors: [{ messageId: "missingGuard" }],
    },
    // Different HTTP verb — still fires.
    {
      filename: CALLER_ID_PATH,
      code: `
        export async function PATCH() {
          await prisma.caller.update({ where: { id: callerId } });
        }
      `,
      errors: [{ messageId: "missingGuard" }],
    },
    // Has a function called `studentAllowedToRead` (typo / different name) — still fires.
    {
      filename: CALLER_ID_PATH,
      code: `
        function studentAllowedToRead() { return true; }
        export async function GET() { studentAllowedToRead(); }
      `,
      errors: [{ messageId: "missingGuard" }],
    },
  ],
});
