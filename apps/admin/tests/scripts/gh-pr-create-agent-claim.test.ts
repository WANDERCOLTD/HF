/**
 * gh-pr-create.sh — agent-report verification gate (2026-06-15).
 *
 * Pins the new negative-claim-without-probe block added to
 * `scripts/gh-pr-create.sh` after the 2026-06-15 session found 8 of 9
 * confidently-asserted agent negatives were wrong. The gate scans the
 * PR body for negative-claim phrases ("X doesn't exist", "no callers",
 * "dead code", etc.) and rejects the PR unless EACH negative line has,
 * within ±3 lines:
 *
 *   - a file:line citation (e.g. `lib/foo.ts:42`)
 *   - or an explicit marker (`[verified]`, `[probed]`, `[inverse-probe:...]`,
 *     `[unverified]`, `[skip-claim-check]`)
 *   - or a `## Verified by` / `## Verification` heading
 *
 * Exit codes:
 *   - 0  → all gates passed; script would have exec'd `gh pr create`
 *          (we intercept via PATH-shim `gh` so the real CLI is never hit)
 *   - 1  → block (`exit 1` after printing the agent-claim error message)
 *
 * Bypass: `--no-agent-claim-check`.
 *
 * Sibling to the existing verify-section gate; both gates share the
 * `--body` / `--body-file` argv-walker. The two are tested independently
 * (this file covers agent-claim; the verify-section gate is covered by
 * its own usage pattern in commit `gh-pr-create.sh` born 2026-06-11).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "..", "..", "..", "..", "scripts", "gh-pr-create.sh");

interface InvokeResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * Invoke the script with a temp PATH-shim that makes `gh` a no-op
 * (`exit 0` so the script's terminal `exec gh pr create ...` doesn't
 * actually hit GitHub). When the gate blocks we never reach the exec
 * line; when it passes we do, and the shim catches us.
 *
 * Uses `spawnSync` (not `execFileSync`) because execFileSync drops
 * stderr on the success path — we need to assert success-banner text
 * appearing in stderr.
 */
function invoke(args: string[], opts: { body?: string } = {}): InvokeResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pr-create-test-"));
  // PATH-shim: a `gh` that exits 0 and ignores all args.
  const ghShim = path.join(tmp, "gh");
  fs.writeFileSync(ghShim, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${tmp}:${process.env.PATH ?? ""}`,
  };

  const fullArgs = [...args];
  if (opts.body !== undefined) {
    fullArgs.push("--body", opts.body);
  }

  const result = spawnSync(SCRIPT, fullArgs, {
    env,
    encoding: "utf-8",
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("gh-pr-create.sh — agent-report verification gate (2026-06-15)", () => {
  it("blocks a body with a bare 'doesn't exist' claim and no probe nearby", () => {
    const body = [
      "## Summary",
      "Refactor the foo helper.",
      "",
      "## Notes",
      "The bar helper doesn't exist anywhere in lib/.",
      "",
      "## Verified by",
      "tests/lib/foo.test.ts → should refactor cleanly",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "refactor: foo helper",
    ], { body });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("negative claim");
    expect(result.stderr).toContain("doesn't exist");
    expect(result.stderr).toContain("agent-report-verification");
  });

  it("passes when the negative claim has a file:line citation within ±3 lines", () => {
    const body = [
      "## Summary",
      "Replace the bar helper with foo.",
      "",
      "## Notes",
      "The bar helper doesn't exist anywhere in lib/.",
      "Probed lib/registry/index.ts:134 — confirmed bar was renamed to foo in #1591.",
      "",
      "## Verified by",
      "tests/lib/foo.test.ts → should refactor cleanly",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "refactor: drop bar helper",
    ], { body });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("agent-report verification gate passed");
  });

  it("passes when the negative claim carries an explicit [verified] marker", () => {
    const body = [
      "## Summary",
      "Drop dead surface.",
      "",
      "## Notes",
      "The baz function has no callers [verified — grep returned zero hits].",
      "",
      "## Verified by",
      "scripts/check-knip-ratchet.ts confirms unused-export count drops by 1.",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "chore: drop dead baz",
    ], { body });
    expect(result.exitCode).toBe(0);
  });

  it("passes when the negative claim is explicitly demoted with [unverified]", () => {
    const body = [
      "## Summary",
      "Investigate.",
      "",
      "## Notes",
      "Background context: the quux store seems dead code [unverified] — flagging for follow-up.",
      "",
      "## Verified by",
      "tests/lib/quux.test.ts → traces existing call sites.",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "chore: investigate quux",
    ], { body });
    expect(result.exitCode).toBe(0);
  });

  it("blocks when one of multiple negatives is unsupported (catches all offenders)", () => {
    const body = [
      "## Summary",
      "Cleanup pass.",
      "",
      "## Notes",
      "Function alpha has no callers [verified — grep -rn alpha lib/ returned zero].",
      "",
      "Function beta doesn't exist in lib/quux.",
      "",
      "Function gamma is dead code [probed lib/registry/index.ts:200].",
      "",
      "## Verified by",
      "scripts/check-knip-ratchet.ts confirms unused-export count drops.",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "chore: cleanup",
    ], { body });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("doesn't exist");
  });

  it("--no-agent-claim-check bypasses the gate with a warning", () => {
    const body = [
      "## Summary",
      "Quick docs-only PR.",
      "",
      "## Notes",
      "The old helper doesn't exist any more.",
      "",
      "## Verified by",
      "tests/lib/foo.test.ts → still green after rename.",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "docs: rename old helper",
      "--no-agent-claim-check",
    ], { body });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("skipping agent-claim verification gate");
  });

  it("a body with no negative-shaped claims passes cleanly (positive-only PR)", () => {
    const body = [
      "## Summary",
      "Adds the foo helper at lib/foo.ts:1.",
      "",
      "## Verified by",
      "tests/lib/foo.test.ts → should add cleanly",
    ].join("\n");
    const result = invoke([
      "--no-verify-section",
      "--title",
      "feat: add foo helper",
    ], { body });
    expect(result.exitCode).toBe(0);
  });

  it("blocks 'not wired' without a citation, passes with file:line nearby", () => {
    const blockedBody = [
      "## Summary",
      "Cleanup.",
      "",
      "## Notes",
      "The thing is not wired into the pipeline.",
      "",
      "## Verified by",
      "tests/lib/pipeline.test.ts → confirms downstream skip.",
    ].join("\n");
    const blocked = invoke(["--no-verify-section", "--title", "chore: clean"], { body: blockedBody });
    expect(blocked.exitCode).toBe(1);

    const passingBody = [
      "## Summary",
      "Cleanup.",
      "",
      "## Notes",
      "The thing is not wired into the pipeline.",
      "Probed apps/admin/lib/pipeline/route.ts:3404 — confirms the stage call.",
      "",
      "## Verified by",
      "tests/lib/pipeline.test.ts → confirms downstream skip.",
    ].join("\n");
    const passing = invoke(["--no-verify-section", "--title", "chore: clean"], { body: passingBody });
    expect(passing.exitCode).toBe(0);
  });
});
