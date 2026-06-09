/**
 * check-eslint-rule-tests.ts — meta-ratchet for custom-ESLint-rule test coverage.
 *
 * Asserts that every custom ESLint rule under `apps/admin/eslint-rules/`
 * (including `hf-voice/*`) has a sibling test file at
 * `tests/eslint-rules/<rule>.test.ts`. Same spirit as
 * `check-guard-kb-links.ts` — make the guard system load-bearing by ensuring
 * its components are verified, not just present.
 *
 * Pairs with `tests/eslint-rules/_helpers.ts::smokeRule()`, which asserts the
 * structural pieces every rule must have (KB back-link, messages, create).
 *
 * Ratchet semantics:
 *   - Counts rules MISSING a sibling test file.
 *   - Fails if the count exceeds MAX_MISSING (the baseline).
 *   - As rules gain tests, LOWER MAX_MISSING — it only ever drops.
 *
 * Run:  npx tsx scripts/capture/check-eslint-rule-tests.ts  (from apps/admin)
 */
import { readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = resolve(SCRIPT_DIR, "../../eslint-rules");
const TESTS_DIR = resolve(SCRIPT_DIR, "../../../../tests/eslint-rules");

// 14 rules currently in play. New rule → must land with a test → keep baseline 0.
const MAX_MISSING = 0;

function collectRules(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const entry of readdirSync(RULES_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      out.push({ name: entry.name.replace(/\.mjs$/, ""), path: `${RULES_DIR}/${entry.name}` });
    } else if (entry.isDirectory()) {
      const subdir = `${RULES_DIR}/${entry.name}`;
      for (const sub of readdirSync(subdir)) {
        if (sub.endsWith(".mjs")) {
          out.push({ name: sub.replace(/\.mjs$/, ""), path: `${subdir}/${sub}` });
        }
      }
    }
  }
  return out;
}

function main() {
  const rules = collectRules();
  const missing: string[] = [];
  const present: string[] = [];

  for (const { name } of rules) {
    const testPath = `${TESTS_DIR}/${name}.test.ts`;
    (existsSync(testPath) ? present : missing).push(name);
  }

  console.log(`[eslint-rule-tests] ${present.length}/${rules.length} rules have sibling tests.`);
  if (missing.length) {
    console.log(`[eslint-rule-tests] missing tests (${missing.length}):`);
    for (const m of missing) console.log(`    - ${m}`);
  }

  if (missing.length > MAX_MISSING) {
    console.error(
      `\n✖ ratchet breach: ${missing.length} rules without tests, baseline is ${MAX_MISSING}.\n` +
        `  Add a sibling test at tests/eslint-rules/<rule>.test.ts.\n` +
        `  Use tests/eslint-rules/_helpers.ts::smokeRule() at minimum.`,
    );
    process.exit(1);
  }
  if (missing.length < MAX_MISSING) {
    console.log(
      `\n✔ ratchet slack: ${missing.length} < baseline ${MAX_MISSING}. Lock the win — drop MAX_MISSING to ${missing.length}.`,
    );
  } else {
    console.log(`\n✔ at baseline (${MAX_MISSING}).`);
  }
}

main();
