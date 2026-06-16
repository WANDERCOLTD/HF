/**
 * Behavioural + structural tests for `eslint-rules/require-tiered-redactor.mjs` —
 * Wave C5 of epic #1685.
 *
 * Pins:
 *   - Dormant on files without `@tieredVisibility` (no false positives — every
 *     untagged route in the repo must still pass).
 *   - Fires when tagged file is missing the visibility import.
 *   - Fires when tagged file is missing a redactor import.
 *   - Fires when imports present but the helpers aren't actually invoked.
 *   - Passes when tagged file imports + invokes both.
 *   - Accepts redactors named `redact<Anything>ForTier` (regex contract).
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/require-tiered-redactor.mjs";
import { smokeRule } from "./_helpers.js";

describe("require-tiered-redactor", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("require-tiered-redactor", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("require-tiered-redactor", rule as never, {
  valid: [
    {
      name: "untagged route — rule dormant",
      code: `
        import { NextResponse } from "next/server";
        import { requireAuth } from "@/lib/permissions";
        export async function GET() {
          const auth = await requireAuth("VIEWER");
          return NextResponse.json({ ok: true, sensitive: 42 });
        }
      `,
    },
    {
      name: "tagged route with full wiring",
      code: `
        /**
         * @tieredVisibility
         */
        import { NextResponse } from "next/server";
        import { visibilityTierForRole } from "@/lib/rbac/visibility";
        import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
        export async function GET() {
          const tier = visibilityTierForRole("OPERATOR");
          const raw = { x: 1 };
          return NextResponse.json(redactAdaptationsForTier(raw, tier));
        }
      `,
    },
    {
      name: "tagged route with renamed redactor import (local alias)",
      code: `
        /** @tieredVisibility */
        import { visibilityTierForRole } from "@/lib/rbac/visibility";
        import { redactAdaptationsForTier as redact } from "@/lib/rbac/policies/adaptations";
        export async function GET() {
          const tier = visibilityTierForRole("STUDENT");
          return Response.json(redact({}, tier));
        }
      `,
    },
    {
      name: "eslint.config.mjs mentions @tieredVisibility as wiring documentation — allow-listed",
      filename: "/repo/apps/admin/eslint.config.mjs",
      code: `
        // Wave C5 wiring: '@tieredVisibility' tag enforces redactor pattern.
        export default [{ rules: { "hf-rbac/require-tiered-redactor": "error" } }];
      `,
    },
  ],
  invalid: [
    {
      name: "tagged route missing the visibility import (call error cascade-suppressed)",
      code: `
        /** @tieredVisibility */
        import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
        export async function GET() {
          return Response.json(redactAdaptationsForTier({}, "full"));
        }
      `,
      errors: [{ messageId: "missingVisibilityImport" }],
    },
    {
      name: "tagged route missing the redactor import (call error cascade-suppressed)",
      code: `
        /** @tieredVisibility */
        import { visibilityTierForRole } from "@/lib/rbac/visibility";
        export async function GET() {
          const tier = visibilityTierForRole("OPERATOR");
          return Response.json({ tier });
        }
      `,
      errors: [{ messageId: "missingPolicyImport" }],
    },
    {
      name: "tagged route imports both but never calls visibilityTierForRole",
      code: `
        /** @tieredVisibility */
        import { visibilityTierForRole } from "@/lib/rbac/visibility";
        import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
        export async function GET() {
          return Response.json(redactAdaptationsForTier({}, "full"));
        }
      `,
      errors: [{ messageId: "missingVisibilityCall" }],
    },
    {
      name: "tagged route imports both but never invokes the redactor",
      code: `
        /** @tieredVisibility */
        import { visibilityTierForRole } from "@/lib/rbac/visibility";
        import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
        export async function GET() {
          const tier = visibilityTierForRole("OPERATOR");
          return Response.json({ tier });
        }
      `,
      errors: [{ messageId: "missingRedactorCall" }],
    },
    {
      name: "tagged route with neither import — all 4 messages fire",
      code: `
        /** @tieredVisibility */
        export async function GET() {
          return Response.json({ secret: 42 });
        }
      `,
      errors: [
        { messageId: "missingVisibilityImport" },
        { messageId: "missingPolicyImport" },
      ],
    },
  ],
});
