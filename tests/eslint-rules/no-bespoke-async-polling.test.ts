/**
 * Tests for eslint-rules/no-bespoke-async-polling.mjs (G7 — chase-prevention).
 *
 * Two layers (per `_helpers.ts` convention):
 *   - smokeRule() — structural checks (KB back-link, meta.type, messages, visitors)
 *   - RuleTester  — real-world valid + invalid examples exercised by the
 *                   real ESLint parser
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../apps/admin/eslint-rules/no-bespoke-async-polling.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bespoke-async-polling", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bespoke-async-polling", rule as never);
  });

  it("fires on bespoke polling shapes; passes on allowlisted paths", () => {
    const tester = new RuleTester({
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    });

    const filename = "apps/admin/lib/voice/something-new.ts";

    tester.run("no-bespoke-async-polling", rule as never, {
      valid: [
        // setTimeout in a one-shot delay (no loop) — fine.
        {
          filename,
          code: `await new Promise((r) => setTimeout(r, 100));`,
        },
        // setInterval at top level (no enclosing loop) — fine.
        {
          filename,
          code: `setInterval(() => doStuff(), 1000);`,
        },
        // Allowlisted file path — rule short-circuits even with the offending shape.
        {
          filename: "apps/admin/lib/rate-limit.ts",
          code: `
            async function poll() {
              while (Date.now() < deadline) {
                const ok = await check();
                if (ok) return ok;
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          `,
        },
        // Test file — exempted.
        {
          filename: "apps/admin/tests/lib/voice/foo.test.ts",
          code: `
            while (count < 3) {
              await new Promise((r) => setTimeout(r, 10));
              count++;
            }
          `,
        },
        // The helper itself uses setTimeout — explicit allowlist entry.
        {
          filename: "apps/admin/lib/async/wait-until-ready.ts",
          code: `
            function sleep(ms) {
              return new Promise((r) => setTimeout(r, ms));
            }
          `,
        },
      ],
      invalid: [
        // The canonical AP-3 shape: while + setTimeout inside.
        {
          filename,
          code: `
            async function waitForReady() {
              while (Date.now() < deadline) {
                const r = await check();
                if (r.ok) return r;
                await new Promise((res) => setTimeout(res, 2000));
              }
            }
          `,
          errors: [{ messageId: "bespokePolling" }],
        },
        // for-loop variant.
        {
          filename,
          code: `
            async function waitN() {
              for (let i = 0; i < 10; i++) {
                await new Promise((r) => setTimeout(r, 500));
                if (await check()) return;
              }
            }
          `,
          errors: [{ messageId: "bespokePolling" }],
        },
        // do-while variant with setInterval.
        {
          filename,
          code: `
            async function poll() {
              do {
                setInterval(() => check(), 1000);
                await delay();
              } while (!done);
            }
          `,
          errors: [{ messageId: "bespokePolling" }],
        },
      ],
    });
  });
});
