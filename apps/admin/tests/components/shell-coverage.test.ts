/**
 * Shell coverage — Lattice 5th-pillar Coverage test (story #2208, U7 of #2185).
 *
 * **What this test pins:**
 *  Every `LearnerShellKind` value in
 *  `apps/admin/lib/types/json-fields.ts` (declared by PR #2173) MUST
 *  have a concrete shell component under `apps/admin/components/sim/`
 *  that:
 *    1. Exists as `<PascalCase(kind)>Shell.tsx` (e.g. `chat-feed` →
 *       `ChatFeedShell.tsx`), AND
 *    2. Accepts a `capabilities: LearnerShellCapabilities` prop —
 *       i.e. the shell is capability-driven per epic #2163 S3, not
 *       hard-branched on the shell-kind literal.
 *
 *  Catches the producer-only failure mode where a kind literal is
 *  added to the type union (and perhaps wired into
 *  `resolveLearnerShell`) but no concrete UI consumer is shipped — the
 *  learner sees the default chat-feed regardless of declared shell.
 *
 *  Today's incumbent: `ExamModeShell` + `ChatFeedShell` + `MCQRoundsShell`
 *  + `ResultsReadoutShell` ship on main. `ResultsReadoutShell` lands via
 *  W6 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md`
 *  (story #2185 U11, demo-critical for IELTS Mock → Mock Results screen).
 *  `IntakeWizardShell` is the remaining GAP entry, deferred to W7.
 *
 *  Sibling to:
 *   - `tests/lib/sim-chat/mode-ui-coverage.test.ts` — AuthoredModuleMode
 *     × 3 axes (#2009 trio).
 *   - `tests/lib/voice/sessionkind-reader-coverage.test.ts` —
 *     SessionKindString writer/reader pairing.
 *   - `tests/components/foh-coverage.test.ts` (PR #2207) — FOH page
 *     existence.
 *   - `tests/components/admin-tab-coverage.test.ts` (PR #2203) — admin
 *     tab existence.
 *
 * **How matching works:**
 *  For each `LearnerShellKind` value:
 *    1. Map `kebab-case → PascalCase` (e.g. `mcq-rounds` → `MCQRounds`,
 *       `results-readout` → `ResultsReadout`, `intake-wizard` →
 *       `IntakeWizard`, `chat-feed` → `ChatFeed`, `exam` → `Exam`).
 *       The single-segment `exam` value maps to the historical
 *       `ExamModeShell` filename — see `KIND_TO_COMPONENT` for the
 *       canonical map.
 *    2. Check `components/sim/<Component>.tsx` exists.
 *    3. Read the file; assert it accepts `capabilities` as a prop
 *       (regex: `capabilities[:?]\s*Learner`-prefixed type OR
 *       `capabilities:` inside a `*ShellProps` interface).
 *
 *  Failure modes:
 *    - File missing → `gap`.
 *    - File exists but no `capabilities` prop → `gap` (procedural shell
 *      — failed the capability-driven contract).
 *    - File exists + `capabilities` prop present → `covered`.
 *    - Listed in `SHELL_EXEMPT` with reason → `exempt`.
 *
 *  Ratchet — both the gap count and exempt count are pinned by
 *  exact-match constants. Future PRs that close gaps must drop
 *  `EXPECTED_GAP_COUNT`; future PRs that exempt a kind must bump
 *  `EXPECTED_EXEMPT_COUNT`.
 *
 *  See `.claude/rules/shell-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Canonical source-of-truth — `LearnerShellKind` union values.
// Verified against the type union at test runtime so a new value
// forces a matrix update.
// ────────────────────────────────────────────────────────────

const LEARNER_SHELL_KIND_VALUES = [
  "chat-feed",
  "exam",
  "mcq-rounds",
  "results-readout",
  "intake-wizard",
] as const;

type LearnerShellKind = (typeof LEARNER_SHELL_KIND_VALUES)[number];

const REPO_ADMIN = resolve(__dirname, "..", "..");
const TYPE_SOURCE_PATH = join(REPO_ADMIN, "lib", "types", "json-fields.ts");
const SHELL_DIR = join(REPO_ADMIN, "components", "sim");

// ────────────────────────────────────────────────────────────
// kebab-case → PascalCase shell-component filename map.
//
// `exam` maps to `ExamModeShell` for backwards compatibility with the
// pre-existing #1745 component. Every other kind follows the
// PascalCase(kind) + "Shell" convention.
// ────────────────────────────────────────────────────────────

const KIND_TO_COMPONENT: Record<LearnerShellKind, string> = {
  "chat-feed": "ChatFeedShell",
  exam: "ExamModeShell",
  "mcq-rounds": "MCQRoundsShell",
  "results-readout": "ResultsReadoutShell",
  "intake-wizard": "IntakeWizardShell",
};

// ────────────────────────────────────────────────────────────
// Exempt list — kinds intentionally without a concrete component.
// Required: >20-char reason.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const SHELL_EXEMPT: Partial<Record<LearnerShellKind, ExemptEntry>> = {
  // No legitimate exemptions today. Every declared LearnerShellKind
  // should have a concrete component — this is what the operator
  // experience pivots on. Add an entry here ONLY when a kind is
  // declared as a placeholder for future work AND the absence is
  // explicit + bounded. The reason must explain when the consumer
  // will land.
};

const EXPECTED_EXEMPT_COUNT = 0;

/**
 * Ratchet — current incumbent gap count. Calibrated from RED first-run
 * on the merge-window state of main:
 *
 * Story #2208 (U7 of #2185) expectation:
 *   - `ExamModeShell.tsx` lives on main (since #1745).
 *   - PR #2202 (S3 of #2163) ships `ChatFeedShell.tsx` +
 *     `MCQRoundsShell.tsx` AND refactors `ExamModeShell.tsx` to accept
 *     the `capabilities` prop.
 *   - `ResultsReadoutShell.tsx` + `IntakeWizardShell.tsx` are deferred
 *     to later slices of epic #2163 (S4-S7).
 *
 * RED first-run baseline against `main` (this PR's incumbent) → 5 gaps:
 *   - `chat-feed`        (PR #2202 closed — `ChatFeedShell.tsx` shipped)
 *   - `exam`             (PR #2202 closed — `ExamModeShell.tsx` refactored)
 *   - `mcq-rounds`       (PR #2202 closed — `MCQRoundsShell.tsx` shipped)
 *   - `results-readout`  (S4-S7 of epic #2163)
 *   - `intake-wizard`    (S4-S7 of epic #2163)
 *
 * PR #2202 landed the first 3 shells; PR #2218 (#2206 / W1+W2+W3) drops
 * the ratchet from 5 → 2 in the same commit that wires SimChat to
 * dispatch via `resolveLearnerShell`. The remaining 2 gaps
 * (results-readout + intake-wizard) close in W6 + W7 of #2206.
 *
 * W6 (PR #2220) shipped `ResultsReadoutShell.tsx` — dropped 5 → 1.
 * W7 (this PR) ships `IntakeWizardShell.tsx` (the typed shell for the
 * ENROLLMENT learner surface; ENROLLMENT sessions ride above SimChat
 * per `lib/voice/resolve-learner-shell.ts` rule order, so the shell is
 * a standalone capability frame, not a SimChat-mounted overlay).
 * Drops ratchet from 1 → 0 (all 5 LearnerShellKind values covered).
 */
const EXPECTED_GAP_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "covered" | "exempt" | "gap";

interface CellResult {
  kind: LearnerShellKind;
  componentName: string;
  classification: Classification;
  reason?: string;
}

/** Detect a `capabilities` prop on the shell component.
 *
 *  Matches the conventional shape (capability-driven shell per epic
 *  #2163 S3):
 *
 *    interface FooShellProps { ... capabilities: LearnerShellCapabilities; ... }
 *    interface FooShellProps { ... capabilities?: LearnerShellCapabilities; ... }
 *    function FooShell({ capabilities, ... }: FooShellProps) { ... }
 *
 *  The regex is intentionally generous so a shell that imports
 *  `LearnerShellCapabilities` from the types-stub during the #2173
 *  rollout window also passes.
 */
function acceptsCapabilitiesProp(source: string): boolean {
  // Look for `capabilities` followed by `?`-optional or `:` then a
  // Learner-prefixed type. Allows whitespace, line breaks, generics.
  const re = /\bcapabilities\s*[?]?\s*:\s*Learner/;
  return re.test(source);
}

function classifyKind(kind: LearnerShellKind): CellResult {
  const componentName = KIND_TO_COMPONENT[kind];
  const exempt = SHELL_EXEMPT[kind];
  if (exempt) {
    return {
      kind,
      componentName,
      classification: "exempt",
      reason: exempt.reason,
    };
  }
  const filePath = join(SHELL_DIR, `${componentName}.tsx`);
  if (!existsSync(filePath)) {
    return { kind, componentName, classification: "gap" };
  }
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return { kind, componentName, classification: "gap" };
  }
  if (!acceptsCapabilitiesProp(source)) {
    return { kind, componentName, classification: "gap" };
  }
  return { kind, componentName, classification: "covered" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("LearnerShellKind component coverage (Lattice Coverage)", () => {
  const results: CellResult[] = LEARNER_SHELL_KIND_VALUES.map(classifyKind);

  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const unionMatch = src.match(
      /export\s+type\s+LearnerShellKind\s*=\s*([\s\S]+?);/m,
    );
    // Per the dependency note on story #2208, this gate sits downstream
    // of PR #2173 which declares the type union. When #2173 has not yet
    // merged the union is absent. Skip the source-vs-matrix sanity in
    // that window and surface a clear console signal so the dependency
    // remains visible. Once #2173 merges, the union appears and this
    // sanity check engages automatically.
    if (!unionMatch) {
      // eslint-disable-next-line no-console
      console.warn(
        "[shell-coverage] LearnerShellKind union not yet declared in json-fields.ts — " +
          "PR #2173 (S1 of epic #2163) is the prerequisite. Source-vs-matrix sanity " +
          "is deferred until #2173 merges.",
      );
      return;
    }
    const sourceValues = (unionMatch[1].match(/["']([^"']+)["']/g) ?? []).map(
      (s) => s.replace(/["']/g, ""),
    );
    const sorted = [...sourceValues].sort();
    const local = [...LEARNER_SHELL_KIND_VALUES].sort();
    expect(
      sorted,
      `Source type union diverged from test matrix. Source: ${sorted.join(
        ", ",
      )}; matrix: ${local.join(
        ", ",
      )}. Update LEARNER_SHELL_KIND_VALUES (and KIND_TO_COMPONENT) in this file.`,
    ).toEqual(local);
  });

  it("every LearnerShellKind has a KIND_TO_COMPONENT mapping", () => {
    const missing = LEARNER_SHELL_KIND_VALUES.filter(
      (k) => !KIND_TO_COMPONENT[k],
    );
    expect(
      missing,
      `LearnerShellKind values without a KIND_TO_COMPONENT entry: ${missing.join(
        ", ",
      )}`,
    ).toEqual([]);
  });

  it("no LearnerShellKind is an uncovered gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `LearnerShellKind values without a capability-driven shell component:\n  ${gaps
        .map((g) => `${g.kind} (expected components/sim/${g.componentName}.tsx)`)
        .join(
          "\n  ",
        )}\n\nFix: ship the shell with a \`capabilities: LearnerShellCapabilities\` prop, OR add to SHELL_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.kind).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: ship the consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(SHELL_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.join(", ")}. ` +
        `If you removed an exemption (wired the consumer), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(SHELL_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short (${entry!.reason.length} chars) — write what makes this kind intentionally exempt and when the consumer will land`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by an actual covered component", () => {
    const contradicted: string[] = [];
    for (const k of Object.keys(SHELL_EXEMPT) as LearnerShellKind[]) {
      const componentName = KIND_TO_COMPONENT[k];
      const filePath = join(SHELL_DIR, `${componentName}.tsx`);
      if (!existsSync(filePath)) continue;
      try {
        const source = readFileSync(filePath, "utf8");
        if (acceptsCapabilitiesProp(source)) contradicted.push(k);
      } catch {
        // unreadable — treat as non-contradiction
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have real capability-driven components — remove from SHELL_EXEMPT:\n  ${contradicted.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });

  it("no exempt entry references an unknown kind (stale row)", () => {
    const known = new Set<string>(LEARNER_SHELL_KIND_VALUES);
    const stale: string[] = [];
    for (const k of Object.keys(SHELL_EXEMPT)) {
      if (!known.has(k)) stale.push(k);
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
    expect(sum).toBe(LEARNER_SHELL_KIND_VALUES.length);
  });
});
