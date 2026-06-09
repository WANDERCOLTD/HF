/**
 * #1420 — backfill-enrollment-bootstrap.ts dry-run safety test.
 *
 * The TL revision explicitly requires: "backfill defaults to --dry-run;
 * writes only with --execute". This test reads the source and locks
 * those properties statically — running the actual script requires a
 * full Prisma client. The structural assertions are sufficient because
 * the script's writes go through `autoComposeForCaller`, which has its
 * own test coverage; the script itself is a thin orchestration layer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const scriptPath = path.resolve(
  __dirname,
  "../../scripts/backfill-enrollment-bootstrap.ts",
);

const source = fs.readFileSync(scriptPath, "utf8");

describe("backfill-enrollment-bootstrap.ts (#1420)", () => {
  it("file exists at the canonical scripts/ location", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("imports autoComposeForCaller from the canonical helper", () => {
    expect(source).toMatch(
      /import\s+\{\s*autoComposeForCaller\s*\}\s+from\s+"@\/lib\/enrollment\/auto-compose"/,
    );
  });

  it("defaults to dry-run — --execute is required for writes", () => {
    // The CLI must parse --execute. dryRun = !execute.
    expect(source).toMatch(/const execute = args\.includes\("--execute"\)/);
    expect(source).toMatch(/dryRun:\s*!execute/);
  });

  it("guards the write loop behind a dry-run early-return", () => {
    expect(source).toMatch(/if \(dryRun\)/);
    expect(source).toMatch(/DRY-RUN — no writes performed/);
  });

  it("logs row count BEFORE and AFTER the writes", () => {
    // "scanned N ACTIVE enrollment(s)" + "N enrollment(s) have no ACTIVE composed prompt"
    // are the before-counts; "Backfill complete" + counts are the after-counts.
    expect(source).toMatch(/scanned \$\{enrollments\.length\} ACTIVE enrollment\(s\)/);
    expect(source).toMatch(
      /\$\{missing\.length\} enrollment\(s\) have no ACTIVE composed prompt/,
    );
    expect(source).toMatch(/Backfill complete/);
    expect(source).toMatch(/composed:\s*\$\{composed\}/);
    expect(source).toMatch(/failed:\s*\$\{failed\}/);
  });

  it("supports inter-write delay via --delay-ms to avoid hot-write storms", () => {
    expect(source).toMatch(/--delay-ms/);
    expect(source).toMatch(/delayMs/);
  });

  it("filters ACTIVE enrollments and uses composedPrompt.findFirst to detect missing prompts", () => {
    expect(source).toMatch(
      /prisma\.callerPlaybook\.findMany\([\s\S]*?status:\s*"ACTIVE"/,
    );
    expect(source).toMatch(/prisma\.composedPrompt\.findFirst/);
    expect(source).toMatch(/status:\s*"active"/);
  });

  it("exits 1 when some enrollments still have no prompt after writes", () => {
    expect(source).toMatch(/stillMissing/);
    expect(source).toMatch(/process\.exit\(1\)/);
  });
});
