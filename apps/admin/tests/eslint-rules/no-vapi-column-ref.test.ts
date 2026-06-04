/**
 * Tests for eslint-rules/hf-voice/no-vapi-column-ref.mjs (AnyVoice #1024).
 *
 * Pins the rule contract: exactly the 6 forbidden Call column names
 * fire; legitimate VAPI-prefixed identifiers (vapiInbound, vapiCall,
 * vapiProvider — Category B residuals) do NOT. Path allowlist for
 * migrations + _archived honoured.
 */

import { RuleTester } from "eslint";
import rule from "../../eslint-rules/hf-voice/no-vapi-column-ref.mjs";

// RuleTester.run drives the test runner's describe/it directly — must
// live at module top level, not nested inside vitest's describe/it.
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Cast: the .mjs rule object's shape is correct at runtime, but TS's
// ESLint RuleDefinition type is stricter than the .mjs export inference.
tester.run("no-vapi-column-ref", rule as never, {
      valid: [
        // Canonical post-#1020 column names — pass through
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `
            const data = {
              voiceDurationSeconds: 90,
              voiceEndedReason: "customer-ended-call",
              voiceCostUsd: 0.05,
              voiceAnalysisSummary: "ok",
              voiceStructuredData: {},
              voiceSuccessEvaluation: "true",
            };
            prisma.call.create({ data });
          `,
        },
        // Category B legitimate identifiers — vapi*-named but NOT
        // renamed-column names. Must NOT fire.
        {
          filename: "/repo/apps/admin/app/api/vapi/tools/route.ts",
          code: `
            const vapiInbound = await getVoiceProvider("vapi");
            const vapiProvider = vapiInbound;
            const vapiCall = { id: "abc" };
          `,
        },
        // Migration files reference the old names verbatim — allowed
        // by path exclusion.
        {
          filename: "/repo/apps/admin/prisma/migrations/20260604_xxx/migration.sql.ts",
          code: `
            const sql = \`ALTER TABLE "Call" RENAME COLUMN "vapiDurationSeconds" TO "voiceDurationSeconds";\`;
          `,
        },
        // Archived legacy code — allowed by path exclusion.
        {
          filename: "/repo/apps/admin/prisma/_archived/seed-mabel.ts",
          code: `prisma.call.create({ data: { vapiCostUsd: 0.05 } });`,
        },
      ],
      invalid: [
        // Each of the 6 forbidden names — one case per to pin the set.
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiDurationSeconds: 90 } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiEndedReason: "x" } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiCostUsd: 0.05 } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiAnalysisSummary: "x" } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiStructuredData: {} } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `prisma.call.create({ data: { vapiSuccessEvaluation: "true" } });`,
          errors: [{ messageId: "vapiColumn" }],
        },
        // Bare identifier reference — also forbidden
        {
          filename: "/repo/apps/admin/app/api/vapi/webhook/route.ts",
          code: `const x = call.vapiDurationSeconds;`,
          errors: [{ messageId: "vapiColumn" }],
        },
      ],
});
