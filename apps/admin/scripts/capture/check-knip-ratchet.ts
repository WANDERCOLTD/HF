/**
 * check-knip-ratchet.ts — dead-code ratchet (audit HF-H).
 *
 * `knip` is configured (`knip.json`) and runs in CI, but only as an informational
 * (`continue-on-error: true`) step — so dead code can accumulate unchecked. This guard
 * turns it into a monotonic ratchet, same spirit as `.ratchet.json`'s tsc/lint caps: the
 * count of unused EXPORTS + unused TYPES (the source-only dead-code signal) may only DROP,
 * never rise. Unlisted/dependency findings are excluded — those depend on package.json
 * resolution and are noisier across environments.
 *
 * Baseline lives in `.ratchet.json` as `knip_unused`. When you delete dead code and the
 * count drops, lower the baseline (lock the win).
 *
 * Run:  npx tsx scripts/capture/check-knip-ratchet.ts   (from apps/admin)
 * Wired into `npm run kb:check`.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "../..");
const RATCHET_PATH = resolve(APP_DIR, "../../.ratchet.json");

function measureKnip(): number {
  let raw = "";
  try {
    raw = execSync("npx knip --reporter=json", { cwd: APP_DIR, encoding: "utf8" });
  } catch (e: any) {
    // knip exits non-zero when it finds issues — that's expected; capture stdout.
    raw = e.stdout ?? "";
  }
  if (!raw.trim()) {
    console.error("[knip-ratchet] knip produced no output — treating as a hard failure.");
    process.exit(1);
  }
  const k = JSON.parse(raw);
  let count = 0;
  for (const f of k.issues ?? []) {
    count += f.exports ? Object.keys(f.exports).length : 0;
    count += f.types ? Object.keys(f.types).length : 0;
  }
  return count;
}

function main() {
  const baseline: number = JSON.parse(readFileSync(RATCHET_PATH, "utf8")).knip_unused ?? Infinity;
  const measured = measureKnip();

  console.log(`[knip-ratchet] unused exports+types: ${measured} (baseline ${baseline}).`);

  if (measured > baseline) {
    console.error(
      `\n✖ ratchet breach: dead code rose ${measured} > baseline ${baseline} (+${measured - baseline}).\n` +
        `  Delete the new unused export(s)/type(s), or — if intentionally public API —\n` +
        `  add to knip.json's ignore. Dead code only drops. See guard-registry.md.\n`,
    );
    process.exit(1);
  }

  if (measured < baseline) {
    console.log(
      `✔ ratchet slack: ${measured} < baseline ${baseline}. Lock the win — set ` +
        `knip_unused to ${measured} in .ratchet.json.`,
    );
  } else {
    console.log(`✔ at baseline (${baseline}).`);
  }
}

main();
