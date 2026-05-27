/**
 * Smoke test for the #910 authoring-side cascade-read-bypass counter
 * in scripts/audit-epic-100.ts.
 *
 * The audit script connects to Prisma at module load, so running it
 * end-to-end requires a live DB. This test instead:
 *   1. Pins the counter's registration (key, story, kind, target).
 *   2. Exercises the static-grep logic in isolation against a controlled
 *      tmpdir of fake component files — so the rule is testable without
 *      Prisma or the real components tree.
 *   3. Pins the empirical expectation against the real components dir:
 *      today exactly 1 file (PromptTunerSidebar.tsx) violates. #911 drives
 *      this to 0.
 *
 * Belongs to: chain-contracts Link 3a (docs/CHAIN-CONTRACTS.md) +
 *             arch-checker Check F (.claude/agents/arch-checker.md).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/audit-epic-100.ts");
const COMPONENTS_DIR = path.resolve(__dirname, "../../components");

const PLAYBOOK_TARGETS_PATTERN = /\/api\/playbooks\/[^\s"'`]*\/targets/;
const CALLER_BEH_TARGETS_PATTERN =
  /\/api\/callers\/[^\s"'`]*\/(behavior-targets|effective-behavior-targets)/;
const RESOLVER_IMPORT_PATTERNS = [
  /from\s+["']@\/lib\/tolerance\/resolve-tolerance["']/,
  /from\s+["']@\/lib\/tolerance\/getEffectiveBehaviorTargetsForCaller["']/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

function countBypasses(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const file of walk(dir)) {
    const contents = fs.readFileSync(file, "utf8");
    const hasPlaybookTargets = PLAYBOOK_TARGETS_PATTERN.test(contents);
    const hasCallerBehTargets = CALLER_BEH_TARGETS_PATTERN.test(contents);
    if (!hasPlaybookTargets || !hasCallerBehTargets) continue;
    const importsResolver = RESOLVER_IMPORT_PATTERNS.some((p) => p.test(contents));
    if (importsResolver) continue;
    count++;
  }
  return count;
}

describe("audit-epic-100 — authoringBehTargetBypassCount counter (#910)", () => {
  it("is registered in the audit script with the documented metadata", () => {
    const src = fs.readFileSync(SCRIPT_PATH, "utf8");
    expect(src).toContain('key: "authoringBehTargetBypassCount"');
    expect(src).toContain('story: "#910"');
    // Must be invariant (blocks CI), not informational.
    expect(src).toMatch(
      /key:\s*"authoringBehTargetBypassCount"[\s\S]*?kind:\s*"invariant"/,
    );
    expect(src).toMatch(/key:\s*"authoringBehTargetBypassCount"[\s\S]*?target:\s*0/);
  });

  it("flags a file that fetches both playbook targets AND caller behavior-targets without the resolver import", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bypass-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "Bypass.tsx"),
        `
          const a = await fetch(\`/api/playbooks/\${id}/targets\`);
          const b = await fetch(\`/api/callers/\${cid}/behavior-targets\`);
        `,
      );
      expect(countBypasses(tmp)).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does NOT flag a file that imports the canonical resolver", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bypass-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "Compliant.tsx"),
        `
          import { resolveCallerBehaviorTarget } from "@/lib/tolerance/resolve-tolerance";
          const a = await fetch(\`/api/playbooks/\${id}/targets\`);
          const b = await fetch(\`/api/callers/\${cid}/behavior-targets\`);
        `,
      );
      expect(countBypasses(tmp)).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does NOT flag a file that imports the bulk wrapper (landing in #911)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bypass-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "PostFix.tsx"),
        `
          import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";
          const a = await fetch(\`/api/playbooks/\${id}/targets\`);
          const b = await fetch(\`/api/callers/\${cid}/effective-behavior-targets\`);
        `,
      );
      expect(countBypasses(tmp)).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does NOT flag a file that only fetches one of the two endpoints", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bypass-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "PlaybookOnly.tsx"),
        `const a = await fetch(\`/api/playbooks/\${id}/targets\`);`,
      );
      fs.writeFileSync(
        path.join(tmp, "CallerOnly.tsx"),
        `const b = await fetch(\`/api/callers/\${cid}/behavior-targets\`);`,
      );
      expect(countBypasses(tmp)).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports exactly 1 violation in the real components tree today (PromptTunerSidebar) — #911 drives this to 0", () => {
    // Empirical anchor: #910 is the contract PR, #911 is the fix PR.
    // If this number changes unexpectedly, look at what new component
    // dual-fetched or what change moved the existing violation —
    // either way, the chain contract needs attention.
    const count = countBypasses(COMPONENTS_DIR);
    expect(count).toBe(1);
  });
});
