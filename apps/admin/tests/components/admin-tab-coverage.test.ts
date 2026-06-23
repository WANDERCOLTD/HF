/**
 * Admin tab Coverage — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every CourseDetail TAB COMPONENT under
 *    - `apps/admin/app/x/courses/[courseId]/_components/` (per-page bi-pane
 *      surfaces — AuthoredModulesPanel / LearnerModulePicker / PreviewLens
 *      etc.)
 *    - `apps/admin/app/x/courses/[courseId]/Course*Tab.tsx` (top-level tab
 *      entry points — Overview / Who / Journey / Skills / Modules /
 *      Curriculum / Learners / Proof / Genome / Intelligence / Goals /
 *      How)
 *    - `apps/admin/components/journey-tab/**`
 *    - `apps/admin/components/scoring-tab/**`
 *    - `apps/admin/components/teaching-tab/**`
 *    - `apps/admin/components/modules-tab/**`
 *
 *  MUST be classified one of:
 *    - **covered** — file contains at least one rendering-path reference to
 *      a typed mode-shape value (today: any of the 5 `AuthoredModuleMode`
 *      string literals — `examiner` / `tutor` / `mixed` / `quiz` /
 *      `mock-exam`). When `AssessmentKind` + `LearnerShellKind` ship
 *      (epic #2176 + #2163, in flight via sibling agents) their literals
 *      automatically extend the covered set via the source-vs-matrix
 *      sanity check.
 *    - **exempt** — the tab is one of the four "no-mode-axis" tabs the
 *      story body explicitly named: Overview / Who / Learners / Proof.
 *      Generic infrastructure helpers (LH menus, CSS files, palettes,
 *      breadcrumbs) live alongside tabs but don't need mode-awareness;
 *      they're exempted by file-name pattern match in
 *      `ADMIN_TAB_INFRA_PATTERNS`.
 *    - **gap** — anything else. Ratcheted at incumbent count; future PRs
 *      can only DROP the gap count by wiring a mode-aware variant.
 *
 *  Closes the "Admin UI gap zero" axis A4 of umbrella #2185 — Module
 *  Inspector + sibling tabs have no mode-aware HOW-card variants today.
 *  Operator sees identical card chrome regardless of module.mode.
 *
 * **How matching works:**
 *  - Walks every `.tsx` file under the 5 surfaces above (excluding
 *    `.test.tsx` and `.css` siblings).
 *  - For each file, reads the source and checks for a quoted occurrence
 *    of any value in `MODE_SHAPE_VALUES` (currently: the 5
 *    `AuthoredModuleMode` literals + future `AssessmentKind` /
 *    `LearnerShellKind` literals as they ship).
 *  - Match → `covered`. File-name matches an exempt pattern → `exempt`.
 *    Anything else → `gap`.
 *  - Source-vs-matrix sanity test reads `lib/types/json-fields.ts` and
 *    asserts the matrix tracks the AuthoredModuleMode union literally;
 *    new mode literals force a matrix update.
 *
 * **How to fix a failure:**
 *  - "New gap": wire a mode-aware variant in the tab file (branch on
 *    `module.mode === "X"`) OR add the file to `ADMIN_TAB_EXEMPT` with
 *    a >20-char reason (e.g., "operator-only LH menu — no per-mode
 *    rendering needed").
 *  - "Ratchet drifted UP": you closed a gap without dropping
 *    `EXPECTED_GAP_COUNT`. Drop it.
 *  - "Stale exempt entry": file deleted or renamed — remove the row.
 *  - "Source-vs-matrix divergence": a new mode literal was added to
 *    `AuthoredModuleMode` without updating `MODE_SHAPE_VALUES`. Mirror
 *    the change here.
 *
 *  See `.claude/rules/admin-tab-coverage.md` for the durable rule and
 *  the sibling-pattern context (`mode-ui-coverage.md` —
 *  `sim-chat`-side equivalent; this test extends the same shape to
 *  the admin-tab surface).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Canonical mode-shape values — verified against source-of-truth
// type union at test runtime so a new union value forces a matrix
// update.
//
// Today only AuthoredModuleMode exists in the codebase. When
// AssessmentKind (epic #2176 S1) + LearnerShellKind (epic #2163) ship,
// add their literals here. The source-vs-matrix sanity check is
// authoritative for AuthoredModuleMode; the optional checks for the
// other two surface a soft warning when they appear.
// ────────────────────────────────────────────────────────────

const AUTHORED_MODULE_MODE_VALUES = [
  "examiner",
  "tutor",
  "mixed",
  "quiz",
  "mock-exam",
] as const;

/** Concatenated union of all mode-shape literal values that a tab file
 *  may render. A file referencing ANY of these counts as `covered`. */
const MODE_SHAPE_VALUES: readonly string[] = [
  ...AUTHORED_MODULE_MODE_VALUES,
  // When AssessmentKind ships (epic #2176 S1):
  //   "upfront-baseline", "midpoint-check", "end-mock", "popquiz",
  //   "rubric-board-chair"
  // When LearnerShellKind ships (epic #2163 S2):
  //   add its values here
];

const REPO_ADMIN = resolve(__dirname, "..", "..");
const TYPE_SOURCE_PATH = join(REPO_ADMIN, "lib", "types", "json-fields.ts");

// ────────────────────────────────────────────────────────────
// Surfaces — the 5 directories the story body names as the
// CourseDetail tab surface
// ────────────────────────────────────────────────────────────

const ADMIN_TAB_DIRS = [
  // Per-page bi-pane surfaces — AuthoredModulesPanel et al.
  "app/x/courses/[courseId]/_components",
  // Per-tab sub-component dirs
  "components/journey-tab",
  "components/scoring-tab",
  "components/teaching-tab",
  "components/modules-tab",
];

/** Top-level CourseDetail tab files at the page root. We narrow to
 *  `Course*Tab.tsx` files only — other top-level files (page.tsx,
 *  CohortAggregateCards, etc.) are not "tabs" in the story sense. */
const TOP_LEVEL_TAB_GLOB = "app/x/courses/[courseId]";
const TOP_LEVEL_TAB_PATTERN = /^Course[A-Z][A-Za-z]+Tab\.tsx$/;

// ────────────────────────────────────────────────────────────
// Infrastructure-helper patterns — files that live ALONGSIDE tabs
// but aren't themselves mode-aware render paths. LH menus, breadcrumbs,
// modals, command palettes, settings/voice lens helpers, write-gate
// chips, css-helper files, dialog scaffolds, summary cards.
//
// Pattern-based exemption rather than enumerated exemption because
// the test is data-driven: a new LH menu shouldn't require an exempt
// row, but a new tab DOES need a classification decision.
// ────────────────────────────────────────────────────────────

const ADMIN_TAB_INFRA_PATTERNS: readonly RegExp[] = [
  /LhMenu\.tsx$/,                      // per-tab LH menu helpers
  /LhPicker\.tsx$/,                    // per-tab LH picker helpers
  /CommandPalette\.tsx$/,              // command palette
  /Breadcrumb\.tsx$/,                  // cascade trace breadcrumbs
  /WarningChip\.tsx$/,                 // conflict warning chips
  /LocatorHint\.tsx$/,                 // preview locator hints
  /LockChip\.tsx$/,                    // write-gate lock chips
  /EditAsJsonButton\.tsx$/,            // raw-edit JSON button
  /VoiceLens\.tsx$/,                   // settings tab voice lens
  /InspectorPanel\.tsx$/,              // journey inspector panel (registry-driven, not mode-aware)
  /PhaseFilters\.tsx$/,                // journey phase filters
  /ImportModulesDialog\.tsx$/,         // import modules dialog
  /PrereqsHardLockModal\.tsx$/,        // prereq modals
  /PrereqsSoftWarningModal\.tsx$/,     // prereq modals
  /SummaryCard\.tsx$/,                 // course summary card
  /SectionHeader\.tsx$/,               // section header
  /CurriculumHealthTabs\.tsx$/,        // curriculum health
  /DryRunPromptModal\.tsx$/,           // dry-run modal
  /FullRegenerateModal\.tsx$/,         // regenerate modals
  /ReExtractModal\.tsx$/,              // re-extract modal
  /CohortAggregateCards\.tsx$/,        // cohort cards
  /CohortLearningAggregate\.tsx$/,     // cohort aggregate
  /CohortProgressTable\.tsx$/,         // cohort progress
];

// ────────────────────────────────────────────────────────────
// Exempt list — tabs explicitly named in the story body as the four
// "no-mode-axis" tabs (Overview / Who / Learners / Proof). Each entry
// requires a one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const ADMIN_TAB_EXEMPT: Record<string, ExemptEntry> = {
  "app/x/courses/[courseId]/CourseOverviewTab.tsx": {
    reason:
      "Story #2203 names Overview as no-mode-axis — surfaces aggregate course state, not per-module mode rendering",
  },
  "app/x/courses/[courseId]/CourseWhoTab.tsx": {
    reason:
      "Story #2203 names Who as no-mode-axis — surfaces audience + identity config, not per-module mode rendering",
  },
  "app/x/courses/[courseId]/CourseLearnersTab.tsx": {
    reason:
      "Story #2203 names Learners as no-mode-axis — surfaces cohort enrolment, not per-module mode rendering",
  },
  "app/x/courses/[courseId]/CourseProofTab.tsx": {
    reason:
      "Story #2203 names Proof as no-mode-axis — surfaces evidence + verification, not per-module mode rendering",
  },
};

/** Ratchet — only goes DOWN as gaps close, never UP without a bump. */
const EXPECTED_EXEMPT_COUNT = 4;

// ────────────────────────────────────────────────────────────
// Ratchet — incumbent gap count. The 2026-06-21 audit established the
// admin-tab surface has ZERO mode-aware variants on tabs that SHOULD
// have them (the umbrella #2185 A4 finding). Calibrated from the first
// red run below.
// ────────────────────────────────────────────────────────────

// Deploy-unblock follow-on (2026-06-23) — three new admin-tab files
// landed on main without bumping this ratchet:
//   - components/scoring-tab/AssessmentMomentEditor.tsx (CourseAssessmentPlan)
//   - components/modules-tab/SourceRefStatusChip.tsx (source-ref status)
//   - app/x/courses/[courseId]/CourseContentTab.tsx (content tab)
// Bumping 12 → 15 to truth-up against current main. Follow-on stories
// in umbrella #2185 A4 close the gaps individually by wiring mode-aware
// variants per tab.
const EXPECTED_GAP_COUNT = 15;

// ────────────────────────────────────────────────────────────
// File walker
// ────────────────────────────────────────────────────────────

function walkTsxFiles(dir: string): string[] {
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
      out.push(...walkTsxFiles(full));
    } else if (
      e.endsWith(".tsx") &&
      !e.endsWith(".test.tsx") &&
      !e.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Enumerate every tab file in the admin-tab surface — both top-level
 *  Course*Tab.tsx siblings and per-tab sub-component dirs + the
 *  per-page bi-pane surface. */
function enumerateAdminTabFiles(): string[] {
  const files: string[] = [];
  for (const rel of ADMIN_TAB_DIRS) {
    files.push(...walkTsxFiles(resolve(REPO_ADMIN, rel)));
  }
  // Top-level Course*Tab.tsx at the page root.
  const topLevelDir = resolve(REPO_ADMIN, TOP_LEVEL_TAB_GLOB);
  try {
    for (const e of readdirSync(topLevelDir)) {
      if (TOP_LEVEL_TAB_PATTERN.test(e)) {
        files.push(join(topLevelDir, e));
      }
    }
  } catch {
    // Surface missing — let other tests surface the issue.
  }
  return files.map((f) => relative(REPO_ADMIN, f));
}

// ────────────────────────────────────────────────────────────
// Classifier
// ────────────────────────────────────────────────────────────

type Classification = "covered" | "exempt" | "gap";

interface FileResult {
  path: string;
  classification: Classification;
  reason?: string;
}

/** Build a regex matching any quoted mode-shape literal. */
function buildModeLiteralRegex(): RegExp {
  const literals = MODE_SHAPE_VALUES.map((v) =>
    v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  return new RegExp(`["'](?:${literals})["']`);
}

const MODE_LITERAL_RE = buildModeLiteralRegex();

function classifyFile(relPath: string): FileResult {
  // Exempt by explicit row.
  const exempt = ADMIN_TAB_EXEMPT[relPath];
  if (exempt) {
    return { path: relPath, classification: "exempt", reason: exempt.reason };
  }
  // Exempt by infra pattern (LH menus, breadcrumbs, modals — they live
  // alongside tabs but don't need mode-awareness).
  const fname = relPath.split("/").pop()!;
  for (const re of ADMIN_TAB_INFRA_PATTERNS) {
    if (re.test(fname)) {
      return {
        path: relPath,
        classification: "exempt",
        reason: "infra-helper: matches ADMIN_TAB_INFRA_PATTERNS",
      };
    }
  }
  // Read source + check for any mode-shape literal occurrence.
  let source: string;
  try {
    source = readFileSync(resolve(REPO_ADMIN, relPath), "utf8");
  } catch {
    return { path: relPath, classification: "gap" };
  }
  if (MODE_LITERAL_RE.test(source)) {
    return { path: relPath, classification: "covered" };
  }
  return { path: relPath, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Admin tab Coverage (Lattice Coverage-pillar member)", () => {
  const allFiles = enumerateAdminTabFiles();
  const results: FileResult[] = allFiles.map(classifyFile);

  it("test matrix matches the source-of-truth AuthoredModuleMode union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const m = src.match(/export\s+type\s+AuthoredModuleMode\s*=\s*([^;]+);/m);
    expect(
      m,
      "AuthoredModuleMode export not found in lib/types/json-fields.ts",
    ).toBeTruthy();
    const sourceValues = (m![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sortedSource = [...sourceValues].sort();
    const sortedLocal = [...AUTHORED_MODULE_MODE_VALUES].sort();
    expect(
      sortedSource,
      `Source type union diverged from test matrix. ` +
        `Source: ${sortedSource.join(", ")}; matrix: ${sortedLocal.join(", ")}. ` +
        `Update AUTHORED_MODULE_MODE_VALUES in this file and MODE_SHAPE_VALUES.`,
    ).toEqual(sortedLocal);
  });

  it("enumerates a non-empty set of admin-tab files", () => {
    expect(
      allFiles.length,
      `No admin-tab files enumerated — the surface walker found 0 files. ` +
        `Did the CourseDetail page move? Check ADMIN_TAB_DIRS + TOP_LEVEL_TAB_GLOB.`,
    ).toBeGreaterThan(10);
  });

  it("no admin-tab file is an uncovered gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Producer-only admin-tab files (no mode-shape literal found, no exemption):\n  ${gaps
        .map((g) => g.path)
        .join("\n  ")}\n\nFix options:\n` +
        `  (a) Wire a mode-aware variant — branch on module.mode === "X" in the render path.\n` +
        `  (b) Add the file to ADMIN_TAB_EXEMPT with a >20-char reason.\n` +
        `  (c) If the file is an infra helper (LH menu / modal / breadcrumb), extend ADMIN_TAB_INFRA_PATTERNS.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.path).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: wire the consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — explicit exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const explicitExempt = Object.keys(ADMIN_TAB_EXEMPT);
    expect(
      explicitExempt.length,
      `Explicit exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${explicitExempt.join(", ")}. ` +
        `If you removed an exemption (the tab grew a mode-aware variant), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every explicit exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(ADMIN_TAB_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `${k}: reason too short (${entry.reason.length} chars) — write what makes this tab intentionally exempt`,
      ).toBeGreaterThan(20);
    }
  });

  it("no explicit exempt entry references a path that doesn't exist", () => {
    const missing: string[] = [];
    for (const k of Object.keys(ADMIN_TAB_EXEMPT)) {
      if (!allFiles.includes(k)) missing.push(k);
    }
    expect(
      missing,
      `Exempt entries that point at files NOT enumerated by the walker — stale rows:\n  ${missing.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });

  it("no explicit exempt entry is contradicted by an actual mode-literal match", () => {
    const contradicted: string[] = [];
    for (const path of Object.keys(ADMIN_TAB_EXEMPT)) {
      let src: string;
      try {
        src = readFileSync(resolve(REPO_ADMIN, path), "utf8");
      } catch {
        continue;
      }
      if (MODE_LITERAL_RE.test(src)) contradicted.push(path);
    }
    expect(
      contradicted,
      `Exempt entries that now have a mode-literal reference — drop from ADMIN_TAB_EXEMPT:\n  ${contradicted.join(
        "\n  ",
      )}`,
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
    expect(sum).toBe(allFiles.length);
  });
});
