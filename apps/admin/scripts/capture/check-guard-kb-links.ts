/**
 * check-guard-kb-links.ts — meta-ratchet for the HF knowledge base.
 *
 * Asserts that every custom ESLint rule points BACK at its row in
 * docs/kb/guard-registry.md via `meta.docs.url`. This is the guard that guards
 * the guards: it keeps the KB load-bearing (a guard fires → the developer is
 * routed to *why* it exists) and stops the wiring from rotting.
 *
 * Ratchet semantics (mirrors scripts/check-ratchet.sh, #227):
 *   - Counts rules MISSING a KB link.
 *   - Fails if the count exceeds MAX_MISSING (the baseline).
 *   - As rules are wired, LOWER MAX_MISSING — it only ever drops, never rises.
 *
 * Run:  npx tsx scripts/capture/check-guard-kb-links.ts   (from apps/admin)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = resolve(SCRIPT_DIR, "../../eslint-rules");
const KB_NEEDLE = "docs/kb/guard-registry.md";

// Baseline: 10 top-level rules, 1 wired (no-ai-fanout-all). Lower as you wire more.
const MAX_MISSING = 9;

function main() {
  const ruleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith(".mjs"));
  const missing: string[] = [];
  const wired: string[] = [];

  for (const file of ruleFiles) {
    const src = readFileSync(join(RULES_DIR, file), "utf8");
    // Look for a docs.url string that targets the guard registry.
    const hasLink = /url:\s*["'`][^"'`]*docs\/kb\/guard-registry\.md/.test(src);
    (hasLink ? wired : missing).push(file);
  }

  console.log(`[guard-kb-links] ${wired.length}/${ruleFiles.length} rules KB-linked.`);
  if (missing.length) {
    console.log(`[guard-kb-links] missing KB link (${missing.length}):`);
    for (const f of missing) console.log(`    - ${f}`);
  }

  if (missing.length > MAX_MISSING) {
    console.error(
      `\n✖ ratchet breach: ${missing.length} rules missing a KB link, baseline is ${MAX_MISSING}.\n` +
        `  Add \`meta.docs.url: "…/${KB_NEEDLE}#guard-<name>"\` to the new rule(s).`,
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
