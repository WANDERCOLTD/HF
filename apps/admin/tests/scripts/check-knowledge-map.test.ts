/**
 * Regression tests for scripts/check-knowledge-map.ts
 *
 * Asserts the ratchet behaves correctly against the live KNOWLEDGE-MAP.md:
 *   1. Current doc passes all hard checks
 *   2. --ci mode exits 0 when clean
 *   3. Bootstrap-safe: missing doc exits 0
 *
 * Issue: #601
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const SCRIPT = path.resolve(__dirname, "../../scripts/check-knowledge-map.ts");
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOC = path.join(REPO_ROOT, "KNOWLEDGE-MAP.md");

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${SCRIPT} ${args.join(" ")}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; status?: number };
    return { stdout: e.stdout?.toString() ?? "", exitCode: e.status ?? 1 };
  }
}

describe("check-knowledge-map", () => {
  it("live KNOWLEDGE-MAP.md passes all hard checks (--json)", () => {
    if (!fs.existsSync(DOC)) {
      return; // bootstrap-safe: skip if doc not present on this branch
    }
    const { stdout, exitCode } = run(["--json"]);
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.docExists).toBe(true);
    expect(report.paths.broken).toEqual([]);
    expect(report.slugs.broken).toEqual([]);
    for (const n of report.numerics) {
      expect(n.withinTolerance).toBe(true);
    }
  });

  it("--ci exits 0 when the live doc is clean", () => {
    if (!fs.existsSync(DOC)) return;
    const { exitCode } = run(["--ci"]);
    expect(exitCode).toBe(0);
  });

  it("bootstrap-safe: exits 0 when KNOWLEDGE-MAP.md is absent", () => {
    if (!fs.existsSync(DOC)) {
      const { exitCode } = run(["--ci"]);
      expect(exitCode).toBe(0);
      return;
    }
    // Temporarily move the doc to verify bootstrap-safe behaviour, then restore.
    const tmp = `${DOC}.test-backup`;
    fs.renameSync(DOC, tmp);
    try {
      const { exitCode, stdout } = run(["--ci"]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/not present/);
    } finally {
      fs.renameSync(tmp, DOC);
    }
  });
});
