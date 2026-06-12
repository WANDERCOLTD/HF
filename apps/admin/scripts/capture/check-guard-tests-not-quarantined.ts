/**
 * check-guard-tests-not-quarantined.ts — meta-guard for the guard tests themselves.
 *
 * Audit HF-E. The route-auth-coverage security gate went dark when it was added to the
 * `vitest.config.ts` exclude block alongside ~30 ordinary flaky tests — and the
 * `quarantined_tests` ratchet counted it identically to any other quarantined test, so
 * nothing signalled that a SECURITY guard had been switched off (the audit's central
 * finding). This sentinel closes that hole: a named registry of GUARD tests
 * (security / data-integrity / AI-safety pins) MUST (a) exist on disk and (b) NOT appear
 * in the vitest exclude list. A guard test may never be quarantined or deleted.
 *
 * To add a guard test: append it to GUARD_TESTS below. To legitimately retire one, remove
 * it here in the same commit that removes the test — an explicit, reviewable act, unlike a
 * silent line in the exclude block.
 *
 * Run:  npx tsx scripts/capture/check-guard-tests-not-quarantined.ts   (from apps/admin)
 * Wired into `npm run kb:check`.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "../..");

/** Security / data-integrity / AI-safety pins that must ALWAYS run in CI. */
const GUARD_TESTS = [
  "tests/lib/route-auth-coverage.test.ts", // every route authed or reviewed-public
  "tests/lib/page-auth-coverage.test.ts", // every /x page gated
  "tests/api/chat-factual-grounding.test.ts", // #1444 ungrounded-claim intercept
  "tests/lib/learner-scope.test.ts", // #977 STUDENT cross-caller PII leak
  "tests/lib/validate-manifest.test.ts", // AI-to-DB subject/pedagogy guard
  "tests/lib/voice/create-session.test.ts", // #1342 sequence-race + snapshot
  "tests/lib/voice/end-session.test.ts", // #1342 end-of-session counter flips
  "tests/lib/curriculum/resolve-module.test.ts", // #407 slug-scoping (HF-L)
  "tests/intake/disclosure-store.test.ts", // #1048 synthetic-id (HF-L)
  "tests/lib/voice/retell-auth.test.ts", // HF-C webhook signature
  "tests/lib/skill-tier-mapping.test.ts", // HF-A contract-config flow-through
];

function main() {
  const missing: string[] = [];
  const quarantined: string[] = [];

  const vitestConfig = readFileSync(`${APP_DIR}/vitest.config.ts`, "utf8");

  for (const t of GUARD_TESTS) {
    if (!existsSync(`${APP_DIR}/${t}`)) {
      missing.push(t);
      continue;
    }
    // Quarantined iff the exact path appears as a quoted exclude entry.
    if (new RegExp(`['"]${t.replace(/[.[\]/]/g, "\\$&")}['"]`).test(vitestConfig)) {
      quarantined.push(t);
    }
  }

  console.log(`[guard-tests] checked ${GUARD_TESTS.length} guard test(s).`);

  const problems: string[] = [];
  if (missing.length) {
    problems.push(
      `✖ ${missing.length} guard test(s) MISSING from disk (deleted?):\n` +
        missing.map((m) => `    - ${m}`).join("\n"),
    );
  }
  if (quarantined.length) {
    problems.push(
      `✖ ${quarantined.length} guard test(s) are QUARANTINED in vitest.config.ts exclude:\n` +
        quarantined.map((q) => `    - ${q}`).join("\n") +
        `\n\n  A guard test is a security / data-integrity / AI-safety pin — it may NOT be` +
        `\n  quarantined. Fix the test, don't exclude it. See` +
        `\n  docs/kb/guard-registry.md#guard-check-guard-tests-not-quarantined (audit HF-E).`,
    );
  }

  if (problems.length) {
    console.error("\n" + problems.join("\n\n") + "\n");
    process.exit(1);
  }

  console.log("✔ all guard tests present and running (none quarantined).");
}

main();
