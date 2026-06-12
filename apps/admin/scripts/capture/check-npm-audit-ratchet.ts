/**
 * check-npm-audit-ratchet.ts — monotonic ratchet for `npm audit` high+critical.
 *
 * Reads `npm audit --json` and counts vulnerabilities with severity `high` or
 * `critical`. Compares to baseline `npm_audit_high_crit` in `.ratchet.json`.
 * Fails if the count rises above baseline. Mirrors the spirit of
 * `check-knip-ratchet.ts` (HF-H) — informational at first, then dropped to a
 * blocking gate via `npm run kb:check`.
 *
 * Audit HF-N (2026-06-12). After the non-force npm audit fix dropped 65 → 16
 * vulnerabilities (5 high + 1 critical), the baseline locks the win and
 * prevents the next dependency bump from quietly reintroducing a regression.
 *
 * Run:  npx tsx scripts/capture/check-npm-audit-ratchet.ts  (from apps/admin)
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// .ratchet.json lives at the REPO root (siblings: apps/, .ratchet.json) — same
// path other ratchet scripts (check-knip-ratchet.ts) use.
const RATCHET_PATH = resolve(SCRIPT_DIR, "../../../../.ratchet.json");

interface RatchetJson {
  npm_audit_high_crit?: number;
  [k: string]: unknown;
}

function readBaseline(): number {
  try {
    const j = JSON.parse(readFileSync(RATCHET_PATH, "utf-8")) as RatchetJson;
    return typeof j.npm_audit_high_crit === "number" ? j.npm_audit_high_crit : 0;
  } catch {
    return 0;
  }
}

function runAuditJson(): unknown {
  // `npm audit --json` exits non-zero when vulns exist — `|| true` would lose
  // stderr; allow non-zero and parse stdout regardless.
  let stdout = "";
  try {
    stdout = execSync("npm audit --json", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" });
  } catch (e: unknown) {
    // npm exits non-zero when there are vulnerabilities; stdout still has the JSON.
    const err = e as { stdout?: Buffer | string };
    stdout = err.stdout?.toString() ?? "";
  }
  if (!stdout) {
    console.error("[npm-audit-ratchet] no stdout from `npm audit --json`");
    process.exit(1);
  }
  return JSON.parse(stdout);
}

function countHighCrit(audit: unknown): number {
  const vulns = (audit as { vulnerabilities?: Record<string, { severity?: string }> }).vulnerabilities ?? {};
  let n = 0;
  for (const info of Object.values(vulns)) {
    if (info.severity === "high" || info.severity === "critical") n++;
  }
  return n;
}

function main() {
  const audit = runAuditJson();
  const count = countHighCrit(audit);
  const baseline = readBaseline();

  console.log(`[npm-audit-ratchet] high+critical vulns: ${count} (baseline ${baseline}).`);

  if (count > baseline) {
    console.error(
      `\n✖ npm audit high+critical count rose: ${count} > baseline ${baseline}.\n` +
      `   Cause: a recent dependency bump introduced a vulnerable version.\n` +
      `   Fix: run \`npm audit\` to see which packages, then either:\n` +
      `     - \`npm audit fix\` (non-force; safe within ranges)\n` +
      `     - \`npm audit fix --force\` (major bumps; tested before commit)\n` +
      `     - update a direct dep that pulls in the vulnerable transitive\n` +
      `   Do NOT raise the baseline to mask the regression.\n`,
    );
    process.exit(1);
  }

  if (count < baseline) {
    console.log(
      `ℹ Win available: count dropped from ${baseline} → ${count}. Update ` +
      `.ratchet.json's \`npm_audit_high_crit\` to ${count} to lock it.`,
    );
  } else {
    console.log("✔ at baseline.");
  }
}

main();
