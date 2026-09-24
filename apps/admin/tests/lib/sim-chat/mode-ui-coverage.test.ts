/**
 * Mode UI coverage — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every `AuthoredModuleMode` value in
 *  `apps/admin/lib/types/json-fields.ts` MUST have a consumer on each
 *  of three axes:
 *    1. **teaching** — composition transform branches on the mode
 *       (compose-side teaching directive), OR the mode is the default
 *       (tutor / mixed) so the baseline tutor stack handles it.
 *    2. **adminUI** — at least one admin UI component (`app/x/**`,
 *       `components/**`) branches on the mode (badge, icon, inspector,
 *       pill).
 *    3. **learnerUI** — at least one learner-facing render path branches
 *       on the mode (SIM shell, FOH pre-call card, ExamModeShell mount,
 *       or chat-feed reskin), OR the mode is the default chat-feed
 *       behaviour.
 *
 *  Catches the producer-only failure mode where a mode literal is added
 *  to the type union (and possibly the compose-side directive), but the
 *  UI surfaces silently ignore the value. The 2026-06-20 audit found
 *  `quiz` and `mock-exam` shipped with compose directives + admin badges
 *  but no learner-facing UI consumer — operators saw distinct icons but
 *  the learner experienced an identical chat session regardless of mode.
 *
 * **How matching works:**
 *  For each (mode, axis) cell, the test walks the axis's consumer
 *  directories and looks for one of these patterns referencing the mode
 *  literal:
 *    - `mode === "<value>"` (or `mode !== "<value>"`)
 *    - `case "<value>":`
 *    - `=== "<value>"` followed by `.mode` reference nearby
 *  A match counts as `covered`. Exempt cells are listed in
 *  `MODE_AXIS_EXEMPT` with a documented reason. Anything else is `gap`.
 *
 * **How to fix a failure:**
 *  - "Cell X.Y is a gap": wire the consumer (shell, transform, inspector)
 *    OR add to `MODE_AXIS_EXEMPT` with a one-line reason describing the
 *    intentional choice (e.g., "tutor is the default — no specific UI
 *    needed").
 *  - "Ratchet drifted up": you added an exempt entry without bumping
 *    `EXPECTED_EXEMPT_COUNT`. Decide consciously.
 *  - "Stale exempt entry": the cell now has a real consumer; remove the
 *    exempt row.
 *
 *  See `.claude/rules/mode-ui-coverage.md` for the durable rule.
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

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");

const TYPE_SOURCE_PATH = join(
  REPO_ADMIN,
  "lib",
  "types",
  "json-fields.ts",
);

// ────────────────────────────────────────────────────────────
// Three axes the matrix pins
// ────────────────────────────────────────────────────────────

type ModeAxis = "teaching" | "adminUI" | "learnerUI";
const AXES: readonly ModeAxis[] = ["teaching", "adminUI", "learnerUI"] as const;

const AXIS_DIRS: Record<ModeAxis, string[]> = {
  teaching: [
    "lib/prompt/composition/transforms",
    "lib/prompt/composition/loaders",
    "lib/prompt/composition",
    "lib/curriculum",
  ],
  adminUI: [
    "app/x",
    "components/modules-tab",
    "components/journey-tab",
  ],
  learnerUI: [
    "components/sim",
    "app/x/student",
    // FOH learner app — separate workspace
    "../foh/app",
    "../foh/components",
  ],
};

// ────────────────────────────────────────────────────────────
// Exempt list — (mode, axis) cells where the mode is the implicit
// default and a specific consumer is intentionally not required.
// Required: one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

type CellKey = `${AuthoredModuleMode}.${ModeAxis}`;

const MODE_AXIS_EXEMPT: Partial<Record<CellKey, ExemptEntry>> = {
  // Tutor is the default conversational mode — the baseline tutor
  // stack at lib/prompt/composition handles it without a mode-specific
  // directive. No teaching consumer required.
  "tutor.teaching": {
    reason:
      "tutor is the default mode; baseline tutor stack handles it without a mode-specific compose directive",
  },
  // ModePill / ModeIcon in AuthoredModulesPanel + LearnerModulePicker
  // use a ternary chain where tutor is the fallback (no explicit
  // `mode === "tutor"`). The badge IS rendered; the consumer is just
  // implicit via the fallback branch.
  "tutor.adminUI": {
    reason:
      "tutor is the fallback in ModePill/ModeIcon ternary chains; admin renders the badge implicitly without an explicit mode equality check",
  },
  // Tutor uses the default chat-feed shell (SimChat) for learner UI —
  // no exam-shell, no MCQ overlay, no banner override.
  "tutor.learnerUI": {
    reason:
      "tutor uses the default SimChat shell; no mode-specific learner UI needed",
  },
  // Mixed = tutor + occasional assessment touches. Uses tutor baseline
  // at compose time + per-question scoring activation when the spec
  // fires. No mode-literal-specific directive.
  "mixed.teaching": {
    reason:
      "mixed = tutor baseline + assessment activation; no mode-literal-specific compose directive",
  },
  // Mixed uses the default chat-feed shell — same as tutor for the
  // learner UI even though pacing differs.
  "mixed.learnerUI": {
    reason:
      "mixed uses the default SimChat shell; same learner-facing aesthetic as tutor",
  },
  // Examiner mode is wired through the spec runner at
  // lib/curriculum/build-per-segment-measure-prompt.ts via a string
  // template keyed off the spec slug ("examiner-mode" scoring prompt),
  // NOT via a literal `.mode === "examiner"` comparator. The
  // ExamModeShell mount-gate at components/sim/ExamModeShell.tsx:62
  // IS the literal reader, but that's on the learnerUI axis.
  "examiner.teaching": {
    reason:
      "examiner is wired via spec-slug template ('examiner-mode' scoring prompt), not via literal .mode comparator in teaching dirs",
  },
};

/** Ratchet — only goes DOWN as gaps close, never UP without a bump. */
const EXPECTED_EXEMPT_COUNT = 6;

/** Ratchet — UI consumer gaps frozen at incumbent count. Drops as
 *  gaps close. Both incumbents closed by PR #2198 (S3 of epic #2163):
 *  `mock-exam.learnerUI` closed by extending `shouldMountExamModeShell`
 *  to accept both `examiner` and `mock-exam` (#2161). `quiz.learnerUI`
 *  closed at the SHELL level by `MCQRoundsShell` consuming the
 *  capability frame for `mode === "quiz"` modules (#2159). Data feed
 *  remains stubbed pending epic #2176 S2 (#2180 sampling engine). */
const EXPECTED_GAP_COUNT = 0;

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

function concatSourceForAxis(axis: ModeAxis): string {
  const files: string[] = [];
  for (const rel of AXIS_DIRS[axis]) {
    files.push(...walkSource(resolve(REPO_ADMIN, rel)));
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
const AXIS_SOURCE: Record<ModeAxis, string> = {
  teaching: concatSourceForAxis("teaching"),
  adminUI: concatSourceForAxis("adminUI"),
  learnerUI: concatSourceForAxis("learnerUI"),
};

/** Mode-literal consumer patterns. The mode value must appear in a
 *  comparison against a variable literally named `mode` or accessed
 *  as `.mode` — this discriminates real consumers from incidental
 *  string-literal collisions (e.g. AudienceId `"mixed"` lives in
 *  lib/prompt/composition/transforms/audience.ts but isn't a mode
 *  consumer). Switch-case branches are NOT matched here; they may
 *  legitimately exist for unrelated string literals or pure type-
 *  exhaustiveness plumbing. Cases that ARE valid (mode-keyed switches)
 *  should rewrite to `===` checks or list the cell in exempt with a
 *  one-line reason. */
function modeIsConsumed(mode: AuthoredModuleMode, source: string): boolean {
  const esc = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match shapes:
  //   mode === "X"          mode !== "X"
  //   .mode === "X"         .mode !== "X"
  //   .mode==='X'           etc.
  const re = new RegExp(
    `(?:\\.\\s*mode\\s*[!=]==\\s*["']${esc}["'])|(?:\\bmode\\s*[!=]==\\s*["']${esc}["'])`,
    "m",
  );
  return re.test(source);
}

type Classification = "covered" | "exempt" | "gap";

interface CellResult {
  mode: AuthoredModuleMode;
  axis: ModeAxis;
  key: CellKey;
  classification: Classification;
  reason?: string;
}

function classifyCell(mode: AuthoredModuleMode, axis: ModeAxis): CellResult {
  const key: CellKey = `${mode}.${axis}`;
  const exempt = MODE_AXIS_EXEMPT[key];
  if (exempt) {
    return { mode, axis, key, classification: "exempt", reason: exempt.reason };
  }
  if (modeIsConsumed(mode, AXIS_SOURCE[axis])) {
    return { mode, axis, key, classification: "covered" };
  }
  return { mode, axis, key, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("AuthoredModuleMode UI/teaching coverage (Lattice Coverage)", () => {
  const results: CellResult[] = AUTHORED_MODULE_MODE_VALUES.flatMap((m) =>
    AXES.map((a) => classifyCell(m, a)),
  );

  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const m = src.match(
      /export\s+type\s+AuthoredModuleMode\s*=\s*([^;]+);/m,
    );
    expect(m, "AuthoredModuleMode export not found in json-fields.ts").toBeTruthy();
    const sourceValues = (m![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sorted = [...sourceValues].sort();
    const local = [...AUTHORED_MODULE_MODE_VALUES].sort();
    expect(
      sorted,
      `Source type union diverged from test matrix. Source: ${sorted.join(", ")}; matrix: ${local.join(", ")}. Update AUTHORED_MODULE_MODE_VALUES in this file and add coverage rows.`,
    ).toEqual(local);
  });

  it("no (mode, axis) cell is an uncovered gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Producer-only mode cells (no consumer found, no exemption):\n  ${gaps
        .map((g) => g.key)
        .join("\n  ")}\n\nFix: wire the consumer OR add to MODE_AXIS_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.key).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: wire the consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(MODE_AXIS_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.join(", ")}. ` +
        `If you removed an exemption (wired the consumer), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(MODE_AXIS_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short (${entry!.reason.length} chars) — write what makes this cell intentionally exempt`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by an actual consumer match", () => {
    const contradicted: string[] = [];
    for (const [k, _] of Object.entries(MODE_AXIS_EXEMPT)) {
      const [mode, axis] = k.split(".") as [AuthoredModuleMode, ModeAxis];
      if (modeIsConsumed(mode, AXIS_SOURCE[axis])) {
        contradicted.push(k);
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have real consumer matches — remove from MODE_AXIS_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references an unknown mode (stale row)", () => {
    const known = new Set<string>(AUTHORED_MODULE_MODE_VALUES);
    const stale: string[] = [];
    for (const k of Object.keys(MODE_AXIS_EXEMPT)) {
      const [mode] = k.split(".");
      if (!known.has(mode)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    const sum = counts.covered + counts.exempt + counts.gap;
    expect(sum).toBe(AUTHORED_MODULE_MODE_VALUES.length * AXES.length);
  });
});
