/**
 * FOH Coverage — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every `AuthoredModuleMode` value in `apps/admin/lib/types/json-fields.ts`
 *  MUST have a learner-facing UI consumer inside the FOH workspace
 *  (`apps/foh/app/**` + `apps/foh/components/**`):
 *    - `covered` — a FOH source file references the mode value either
 *      via a future `resolveLearnerShell` helper call OR an explicit
 *      `mode === "<value>"` / `.mode === "<value>"` branch.
 *    - `exempt` — the mode is intentionally rendered by the default
 *      chat-feed shell (tutor / mixed / intake fallback); no FOH-
 *      specific consumer needed at v1.
 *    - `gap` — no consumer found; the learner experiences identical
 *      chat regardless of mode. Frozen at incumbent count via the
 *      `EXPECTED_GAP_COUNT` ratchet.
 *
 *  Today (2026-06-20 baseline) `apps/foh/app/sim/page.tsx` is plain
 *  chat regardless of `AuthoredModuleMode`. All 5 modes classify as
 *  `gap`. This test freezes that state so any future mode addition
 *  has to consciously join the gap list (and a future PR that wires
 *  even one mode drops the ratchet).
 *
 *  Sibling to `tests/lib/sim-chat/mode-ui-coverage.test.ts` (#2144)
 *  — that test pins the broader 3-axis matrix (teaching / adminUI /
 *  learnerUI) across `components/sim` + `app/x/student` + FOH dirs.
 *  This FOH-focused test narrows to the FOH workspace alone so the
 *  Learner gap L3 from #2185 is structurally tracked even as the
 *  `mode-ui-coverage` matrix evolves.
 *
 *  See `.claude/rules/foh-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Canonical mode set — verified against the source type union
// at test runtime so a new union value forces a matrix update.
// ────────────────────────────────────────────────────────────

const AUTHORED_MODULE_MODE_VALUES = [
  "examiner",
  "tutor",
  "mixed",
  "quiz",
  "mock-exam",
] as const;

type AuthoredModuleMode = (typeof AUTHORED_MODULE_MODE_VALUES)[number];

const REPO_ADMIN = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(REPO_ADMIN, "..", "..");

const TYPE_SOURCE_PATH = join(
  REPO_ADMIN,
  "lib",
  "types",
  "json-fields.ts",
);

// ────────────────────────────────────────────────────────────
// FOH consumer directories — read-only walk. The FOH workspace
// is a separate Next.js app; this admin-tree test walks the FOH
// source files via relative paths so coverage tracks across both
// workspaces.
// ────────────────────────────────────────────────────────────

const FOH_DIRS: string[] = [
  join(REPO_ROOT, "apps", "foh", "app"),
  join(REPO_ROOT, "apps", "foh", "components"),
];

// ────────────────────────────────────────────────────────────
// Exempt list — modes that legitimately render through the
// default chat-feed shell at v1. Required: one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const FOH_MODE_EXEMPT: Partial<Record<AuthoredModuleMode, ExemptEntry>> = {};

/** Ratchet — only goes DOWN as gaps close, never UP without a bump. */
const EXPECTED_EXEMPT_COUNT = 0;

/** Ratchet — FOH UI consumer gaps frozen at incumbent count. Drops as
 *  gaps close. Today's incumbents: all 5 modes are gaps — `apps/foh/app/sim/page.tsx`
 *  is mode-unaware (plain chat regardless of `AuthoredModule.mode`).
 *  When the first mode-aware FOH render path lands (e.g. a `quiz`
 *  variant or a `resolveLearnerShell` dispatch), drop this by one. */
const EXPECTED_GAP_COUNT = 5;

// ────────────────────────────────────────────────────────────
// Source-walk + classification
// ────────────────────────────────────────────────────────────

function walkSource(dir: string): string[] {
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
      if (e === "node_modules" || e === "__tests__" || e === ".next") continue;
      out.push(...walkSource(full));
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function concatFohSource(): string {
  const files: string[] = [];
  for (const dir of FOH_DIRS) {
    files.push(...walkSource(dir));
  }
  return files
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

// Pre-compute once per test run.
const FOH_SOURCE: string = concatFohSource();

/** Detect a FOH consumer of the given mode. Two acceptable shapes:
 *
 *    1. `resolveLearnerShell(...)` — future dispatch helper. If any FOH
 *       file calls `resolveLearnerShell`, every mode value classifies
 *       as covered (the dispatcher OWNS the per-mode branching; we
 *       trust it the same way `mode-ui-coverage.test.ts` trusts
 *       per-axis dispatcher helpers).
 *    2. `.mode === "X"` / `mode === "X"` (and `!==` variants) — direct
 *       literal comparison.
 *
 *  Switch-case branches (`case "X":`) are deliberately NOT matched —
 *  they may legitimately exist for unrelated string literals (Audience,
 *  Triage, etc.). Cases that ARE valid mode-keyed switches should
 *  rewrite to `===` checks or exempt the cell with a one-line reason.
 */
function modeIsConsumed(mode: AuthoredModuleMode, source: string): boolean {
  if (/\bresolveLearnerShell\s*\(/.test(source)) return true;
  const esc = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:\\.\\s*mode\\s*[!=]==\\s*["']${esc}["'])|(?:\\bmode\\s*[!=]==\\s*["']${esc}["'])`,
    "m",
  );
  return re.test(source);
}

type Classification = "covered" | "exempt" | "gap";

interface ModeResult {
  mode: AuthoredModuleMode;
  classification: Classification;
  reason?: string;
}

function classifyMode(mode: AuthoredModuleMode): ModeResult {
  const exempt = FOH_MODE_EXEMPT[mode];
  if (exempt) {
    return { mode, classification: "exempt", reason: exempt.reason };
  }
  if (modeIsConsumed(mode, FOH_SOURCE)) {
    return { mode, classification: "covered" };
  }
  return { mode, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("FOH AuthoredModuleMode coverage (Lattice Coverage)", () => {
  const results: ModeResult[] = AUTHORED_MODULE_MODE_VALUES.map(classifyMode);

  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const m = src.match(
      /export\s+type\s+AuthoredModuleMode\s*=\s*([^;]+);/m,
    );
    expect(
      m,
      "AuthoredModuleMode export not found in json-fields.ts",
    ).toBeTruthy();
    const sourceValues = (m![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sorted = [...sourceValues].sort();
    const local = [...AUTHORED_MODULE_MODE_VALUES].sort();
    expect(
      sorted,
      `Source type union diverged from FOH coverage matrix. ` +
        `Source: ${sorted.join(", ")}; matrix: ${local.join(", ")}. ` +
        `Update AUTHORED_MODULE_MODE_VALUES in this file and decide ` +
        `the FOH classification (covered / exempt / gap) for the new value.`,
    ).toEqual(local);
  });

  it("no mode is an uncovered FOH gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `FOH producer-only modes (no consumer found, no exemption):\n  ${gaps
        .map((g) => g.mode)
        .join("\n  ")}\n\nFix: wire the FOH consumer (resolveLearnerShell, ` +
        `mode-branched render path) OR add to FOH_MODE_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — FOH gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `FOH gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.mode).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: wire the FOH consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — FOH exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(FOH_MODE_EXEMPT);
    expect(
      ex.length,
      `FOH exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.join(", ")}. ` +
        `If you removed an exemption (wired the consumer), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every FOH exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(FOH_MODE_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short (${entry!.reason.length} chars) — ` +
          `write what makes this mode intentionally exempt from FOH-specific render`,
      ).toBeGreaterThan(20);
    }
  });

  it("no FOH exempt entry is contradicted by an actual consumer match", () => {
    const contradicted: string[] = [];
    for (const k of Object.keys(FOH_MODE_EXEMPT)) {
      if (modeIsConsumed(k as AuthoredModuleMode, FOH_SOURCE)) {
        contradicted.push(k);
      }
    }
    expect(
      contradicted,
      `FOH exempt entries that now have real consumer matches — remove from FOH_MODE_EXEMPT:\n  ${contradicted.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });

  it("no FOH exempt entry references an unknown mode (stale row)", () => {
    const known = new Set<string>(AUTHORED_MODULE_MODE_VALUES);
    const stale: string[] = [];
    for (const k of Object.keys(FOH_MODE_EXEMPT)) {
      if (!known.has(k)) stale.push(k);
    }
    expect(
      stale,
      `Stale FOH exempt entries: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    const sum = counts.covered + counts.exempt + counts.gap;
    expect(sum).toBe(AUTHORED_MODULE_MODE_VALUES.length);
  });
});
