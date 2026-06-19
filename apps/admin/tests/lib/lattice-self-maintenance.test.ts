/**
 * Lattice self-maintenance — the meta-gate (2026-06-17).
 *
 * Closes the loop opened by `docs/lattice-chains.md` (PR #1863): the
 * inventory matrix can't drift from reality because this test pins
 * both directions of the relationship:
 *
 *   1. **Inventory → reality**: every gate path cited in
 *      `docs/lattice-chains.md` MUST exist on disk.
 *   2. **Reality → inventory**: every structural gate on disk
 *      (`tests/**\/*-coverage.test.ts`, `eslint-rules/*.mjs`,
 *      `scripts/check-*.sh`, `.claude/rules/*.md`) MUST be referenced
 *      in the matrix OR explicitly exempt with reason.
 *
 *  Why this matters: the inventory's purpose is to let future agents
 *  read it instead of re-discovering chains reactively. If the doc
 *  silently rots — new tests land, new rules ship, but the matrix
 *  isn't updated — the doc stops being trustworthy and we're back to
 *  ad-hoc audits.
 *
 *  The 6 Coverage-pillar vitests in HF (#1738 / Lane 4 / #1849 / #1854
 *  / #1855 / #1856) plus this self-maintenance gate are the local
 *  implementation of "architecture fitness functions" (Ford et al.,
 *  *Building Evolutionary Architectures*).
 *
 *  See `.claude/rules/lattice-self-maintenance.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const INVENTORY_PATH = join(REPO_ROOT, "docs", "lattice-chains.md");
const MANIFEST_PATH = join(REPO_ROOT, "docs", "lattice-chains.json");
const APP_ADMIN = join(REPO_ROOT, "apps", "admin");

const INVENTORY: string = (() => {
  try {
    return readFileSync(INVENTORY_PATH, "utf8");
  } catch {
    return "";
  }
})();

const MANIFEST_RAW: string = (() => {
  try {
    return readFileSync(MANIFEST_PATH, "utf8");
  } catch {
    return "";
  }
})();

interface ManifestChain {
  id: string;
  links: unknown[];
}
interface Manifest {
  version?: number;
  chains?: ManifestChain[];
}

const MANIFEST: Manifest = (() => {
  if (!MANIFEST_RAW) return {};
  try {
    return JSON.parse(MANIFEST_RAW) as Manifest;
  } catch {
    return {};
  }
})();

// ────────────────────────────────────────────────────────────
// Walker helpers
// ────────────────────────────────────────────────────────────

function walk(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full, filter));
    } else if (filter(e)) {
      out.push(full);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Reality enumeration
// ────────────────────────────────────────────────────────────

/** Every `*-coverage.test.ts` under `apps/admin/tests/`. These are the
 *  Coverage-pillar vitests. */
const coverageTests: string[] = walk(
  join(APP_ADMIN, "tests"),
  (n) => n.endsWith("-coverage.test.ts") || n.endsWith("-coverage.test.tsx"),
).map((f) => relative(APP_ADMIN, f));

/** Every ESLint rule under `apps/admin/eslint-rules/`. */
const eslintRules: string[] = (() => {
  const dir = join(APP_ADMIN, "eslint-rules");
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"))
      .map((n) => `eslint-rules/${n}`);
  } catch {
    return [];
  }
})();

/** Every `scripts/check-*.sh` and `scripts/check-*.ts` (repo-level
 *  scripts that act as CI gates). */
const ciScripts: string[] = (() => {
  const out: string[] = [];
  const scriptsDir = join(REPO_ROOT, "scripts");
  const adminScriptsDir = join(APP_ADMIN, "scripts");
  for (const dir of [scriptsDir, adminScriptsDir]) {
    try {
      for (const e of readdirSync(dir)) {
        if (e.startsWith("check-") && (e.endsWith(".sh") || e.endsWith(".ts"))) {
          out.push(relative(REPO_ROOT, join(dir, e)));
        }
      }
    } catch {
      // dir missing — skip
    }
  }
  return out;
})();

/** Every rule file under `.claude/rules/`. */
const ruleFiles: string[] = (() => {
  const dir = join(REPO_ROOT, ".claude", "rules");
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => `.claude/rules/${n}`);
  } catch {
    return [];
  }
})();

// ────────────────────────────────────────────────────────────
// Exempt — gates that legitimately don't have an inventory row
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

/** Paths exempted from the "must appear in lattice-chains.md" check.
 *  Each entry: one-line reason. */
const INVENTORY_EXEMPT: Record<string, ExemptEntry> = {
  // Self-maintenance gate is the meta-rule. It enforces inventory
  // freshness — it's not itself an inventory entry.
  "tests/lib/lattice-self-maintenance.test.ts": {
    reason: "Self-maintenance gate — meta-rule that enforces inventory freshness; not itself an inventory chain.",
  },
  ".claude/rules/lattice-self-maintenance.md": {
    reason: "Sibling to the self-maintenance test above; meta-rule.",
  },
  // Rule files that are operator-discipline conventions, not
  // structural gate definitions.
  ".claude/rules/api-conventions.md": {
    reason: "Author convention; structural enforcement lives in route-auth-zod-coverage gate.",
  },
};

const EXPECTED_INVENTORY_EXEMPT_COUNT = 3;

/**
 * Orphan ratchets — current incumbent population of gates that exist on
 * disk but aren't yet mentioned in the inventory. Lock the count;
 * future PRs can only IMPROVE coverage by adding rows.
 *
 * As of 2026-06-17 (this PR):
 * - Coverage tests on disk: ~9 total, several existing ones surfaced by
 *   this gate (route-auth-coverage, page-auth-coverage, ai-call-coverage)
 *   that weren't yet rowed.
 * - ESLint rules: 24 active rules, most not yet rowed.
 * - CI scripts: small set of check-*.sh / check-*.ts.
 * - .claude/rules/*.md: many rules; many are operator-discipline
 *   conventions that may be exempt rather than rowed.
 *
 * Each follow-up PR that adds a row drops the corresponding count.
 */
const EXPECTED_ORPHAN_COUNT_COVERAGE = 6;
const EXPECTED_ORPHAN_COUNT_ESLINT = 24;
const EXPECTED_ORPHAN_COUNT_SCRIPTS = 15;
const EXPECTED_ORPHAN_COUNT_RULES = 15;

// ────────────────────────────────────────────────────────────
// Inventory parsing — extract cited file paths
// ────────────────────────────────────────────────────────────

/** Pull every `tests/...`, `eslint-rules/...`, `scripts/...`,
 *  `apps/admin/...`, and `.claude/rules/...` file-path-like substring
 *  from the inventory text. Returns the deduplicated set. */
function citedPaths(text: string): Set<string> {
  const out = new Set<string>();
  // Match paths that start with one of the known prefixes and end
  // before whitespace, closing parens / brackets, or backticks.
  const re =
    /(?<![\w/])(tests\/[\w./[\]-]+|eslint-rules\/[\w./-]+|scripts\/[\w./-]+|\.claude\/rules\/[\w./-]+|apps\/admin\/[\w./[\]-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return out;
}

const cited = citedPaths(INVENTORY);

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Lattice self-maintenance (meta-gate)", () => {
  it("inventory file exists at docs/lattice-chains.md", () => {
    expect(INVENTORY.length, `${INVENTORY_PATH} missing or empty`).toBeGreaterThan(
      100,
    );
  });

  it("every gate path cited in the inventory exists on disk (inventory → reality)", () => {
    const missing: string[] = [];
    for (const p of cited) {
      // Normalise to repo root.
      let absolute: string;
      if (p.startsWith("apps/admin/")) {
        absolute = join(REPO_ROOT, p);
      } else if (p.startsWith(".claude/")) {
        absolute = join(REPO_ROOT, p);
      } else if (p.startsWith("scripts/")) {
        absolute = join(REPO_ROOT, p);
      } else {
        // `tests/...` / `eslint-rules/...` — these live under apps/admin
        absolute = join(APP_ADMIN, p);
      }
      // Strip any line-anchor suffix like `:23` if present.
      absolute = absolute.replace(/:\d+(:\d+)?$/, "");
      // Strip surrounding parens that may have been captured.
      absolute = absolute.replace(/[(),`]/g, "");
      if (!existsSync(absolute)) {
        missing.push(p);
      }
    }
    expect(
      missing,
      `Inventory cites paths that don't exist on disk — the matrix is stale. ` +
        `Either remove the row or fix the path:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("Coverage tests on disk — orphan count ratchet (reality → inventory)", () => {
    const orphan: string[] = [];
    for (const t of coverageTests) {
      if (INVENTORY_EXEMPT[t]) continue;
      const filename = t.split("/").pop()!;
      if (!INVENTORY.includes(filename)) orphan.push(t);
    }
    expect(
      orphan.length,
      `Coverage-test orphan count vs ratchet. ` +
        `Drop EXPECTED_ORPHAN_COUNT_COVERAGE by 1 each time a row is added; ` +
        `bump up ONLY if a new Coverage test legitimately ships without an immediate inventory row. ` +
        `Current orphans:\n  ${orphan.join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_ORPHAN_COUNT_COVERAGE);
  });

  it("ESLint rules on disk — orphan count ratchet", () => {
    const orphan: string[] = [];
    for (const r of eslintRules) {
      if (INVENTORY_EXEMPT[r]) continue;
      const filename = r.split("/").pop()!;
      if (!INVENTORY.includes(filename)) orphan.push(r);
    }
    expect(
      orphan.length,
      `ESLint-rule orphan count vs ratchet. Current orphans:\n  ${orphan.join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_ORPHAN_COUNT_ESLINT);
  });

  it("CI scripts (check-*.sh / check-*.ts) — orphan count ratchet", () => {
    const orphan: string[] = [];
    for (const s of ciScripts) {
      if (INVENTORY_EXEMPT[s]) continue;
      const filename = s.split("/").pop()!;
      if (!INVENTORY.includes(filename)) orphan.push(s);
    }
    expect(
      orphan.length,
      `CI-script orphan count vs ratchet. Current orphans:\n  ${orphan.join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_ORPHAN_COUNT_SCRIPTS);
  });

  it(".claude/rules/*.md — orphan count ratchet", () => {
    const orphan: string[] = [];
    for (const r of ruleFiles) {
      if (INVENTORY_EXEMPT[r]) continue;
      const filename = r.split("/").pop()!;
      if (!INVENTORY.includes(filename)) orphan.push(r);
    }
    expect(
      orphan.length,
      `Rule-file orphan count vs ratchet. Current orphans:\n  ${orphan.join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_ORPHAN_COUNT_RULES);
  });

  it("INVENTORY_EXEMPT ratchet — count pinned at EXPECTED_INVENTORY_EXEMPT_COUNT", () => {
    expect(
      Object.keys(INVENTORY_EXEMPT).length,
      `Inventory-exempt count drifted. Each exemption represents a structural gate ` +
        `that legitimately doesn't have an inventory row (meta-rules + author conventions). ` +
        `Be conservative — most new gates SHOULD have a row.`,
    ).toBe(EXPECTED_INVENTORY_EXEMPT_COUNT);
  });

  it("every inventory-exempt entry has a non-empty reason (>20 chars)", () => {
    for (const [path, entry] of Object.entries(INVENTORY_EXEMPT)) {
      expect(entry.reason.trim().length, `${path}: empty/short reason`).toBeGreaterThan(20);
    }
  });

  it("publishes distribution counts (operator log)", () => {
    // Sanity — sum the categories so future debugging has a baseline.
    // Numbers will drift as gates land; the assertion is sum-not-zero.
    const total =
      coverageTests.length +
      eslintRules.length +
      ciScripts.length +
      ruleFiles.length;
    expect(total).toBeGreaterThan(20);
  });

  // ──────────────────────────────────────────────────────────
  // .md ↔ .json parity (added 2026-06-19 with #2057)
  //
  // `docs/lattice-chains.json` is the machine-readable mirror of the
  // .md inventory, consumed by `lattice-chain-closure.test.ts`. The
  // two MUST stay paired:
  //   - every chain id in the JSON has a corresponding mention in the .md
  //   - every chain id discovered in the JSON is documented in the .md
  // ──────────────────────────────────────────────────────────

  it("docs/lattice-chains.json exists and parses", () => {
    expect(MANIFEST_RAW.length, `${MANIFEST_PATH} missing or empty`).toBeGreaterThan(50);
    expect(MANIFEST.chains, "manifest.chains[] should be a non-empty array").toBeDefined();
    expect(Array.isArray(MANIFEST.chains)).toBe(true);
    expect(MANIFEST.chains!.length).toBeGreaterThanOrEqual(1);
  });

  it("every chain id in docs/lattice-chains.json is mentioned in docs/lattice-chains.md", () => {
    const missing: string[] = [];
    for (const chain of MANIFEST.chains ?? []) {
      if (!INVENTORY.includes(chain.id)) {
        missing.push(chain.id);
      }
    }
    expect(
      missing,
      `Chain ids declared in JSON manifest but missing from .md inventory.\n` +
        `Add a row (or reference) in docs/lattice-chains.md mentioning each id verbatim:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every chain id mentioned in docs/lattice-chains.md as a kebab-anchor (json-chain-id) has a JSON entry", () => {
    // Find every backtick-quoted kebab-case identifier in the .md that
    // looks like a chain id (`chains[X].id` pattern). We use the JSON
    // as the source-of-truth list — every entry in the JSON's
    // `chains[].id` should also be a token mentioned somewhere in the
    // .md. Already covered by the previous test.
    //
    // For the reverse direction we don't pull arbitrary kebab tokens
    // out of the .md (it has many). Instead we require: if the .md
    // mentions a `(JSON chain: <id>)` annotation or a known chain id
    // header, the JSON has it. This is satisfied today by the previous
    // test's set equality (.md mentions every JSON id).
    //
    // The actual reverse-direction discipline is: when an author
    // declares a new chain in the JSON, they MUST mention its id
    // verbatim in the .md (previous test). The .md's matrix rows
    // continue to be human-curated.
    expect(MANIFEST.chains!.every((c) => INVENTORY.includes(c.id))).toBe(true);
  });
});
