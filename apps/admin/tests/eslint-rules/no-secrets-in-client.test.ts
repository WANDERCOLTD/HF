/**
 * Behavioral + structural tests for `eslint-rules/no-secrets-in-client.mjs` (audit HF-J).
 *
 * smokeRule (HF-F: one location per rule, both checks here) + RuleTester behavioural cases.
 *
 * Pins:
 *   - fires on a credential-shaped key (`password`, `apiKey`, …) assigned a
 *     string literal in a `"use client"` file (Property / VariableDeclarator /
 *     AssignmentExpression positions)
 *   - fires on a secret-shaped literal value (sk-…, JWT) anywhere in a client file
 *   - does NOT fire in server files (no `"use client"` directive)
 *   - does NOT fire on env-derived / identifier / empty values
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-secrets-in-client.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-secrets-in-client", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-secrets-in-client", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const CLIENT = '"use client";\n';

tester.run("no-secrets-in-client", rule as never, {
  valid: [
    // Server file — directive absent → never fires, even with a literal password.
    { code: `const password = "hunter2";` },
    // Client file, env-derived value → not a literal.
    { code: `${CLIENT}const apiKey = process.env.NEXT_PUBLIC_KEY;` },
    // Client file, identifier value → not a literal.
    { code: `${CLIENT}const password = SECRET_FROM_SERVER;` },
    // Client file, empty string → ignored.
    { code: `${CLIENT}const password = "";` },
    // Client file, non-credential key with ordinary literal → not flagged.
    { code: `${CLIENT}const label = "School";` },
    // NB: the eslint-disable escape hatch (used for the build-stripped demo creds
    // in login/page.tsx) is ESLint core behaviour, not rule logic — it is proven
    // by the integration lint of login/page.tsx, not RuleTester (which can't
    // resolve the plugin-qualified rule name in its isolated harness).
  ],
  invalid: [
    // Credential key as object Property.
    {
      code: `${CLIENT}const a = { email: "x@y.com", password: "hff2026" };`,
      errors: [{ messageId: "credentialKey" }],
    },
    // Credential key as VariableDeclarator.
    {
      code: `${CLIENT}const apiKey = "abc123def456";`,
      errors: [{ messageId: "credentialKey" }],
    },
    // Credential key as AssignmentExpression.
    {
      code: `${CLIENT}let clientSecret;\nclientSecret = "shhhh-value";`,
      errors: [{ messageId: "credentialKey" }],
    },
    // Secret-shaped value under a non-credential key — caught by value shape.
    {
      code: `${CLIENT}const cfg = { note: "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX" };`,
      errors: [{ messageId: "secretValue" }],
    },
    // JWT literal anywhere.
    {
      code: `${CLIENT}const t = "eyJhbGciOiAiSFMyNTY.eyJzdWIiOiAiMTIz.dBjftJeZ4CVPmB92";`,
      errors: [{ messageId: "secretValue" }],
    },
  ],
});
