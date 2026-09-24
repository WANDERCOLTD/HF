/**
 * Mode → spec selection Coverage gate — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every `AuthoredModuleMode` value in
 *  `apps/admin/lib/types/json-fields.ts` MUST have a classifiable
 *  spec-selection consumer:
 *
 *    - `covered` — at least one spec-selection helper (`lib/pipeline/**`,
 *      `lib/voice/**`, `lib/prompt/composition/**`) branches on the mode
 *      literal to load / drop / re-route an AnalysisSpec or compose
 *      directive distinct from the default conversational MEASURE path.
 *    - `default-fallback` — the mode legitimately runs the baseline
 *      conversational MEASURE path with no mode-specific branching
 *      (e.g. `tutor` baseline; `mixed` = tutor + assessment touches).
 *      Listed in `MODE_SPEC_SELECTION_EXEMPT` with a substantive
 *      reason.
 *    - `gap` — the mode is referenced as a literal somewhere but no
 *      spec / no fallback handles it — silent bug, fails the test.
 *
 *  Bridge between two existing structural gates:
 *    - PR #2144 `tests/lib/sim-chat/mode-ui-coverage.test.ts` pins the
 *      UI consumer (3-axis: teaching/adminUI/learnerUI presence).
 *    - PR #2155 wired `IELTS-MEASURE-001` into SCORE_AGENT — the first
 *      non-default-fallback spec selection. Today it's gated by
 *      `requiresBehaviorTargetParams` + the per-course override
 *      `config.aiMeasurement.disableLlmIeltsScoring` (story #2158,
 *      retired `HF_IELTS_LLM_MEASURE_V1` env flag), NOT by
 *      `module.mode`, so it doesn't bump any mode out of
 *      default-fallback. Future mode-specific spec selection (per
 *      epic #2135 + course-specific stories) will drop the
 *      `default-fallback` exemption row and graduate that mode to
 *      `covered`.
 *
 *  Catches the failure mode: a mode value silently fires the wrong
 *  spec set (e.g. `quiz` mode running the conversational MEASURE spec
 *  instead of an MCQ-tuned spec) — the spec-selection helper at
 *  `lib/pipeline/specs-loader.ts` reads `outputType` /
 *  `requiresBehaviorTargetParams` / `profileCondition`, never reads
 *  the mode literal. New mode → must consciously decide whether the
 *  default conversational MEASURE path is right (exempt with reason)
 *  or whether a mode-specific selection is needed (wire + classify
 *  `covered`).
 *
 * **How matching works:**
 *  For each mode value, the test concatenates source from
 *  `SELECTION_DIRS` and looks for one of the literal-consumer
 *  patterns referencing the mode:
 *    - `mode === "<value>"` (or `mode !== "<value>"`)
 *    - `.mode === "<value>"` (or `.mode !== "<value>"`)
 *
 *  Switch-case branches (`case "<value>":`) are deliberately NOT
 *  matched — they may legitimately exist for unrelated string
 *  literals (e.g. `AudienceId = "mixed"`, `scheduler.mode === "assess"`,
 *  prosody `mode === "ielts"`). If your mode is consumed via a switch
 *  inside one of `SELECTION_DIRS`, rewrite to an explicit `===`
 *  comparator OR list the cell in `MODE_SPEC_SELECTION_EXEMPT` with
 *  a one-line reason.
 *
 * **How to fix a failure:**
 *  - "Gap N": wire a spec-selection consumer in the same PR OR add
 *    to `MODE_SPEC_SELECTION_EXEMPT` with a >20-char reason
 *    describing the intentional default-fallback choice AND bump
 *    `EXPECTED_EXEMPT_COUNT`.
 *  - "Ratchet drifted": you closed a gap (drop `EXPECTED_GAP_COUNT`),
 *    you graduated a mode out of exempt-fallback (drop
 *    `EXPECTED_EXEMPT_COUNT`), or you opened a regression (pause:
 *    wire the consumer instead).
 *
 *  See `.claude/rules/mode-spec-selection-coverage.md` for the
 *  durable rule.
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

const TYPE_SOURCE_PATH = join(REPO_ADMIN, "lib", "types", "json-fields.ts");

// ────────────────────────────────────────────────────────────
// Spec-selection consumer directories
//
// These are the dirs where a real mode-driven spec / directive
// selection decision lives. Pipeline runners, voice mode-aware
// helpers, and the COMPOSE-side teaching directives that gate on
// `module.mode` (`resolveModuleQuizDirective` /
// `resolveModuleMockExamDirective` in `instructions.ts`) all count.
// ────────────────────────────────────────────────────────────

const SELECTION_DIRS: string[] = [
  "lib/pipeline",
  "lib/voice",
  "lib/prompt/composition",
  "lib/curriculum",
];

// ────────────────────────────────────────────────────────────
// Exempt — modes whose spec selection legitimately defaults to
// the baseline conversational MEASURE path with no mode-literal
// branching at the selection layer.
// Required: one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const MODE_SPEC_SELECTION_EXEMPT: Partial<
  Record<AuthoredModuleMode, ExemptEntry>
> = {
  // Tutor is the default conversational mode. Spec selection runs the
  // baseline MEASURE/LEARN set filtered by outputType + teaching-profile
  // + BehaviorTarget presence. No mode-literal branching at the
  // selection layer. The COMPOSE-side baseline tutor stack handles
  // the teaching directive implicitly (mirror of `tutor.teaching` in
  // mode-ui-coverage).
  tutor: {
    reason:
      "tutor is the default mode; spec selection runs baseline conversational MEASURE path with no mode-literal branching at the selection layer",
  },
  // Mixed = tutor + assessment activation. Same spec selection as
  // tutor at the route.ts dispatch; the assessment-spec firing is
  // governed by `scoringGate` config on the spec itself, not by
  // `module.mode === "mixed"`. No mode-literal selection branching.
  mixed: {
    reason:
      "mixed = tutor baseline + assessment-spec scoringGate firing; spec selection has no mode-literal branching distinct from tutor",
  },
  // examiner graduated out of exempt 2026-06-23 — lib/voice/resolve-learner-shell.ts
  // ships a literal `module?.mode === "examiner"` branch at line 116 (the
  // ExamModeShell mount gate). That counts as a real spec-selection
  // consumer in the SELECTION_DIRS sweep — examiner is `covered` now.
};

/**
 * Ratchet — only goes DOWN as modes graduate out of exempt-default
 * into real `covered` spec selection. Today's incumbent: 2 of 5 modes
 * (tutor / mixed) sit on the default-fallback baseline. examiner
 * graduated 2026-06-23 (resolve-learner-shell.ts ExamModeShell gate).
 * `quiz` and `mock-exam` are `covered` via the COMPOSE-side
 * teaching directives (instructions.ts::resolveModuleQuizDirective +
 * resolveModuleMockExamDirective) that gate on `matched.mode === "..."`.
 */
const EXPECTED_EXEMPT_COUNT = 2;

/**
 * Ratchet — spec-selection gaps frozen at incumbent count.
 * Today: 0. Every mode is either `covered` (real `module.mode === "X"`
 * branch in a SELECTION_DIRS file) or `exempt` (intentional
 * default-fallback). A new mode added without a selection plan would
 * fail with `gap` — author must decide consciously.
 */
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

function concatSelectionSource(): string {
  const files: string[] = [];
  for (const rel of SELECTION_DIRS) {
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

const SELECTION_SOURCE = concatSelectionSource();

/**
 * Mode-literal consumer pattern — the mode value must appear in a
 * comparison against a variable literally named `mode` or accessed
 * as `.mode`. Discriminates real consumers from incidental string-
 * literal collisions (`AudienceId = "mixed"`,
 * `scheduler.mode === "assess"`, `prosody.mode === "ielts"` etc.).
 *
 * Switch-case branches are NOT matched here — they may legitimately
 * exist for unrelated string literals. Cases that ARE valid
 * (mode-keyed switches over AuthoredModuleMode) should rewrite to
 * `===` checks OR list the mode in MODE_SPEC_SELECTION_EXEMPT with
 * a one-line reason.
 */
function modeIsSelectedFor(
  mode: AuthoredModuleMode,
  source: string,
): boolean {
  const esc = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:\\.\\s*mode\\s*[!=]==\\s*["']${esc}["'])|(?:\\bmode\\s*[!=]==\\s*["']${esc}["'])`,
    "m",
  );
  return re.test(source);
}

type Classification = "covered" | "default-fallback" | "gap";

interface ModeResult {
  mode: AuthoredModuleMode;
  classification: Classification;
  reason?: string;
}

function classifyMode(mode: AuthoredModuleMode): ModeResult {
  const exempt = MODE_SPEC_SELECTION_EXEMPT[mode];
  if (exempt) {
    return { mode, classification: "default-fallback", reason: exempt.reason };
  }
  if (modeIsSelectedFor(mode, SELECTION_SOURCE)) {
    return { mode, classification: "covered" };
  }
  return { mode, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("AuthoredModuleMode spec-selection coverage (Lattice Coverage)", () => {
  const results: ModeResult[] = AUTHORED_MODULE_MODE_VALUES.map(classifyMode);

  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const m = src.match(/export\s+type\s+AuthoredModuleMode\s*=\s*([^;]+);/m);
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
      `Source type union diverged from test matrix. Source: ${sorted.join(", ")}; matrix: ${local.join(", ")}. Update AUTHORED_MODULE_MODE_VALUES in this file and add coverage rows.`,
    ).toEqual(local);
  });

  it("no mode value is an uncovered spec-selection gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Spec-selection gaps (mode literal not found in selection dirs and no exemption):\n  ${gaps
        .map((g) => g.mode)
        .join("\n  ")}\n\nFix: wire a mode-specific spec / directive selection in one of [${SELECTION_DIRS.join(", ")}] OR add to MODE_SPEC_SELECTION_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.mode).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: wire the consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(MODE_SPEC_SELECTION_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.join(", ")}. ` +
        `If you graduated a mode out of default-fallback (wired a real selection), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(MODE_SPEC_SELECTION_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short (${entry!.reason.length} chars) — write what makes this mode intentionally default-fallback`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by a real spec-selection match", () => {
    const contradicted: string[] = [];
    for (const k of Object.keys(MODE_SPEC_SELECTION_EXEMPT)) {
      const mode = k as AuthoredModuleMode;
      if (modeIsSelectedFor(mode, SELECTION_SOURCE)) {
        contradicted.push(mode);
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have real spec-selection matches — remove from MODE_SPEC_SELECTION_EXEMPT (the mode graduated out of default-fallback):\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references an unknown mode (stale row)", () => {
    const known = new Set<string>(AUTHORED_MODULE_MODE_VALUES);
    const stale: string[] = [];
    for (const k of Object.keys(MODE_SPEC_SELECTION_EXEMPT)) {
      if (!known.has(k)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      "default-fallback": 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    const sum = counts.covered + counts["default-fallback"] + counts.gap;
    expect(sum).toBe(AUTHORED_MODULE_MODE_VALUES.length);
  });
});
