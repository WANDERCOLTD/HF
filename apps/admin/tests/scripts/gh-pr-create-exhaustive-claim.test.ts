/**
 * gh-pr-create.sh — exhaustive-claim scope gate (2026-09-24).
 *
 * Sibling to the agent-claim gate. That one catches claims that something
 * does NOT exist. This one catches the different shape that slipped past it
 * three times in a single session: claims of COMPLETENESS over a set, and
 * claims that one change SUPERSEDES another.
 *
 * The three that shipped in PR bodies and were all wrong:
 *
 *   "the only failing check is the unrelated audit backlog"
 *      -> the failure was caused by that PR
 *   "superseded by #2323, safe to drop"
 *      -> 2 of 4 caller-creation paths were still exposed
 *   "the remaining 121 have no importer, no executor and no package.json script"
 *      -> six executor references existed
 *
 * Each HAD been checked. None had been checked exhaustively. The defect was
 * never the verification — it was describing a partial sweep as a complete
 * one. Independent review caught all three; CI caught none of them.
 *
 * So a `file:line` citation deliberately does NOT satisfy this gate —
 * pointing at one file is precisely the partial check. The satisfying
 * markers are the SCOPE of the sweep, an independent reviewer, or an honest
 * demotion:
 *
 *   [scope: ...] / [swept: ...] / "surfaces searched"
 *   [reviewed-by: ...] / "independently verified|re-derived|reviewed"
 *   [unverified] / [skip-claim-check]
 *
 * Bypass: `--no-agent-claim-check` (shared with the sibling gate).
 *
 * See `.claude/rules/exhaustive-claim-scope.md`.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "..", "..", "..", "..", "scripts", "gh-pr-create.sh");

function invoke(body: string, extraArgs: string[] = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pr-exh-test-"));
  const ghShim = path.join(tmp, "gh");
  fs.writeFileSync(ghShim, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const result = spawnSync(
    SCRIPT,
    ["--title", "t", ...extraArgs, "--body", body],
    {
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ""}` },
      encoding: "utf-8",
    },
  );
  return { exitCode: result.status ?? -1, stderr: result.stderr ?? "" };
}

/** Satisfies the SIBLING verify-before-fix gate so we isolate this one. */
const VERIFIED = "\n\n## Verified by\n\ntests/scripts/foo.test.ts passes.\n";

describe("gh-pr-create exhaustive-claim scope gate", () => {
  describe("blocks the three real failures verbatim", () => {
    it("blocks an 'only failing check' claim", () => {
      const r = invoke(
        "KB Integrity fails on all three for the same unrelated reason.\n" +
          "The only failing check is the npm audit backlog, which predates this." +
          VERIFIED,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/completeness or supersession without stating scope/);
    });

    it("blocks a 'superseded' claim", () => {
      const r = invoke(
        "The resolver commit is superseded by main's #2323 and dropped." + VERIFIED,
      );
      expect(r.exitCode).toBe(1);
    });

    it("blocks a 'the remaining N have no ...' claim", () => {
      const r = invoke(
        "Two real hits surfaced.\n" +
          "The remaining 121 have no importer, no executor and no package.json script." +
          VERIFIED,
      );
      expect(r.exitCode).toBe(1);
    });
  });

  describe("passes when the claim carries its scope", () => {
    it("accepts an explicit [scope: ...] marker", () => {
      const r = invoke(
        "The remaining 121 have no importer.\n" +
          "[scope: apps/admin/lib apps/admin/app apps/admin/scripts apps/foh package.json]" +
          VERIFIED,
      );
      expect(r.exitCode).toBe(0);
    });

    it("accepts an independent reviewer citation", () => {
      const r = invoke(
        "Superseded by #2323.\n[reviewed-by: pr-reviewer, independently re-derived]" + VERIFIED,
      );
      expect(r.exitCode).toBe(0);
    });

    it("accepts prose naming the surfaces searched", () => {
      const r = invoke(
        "Nothing else references it.\n" +
          "Surfaces searched: workflows, Dockerfiles, cloudbuild, .claude/**" +
          VERIFIED,
      );
      expect(r.exitCode).toBe(0);
    });

    it("accepts an honest [unverified] demotion", () => {
      const r = invoke("The only failing check is the audit backlog. [unverified]" + VERIFIED);
      expect(r.exitCode).toBe(0);
    });
  });

  it("a bare file:line does NOT satisfy it — that is the partial check", () => {
    const r = invoke(
      "Superseded by #2323 — see lib/curriculum/resolve-default-module.ts:61." + VERIFIED,
    );
    expect(r.exitCode).toBe(1);
  });

  it("narrowed wording passes without any marker", () => {
    const r = invoke("No importer in lib/ or app/ — other surfaces not swept." + VERIFIED);
    expect(r.exitCode).toBe(0);
  });

  it("does not fire on an ordinary PR body", () => {
    const r = invoke("Adds a helper and a test. Fixes the FK delete order." + VERIFIED);
    expect(r.exitCode).toBe(0);
  });

  it("--no-agent-claim-check bypasses it", () => {
    const r = invoke(
      "Superseded by #2323, safe to drop." + VERIFIED,
      ["--no-agent-claim-check"],
    );
    expect(r.exitCode).toBe(0);
  });
});
