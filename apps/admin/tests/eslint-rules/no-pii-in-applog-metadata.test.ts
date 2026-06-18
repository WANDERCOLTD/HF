import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-pii-in-applog-metadata.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-pii-in-applog-metadata", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-pii-in-applog-metadata", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

tester.run("no-pii-in-applog-metadata", rule as never, {
  valid: [
    // Allowed paths (logger.ts may write arbitrary metadata)
    {
      filename: "/repo/apps/admin/lib/logger.ts",
      code: `prisma.appLog.create({ data: { metadata: { email: "x@y.z" } } });`,
    },
    // Tests are exempted
    {
      filename: "/repo/apps/admin/tests/foo.test.ts",
      code: `prisma.appLog.create({ data: { metadata: { phone: "555" } } });`,
    },
    // Scripts are exempted
    {
      filename: "/repo/apps/admin/scripts/forensics.ts",
      code: `prisma.appLog.create({ data: { metadata: { transcript: "x" } } });`,
    },
    // No PII keys → allowed
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { duration: 100, success: true } } });`,
    },
    // No metadata at all → allowed
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { type: "info", stage: "test" } });`,
    },
    // Explicit @piiRedacted escape
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `
        // @piiRedacted
        prisma.appLog.create({ data: { metadata: { email: redactedFn(input) } } });
      `,
    },
    // log() call without PII keys
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `log("info", "stage", { metadata: { duration: 50 } });`,
    },
  ],
  invalid: [
    // Direct prisma.appLog.create with email in metadata
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { email: "x@y.z" } } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // phone
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { phone: "555" } } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // transcript
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { transcript: "literal" } } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // name
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { name: "Sarah" } } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // promptPreview directly in metadata literal
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `prisma.appLog.create({ data: { metadata: { promptPreview: "x" } } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // log() with PII in metadata
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `log("info", "stage", { metadata: { email: "x@y.z" } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
    // logAI() with PII in metadata
    {
      filename: "/repo/apps/admin/lib/foo.ts",
      code: `logAI("stage", "p", "r", { metadata: { phone: "555" } });`,
      errors: [{ messageId: "piiInMetadata" }],
    },
  ],
});
