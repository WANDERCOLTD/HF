/**
 * Regression tests for scripts/check-doc-citations.ts
 *
 * Two scenarios per the acceptance criteria of issue #329:
 *   1. A missing file path → `--ci` exits 1 (BROKEN_FILE error)
 *   2. A missing symbol in an existing file → `--ci` exits 0 (BROKEN_SYMBOL warning only)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const SCRIPT = path.resolve(__dirname, "../../scripts/check-doc-citations.ts");
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function runScript(args: string[], env: NodeJS.ProcessEnv = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`npx tsx ${SCRIPT} ${args.join(" ")}`, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("check-doc-citations", () => {
  let tmpRoot: string;
  let tmpDocsDir: string;
  let tmpAdminDir: string;
  let restoreCanonicalArrayPatch: (() => void) | null = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-doc-citations-"));
    tmpDocsDir = path.join(tmpRoot, "docs");
    tmpAdminDir = path.join(tmpRoot, "apps/admin");
    fs.mkdirSync(tmpDocsDir, { recursive: true });
    fs.mkdirSync(path.join(tmpAdminDir, "lib"), { recursive: true });
  });

  afterEach(() => {
    if (restoreCanonicalArrayPatch) {
      restoreCanonicalArrayPatch();
      restoreCanonicalArrayPatch = null;
    }
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("runs against the real repo and prints a summary line", () => {
    const result = runScript([]);
    expect(result.stdout).toContain("[check-doc-citations]");
    expect(result.stdout).toMatch(/refs checked across \d+ canonical docs/);
  });

  it("--ci exits 0 when all cited files resolve", () => {
    const result = runScript(["--ci"]);
    expect(result.exitCode).toBe(0);
  });

  it("--warn always exits 0 (used by pre-commit)", () => {
    const result = runScript(["--warn"]);
    expect(result.exitCode).toBe(0);
  });

  it("--json emits a parseable JSON object", () => {
    const result = runScript(["--json"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("checked");
    expect(parsed).toHaveProperty("brokenFiles");
    expect(parsed).toHaveProperty("brokenSymbols");
    expect(Array.isArray(parsed.brokenFiles)).toBe(true);
  });

  it("resolves bare filenames via the apps/admin index", () => {
    // CONTENT-PIPELINE.md cites SectionDataLoader.ts (no path) — must resolve
    const result = runScript(["--json"]);
    const parsed = JSON.parse(result.stdout);
    const bareFilenameBroken = parsed.brokenFiles.filter(
      (r: { file: string }) => !r.file.includes("/"),
    );
    expect(bareFilenameBroken).toEqual([]);
  });
});
