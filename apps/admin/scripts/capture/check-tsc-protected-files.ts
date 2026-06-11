/**
 * check-tsc-protected-files.ts — per-file tsc zero-tolerance for guard-bearing files.
 *
 * Audit HF-G. The global `tsc_errors` ratchet (`.ratchet.json`, currently 190) only stops
 * the count RISING — it happily carries a large baseline. That baseline hid a real
 * silent-config-bypass bug: `ContractRegistry.get(...)` (a nonexistent method) sat inside
 * the 190 as a TS2339, swallowed by a try/catch, so tuned SKILL_MEASURE_V1 config never
 * loaded (audit HF-A).
 *
 * This guard adds a tighter ring: a hand-picked set of GUARD-BEARING files must have ZERO
 * tsc errors, independent of the global baseline. A new type error in any of them fails CI
 * immediately — it can't hide in the 190. As the global baseline burns down, MIGRATE more
 * files into this list (it only ever grows).
 *
 * Run:  npx tsx scripts/capture/check-tsc-protected-files.ts   (from apps/admin)
 * Wired into `npm run kb:check`.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "../..");

/** Guard-bearing files that MUST stay tsc-clean regardless of the global baseline. */
const PROTECTED_FILES = [
  "lib/contracts/registry.ts", // the DataContract API whose misuse caused HF-A
  "lib/goals/track-progress.ts", // HF-A: SKILL_MEASURE_V1 tier resolution
  "lib/pipeline/aggregate-runner.ts", // HF-A: EMA config resolution
  "lib/curriculum/resolve-module.ts", // #407 slug-scoping guard
  "lib/voice/create-session.ts", // #1342 session builder
  "lib/voice/end-session.ts", // #1342 session terminator
  "lib/learner-scope.ts", // #977 STUDENT cross-caller PII guard
  "lib/voice/providers/retell/auth.ts", // HF-C webhook verifier
  "lib/voice/providers/vapi/auth.ts", // VAPI webhook verifier
];

function main() {
  let rawTsc = "";
  try {
    rawTsc = execSync("npx tsc --noEmit", { cwd: APP_DIR, encoding: "utf8" });
  } catch (e: any) {
    // tsc exits non-zero when there are errors — that's expected; capture stdout.
    rawTsc = (e.stdout ?? "") + (e.stderr ?? "");
  }

  // Lines like: lib/foo/bar.ts(123,4): error TS2339: ...
  const errorFiles = new Set<string>();
  for (const line of rawTsc.split("\n")) {
    const m = line.match(/^(.+?\.tsx?)\(\d+,\d+\):\s+error\s+TS\d+/);
    if (m) errorFiles.add(m[1].replace(/^\.\//, ""));
  }

  const breached = PROTECTED_FILES.filter((f) => errorFiles.has(f));

  console.log(`[tsc-protected] checked ${PROTECTED_FILES.length} guard-bearing file(s).`);

  if (breached.length) {
    console.error(
      `\n✖ ${breached.length} PROTECTED file(s) have tsc errors (must be ZERO, independent of` +
        `\n  the global ratchet):\n` +
        breached.map((f) => `    - ${f}`).join("\n") +
        `\n\n  These files carry guards; a type error here can silently disable a guard (the` +
        `\n  HF-A ContractRegistry.get fingerprint). Fix the error — do not let it hide in the` +
        `\n  190 baseline. See docs/kb/guard-registry.md#guard-check-tsc-protected-files.\n`,
    );
    process.exit(1);
  }

  console.log("✔ all protected guard-bearing files are tsc-clean.");
}

main();
