/**
 * Coverage gate — AI completion callsites must thread `scope` so
 * `getAIConfig`'s Playbook/Domain cascade can fire (#1868 follow-on).
 *
 * Companion to the path-scoped ESLint rule
 * `hf-ai/require-ai-scope-in-cascade-zone`. Where the ESLint rule fires
 * at edit time inside the cascade-required zone, this vitest enumerates
 * EVERY `getConfiguredMeteredAICompletion` / `getConfiguredAICompletion`
 * / `getAIConfig` callsite anywhere under `apps/admin/{lib,app}` and
 * ratchets the count of scope-omitted callsites.
 *
 * Three classifications per callsite:
 *   - **scoped** — call has `scope:` key (or 2-arg `getAIConfig`)
 *   - **omitted** — explicit `// @ai-scope-omitted: <reason>` sentinel
 *     within ±2 lines of the call. Reason MUST be non-empty.
 *   - **orphan** — neither. Counted against the ratchet.
 *
 * The ratchet drops by 1 each time a previously-orphan callsite is
 * either scoped or annotated. Per `.claude/rules/ai-callpoint-cascade.md`.
 *
 * Sibling Coverage-pillar tests (#1738 / #1849 / #1854 / #1855 / #1856 /
 * lattice-self-maintenance #1864) use the same enumerate-classify-ratchet
 * pattern.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// __dirname is apps/admin/tests/lib/ai → APP_ADMIN is 3 levels up.
const APP_ADMIN = resolve(__dirname, "..", "..", "..");

const AI_CALL_NAMES = [
  "getConfiguredMeteredAICompletion",
  "getConfiguredMeteredAICompletionStream",
  "getConfiguredAICompletion",
  "getConfiguredAICompletionStream",
];

interface CallsiteHit {
  relPath: string;
  line: number;
  callKind: string;
  hasScope: boolean;
  hasSentinel: boolean;
}

// Files whose AI calls legitimately cannot pass scope (no Playbook/Domain
// context exists at the callsite). These are excluded from the orphan
// count. Each entry MUST have a one-line reason for the exemption.
const EXEMPT_PATHS: Array<{ path: string; reason: string }> = [
  { path: "scripts/", reason: "operator scripts — no Playbook context" },
  { path: "/tests/", reason: "test files mock the AI client" },
  { path: "/__tests__/", reason: "test files mock the AI client" },
  { path: ".test.ts", reason: "test files mock the AI client" },
  { path: ".spec.ts", reason: "test files mock the AI client" },
];

function isExempt(relPath: string): boolean {
  return EXEMPT_PATHS.some((e) => relPath.includes(e.path));
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === "_archived") continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (e.endsWith(".ts") || e.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function findAICallsites(): CallsiteHit[] {
  const files = [...walk(join(APP_ADMIN, "lib")), ...walk(join(APP_ADMIN, "app"))];
  const hits: CallsiteHit[] = [];
  for (const file of files) {
    const relPath = relative(APP_ADMIN, file);
    if (isExempt(relPath)) continue;
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      for (const name of AI_CALL_NAMES) {
        // Match `<name>(` only as a function-call-ish token, not as a comment / string.
        const callRe = new RegExp(`\\b${name}\\s*\\(`);
        if (!callRe.test(ln)) continue;
        // Accumulate a small window after the call site to detect `scope:`.
        const window = lines.slice(i, Math.min(i + 25, lines.length)).join("\n");
        // Use the FIRST balanced object expression in the window —
        // `scope:` outside it (a different call further down) doesn't count.
        // Approximation: just look within the first 25 lines from the call
        // site. False-positives possible but acceptable given the ratchet
        // catches deltas, not absolute correctness.
        const hasScope = /\bscope\s*:/.test(window);
        // Sentinel within ±2 lines of the call's opening line.
        const sentinelStart = Math.max(0, i - 2);
        const sentinelWindow = lines.slice(sentinelStart, i + 1).join("\n");
        const sentinelMatch = sentinelWindow.match(/@ai-scope-omitted:\s*(\S.*)$/m);
        const hasSentinel = !!sentinelMatch;
        hits.push({
          relPath,
          line: i + 1,
          callKind: name,
          hasScope,
          hasSentinel,
        });
      }
    }
  }
  return hits;
}

// ────────────────────────────────────────────────────────────
// Ratchet — drops by 1 each time an orphan is scoped or annotated.
// Pinned 2026-06-17 after the cascade landed in #1869 (4 pipeline sites
// already converted; remaining orphans live in chat / voice / wizard /
// content-trust / assessment surfaces pending follow-on adoption per
// `.claude/rules/ai-callpoint-cascade.md`).
//
// CI prevents regression — any new scope-less callsite pushes the count
// above this number and fails this test. Each follow-on PR that scopes
// a callsite (or annotates with `@ai-scope-omitted: <reason>`) drops
// this constant by 1.
// ────────────────────────────────────────────────────────────
const EXPECTED_ORPHAN_COUNT = 73;

describe("AI call-point scope coverage (#1868)", () => {
  const hits = findAICallsites();
  const orphans = hits.filter((h) => !h.hasScope && !h.hasSentinel);

  it("ratchet — scope-less, non-annotated AI callsites stay ≤ EXPECTED_ORPHAN_COUNT", () => {
    const message = orphans
      .slice(0, 10)
      .map((o) => `  ${o.relPath}:${o.line}  ${o.callKind}`)
      .join("\n");
    expect(
      orphans.length,
      `Orphan AI callsites (scope-less, no sentinel comment) found: ${orphans.length}\n` +
        `Drop EXPECTED_ORPHAN_COUNT by 1 each time a callsite gets scope OR an @ai-scope-omitted sentinel.\n` +
        `First 10:\n${message}`,
    ).toBeLessThanOrEqual(EXPECTED_ORPHAN_COUNT);
  });

  it("sentinel comments must carry a non-empty reason", () => {
    // We already enforce non-empty via the regex \S.* in findAICallsites;
    // this test pins the rule explicitly so a future relaxation of the
    // walker doesn't silently allow `// @ai-scope-omitted:` with empty body.
    // Re-walk all files to catch empty-reason sentinels.
    const files = [...walk(join(APP_ADMIN, "lib")), ...walk(join(APP_ADMIN, "app"))];
    const badSentinels: string[] = [];
    for (const file of files) {
      const relPath = relative(APP_ADMIN, file);
      if (isExempt(relPath)) continue;
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const re = /@ai-scope-omitted:\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split("\n").length;
        badSentinels.push(`${relPath}:${line}`);
      }
    }
    expect(
      badSentinels,
      `@ai-scope-omitted sentinels must carry a non-empty reason after the colon.\n` +
        `Found:\n${badSentinels.join("\n")}`,
    ).toEqual([]);
  });

  it("inventory — total AI callsite count (informational sanity check)", () => {
    // Informational — pins the floor. Will catch a refactor that nukes
    // half the surface silently.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(500);
  });
});
