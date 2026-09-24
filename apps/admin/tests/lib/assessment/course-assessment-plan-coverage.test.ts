/**
 * CourseAssessmentPlan Coverage — Lattice 5th-pillar Coverage test
 * (epic #2176 S3).
 *
 * **What this test pins:**
 *  For every published course HF ships, the operator has consciously
 *  decided ONE of:
 *    (a) declared a `CourseAssessmentPlan` whose moments resolve end-
 *        to-end (module exists in the playbook's modules[] list, mode
 *        matches the moment kind, FirstCallMode is consistent, the
 *        cited AnalysisSpec exists in the corpus, and the shellKind is
 *        a valid `LearnerShellKind`), OR
 *    (b) declared `noAssessmentPlan: true` to opt out explicitly.
 *
 *  Anything else is a `gap` — the operator hasn't decided. The ratchet
 *  pins the incumbent count: future PRs may add EXEMPT entries (with a
 *  one-line reason) or close gaps (drop the ratchet). They may never
 *  silently grow the gap count.
 *
 * **Why we walk a curated manifest (not a fixture directory):**
 *  Today there are no per-course Playbook JSON fixtures under
 *  `apps/admin/lib/wizard/__tests__/fixtures/` — the only fixtures
 *  there are markdown course-references (used by the wizard parser
 *  tests). The published-playbook state lives in hf_staging / hf_sandbox
 *  DB rows; the operator's source of truth at PR time is THIS manifest,
 *  curated against MEMORY.md's known-published-set. When a new course
 *  ships, the operator adds a row here AND updates the staging seed.
 *
 *  This is the same shape as PR #2144's `mode-ui-coverage.test.ts`
 *  (enumerate → classify → exempt-with-reason → ratchet) — see that
 *  file for the canonical reference.
 *
 * **How matching works:**
 *  For each course row in `COURSES_UNDER_COVERAGE`:
 *    1. If `plan` is undefined AND not in `COURSE_EXEMPT` → classify
 *       `gap` (the operator hasn't decided).
 *    2. If `plan.noAssessmentPlan === true` → classify
 *       `exempt-no-plan` (acceptable v1).
 *    3. Otherwise walk each declared moment (upfront / midpoints[] /
 *       end):
 *       a. `moduleSlug` must appear in `modules[]` — else `gap`.
 *       b. The module's `mode` must be compatible with `kind` per
 *          `KIND_MODE_COMPATIBILITY` — else `gap`.
 *       c. When the moment is `upfront-baseline`, the playbook's
 *          `firstCallMode` MUST be `"baseline_assessment"`. When
 *          `firstCallMode === "baseline_assessment"`, the plan's
 *          `upfront.kind` MUST be `"upfront-baseline"`. Drift in
 *          either direction → `gap`.
 *       d. `scoringSpec` must resolve to a `*.spec.json` in
 *          `docs-archive/bdd-specs/` — else `gap`.
 *       e. `shellKind` must be a valid `LearnerShellKind` literal —
 *          else `gap` (runtime check for drift if the source-of-
 *          truth in #2173 ever changes without this manifest's
 *          knowledge).
 *
 * **How to fix a failure:**
 *  - "Cell X.Y is a gap": declare a plan for the course in
 *    `COURSES_UNDER_COVERAGE` (or `noAssessmentPlan: true`), OR add
 *    the course id to `COURSE_EXEMPT` with a one-line reason and bump
 *    `EXPECTED_EXEMPT_COUNT`.
 *  - "Ratchet drifted up": you added a course without making a plan
 *    decision. Decide consciously.
 *  - "Stale exempt entry": the course now has a plan; remove the
 *    exempt row and drop `EXPECTED_EXEMPT_COUNT` by 1.
 *
 *  See `.claude/rules/course-assessment-plan-coverage.md` (S7 follow-
 *  on) for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ASSESSMENT_KIND_VALUES,
  type CourseAssessmentPlan,
  type AuthoredModuleMode,
} from "@/lib/types/json-fields";
import { KIND_MODE_COMPATIBILITY } from "@/lib/assessment/kind-mode-compatibility";
import { classifyPlanResolution } from "@/lib/assessment/classify-plan-resolution";

// ────────────────────────────────────────────────────────────────────
// Repo / spec corpus discovery
// ────────────────────────────────────────────────────────────────────

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const SPEC_DIR = join(REPO_ADMIN, "docs-archive", "bdd-specs");

function discoverSpecSlugs(): Set<string> {
  if (!existsSync(SPEC_DIR)) return new Set();
  return new Set(
    readdirSync(SPEC_DIR)
      .filter((n) => n.endsWith(".spec.json"))
      .map((n) => n.replace(/\.spec\.json$/, "")),
  );
}

const KNOWN_SPEC_SLUGS = discoverSpecSlugs();

// ────────────────────────────────────────────────────────────────────
// Compatibility matrix is now in `lib/assessment/kind-mode-compatibility.ts`
// (single source of truth shared with the UI editor — #2176 S1).
// ────────────────────────────────────────────────────────────────────
// Curated manifest — every course HF currently ships in published state
//
// Source of truth: MEMORY.md "2026-06-19 — Stable DEV staging" entry
// (4 PUBLISHED post-prune) + the unpublished-as-broken trio (Intro to
// Psychology, CIO/CTO Pop Quiz, CIO/CTO Exam Assessment — kept in the
// manifest because they will return once #2009 ships).
//
// **Adding a new course:** insert a row here AND either declare a plan
// OR opt out via `noAssessmentPlan: true`. The ratchet WILL fail
// unless you do.
// ────────────────────────────────────────────────────────────────────

interface CourseModuleManifest {
  slug: string;
  mode: AuthoredModuleMode;
}

interface CourseUnderCoverage {
  /** Stable identifier (slug from MEMORY.md or wizard output). */
  id: string;
  /** Human-readable title for diagnostics. */
  title: string;
  /** Module list mirrored from `Playbook.config.modules[]`. */
  modules: ReadonlyArray<CourseModuleManifest>;
  /** Mirrored from `Playbook.config.firstCallMode`. */
  firstCallMode?: "onboarding" | "teach_immediately" | "baseline_assessment";
  /** The plan declaration this coverage gate is pinning. */
  plan?: CourseAssessmentPlan;
}

const COURSES_UNDER_COVERAGE: ReadonlyArray<CourseUnderCoverage> = [
  // IELTS Speaking — has Baseline + Mock modules; S5 will populate the plan once #2167 lands.
  {
    id: "ielts-speaking-practice",
    title: "IELTS Speaking Practice",
    modules: [
      { slug: "baseline", mode: "examiner" },
      { slug: "part-1", mode: "tutor" },
      { slug: "part-2", mode: "examiner" },
      { slug: "part-3", mode: "tutor" },
      { slug: "mock-exam", mode: "mock-exam" },
    ],
    firstCallMode: "baseline_assessment",
    // plan absent → gap (S5 lands the IELTS plan once #2167 IELTS Sources backfill ships)
  },
  // Spot the Spin — coaching-led, no formal assessment.
  {
    id: "spot-the-spin",
    title: "Spot the Spin",
    modules: [{ slug: "default", mode: "tutor" }],
    // plan absent → gap (S6 operator decision needed)
  },
  // Big Five (OCEAN) — 6-module personality course; sessionTerminal Module 6 is the wrap-up, not formal scoring.
  {
    id: "big-five-ocean",
    title: "Big Five OCEAN",
    modules: [
      { slug: "mod-1", mode: "tutor" },
      { slug: "mod-2", mode: "tutor" },
      { slug: "mod-3", mode: "tutor" },
      { slug: "mod-4", mode: "tutor" },
      { slug: "mod-5", mode: "tutor" },
      { slug: "mod-6", mode: "tutor" },
    ],
    // plan absent → gap (S6 operator decision needed)
  },
  // CIO/CTO Standard — Revision Aid — by design coaching-led, no terminal.
  {
    id: "cio-cto-revision-aid",
    title: "CIO/CTO Standard — Revision Aid",
    modules: [{ slug: "default", mode: "mixed" }],
    // plan absent → gap (S6 operator decision needed)
  },
  // Intro to Psychology — unpublished as broken (0 modules) 2026-06-19;
  // kept here for explicit operator decision once it returns.
  {
    id: "intro-to-psychology",
    title: "Intro to Psychology",
    modules: [],
    // plan absent → gap
  },
  // CIO/CTO Pop Quiz — unpublished as broken (0 modules) 2026-06-19;
  // will return once #2009 ships the quiz consumer.
  {
    id: "cio-cto-pop-quiz",
    title: "CIO/CTO Pop Quiz",
    modules: [],
    // plan absent → gap (returns post-#2009)
  },
  // CIO/CTO Exam Assessment — unpublished as broken (0 modules) 2026-06-19;
  // will return once #2009 ships the mock-exam consumer.
  {
    id: "cio-cto-exam-assessment",
    title: "CIO/CTO Exam Assessment",
    modules: [],
    // plan absent → gap (returns post-#2009)
  },
];

// ────────────────────────────────────────────────────────────────────
// Exempt list — courses excused from plan declaration with a reason.
// ────────────────────────────────────────────────────────────────────

interface ExemptReason {
  reason: string;
}

const COURSE_EXEMPT: Record<string, ExemptReason> = {
  // Empty at launch — every course MUST make a conscious decision per
  // epic #2176. Slot reserved for future Exemptions with documented
  // reasons (>20 chars). Example:
  // "some-future-course": { reason: "private internal QA harness, never enrolled" },
};

const EXPECTED_EXEMPT_COUNT = 0;
const EXPECTED_GAP_COUNT = 7; // every course in the manifest is currently a gap (calibrated 2026-06-21)

// ────────────────────────────────────────────────────────────────────
// Classification — delegates to the shared classifier at
// `lib/assessment/classify-plan-resolution.ts` (single source of
// truth shared with the Course Overview badge, per S13). The
// Coverage gate adds a `exempt-courseLevel` bucket on top because
// courses can be exempted at the manifest level here (a concern
// the runtime badge doesn't share).
// ────────────────────────────────────────────────────────────────────

type Classification =
  | { kind: "covered"; courseId: string }
  | { kind: "exempt-no-plan"; courseId: string }
  | { kind: "exempt-courseLevel"; courseId: string; reason: string }
  | { kind: "gap"; courseId: string; reasons: string[] };

function classifyCourse(course: CourseUnderCoverage): Classification {
  // exempt at course-level — handled here, not in the shared classifier
  const exempt = COURSE_EXEMPT[course.id];
  if (exempt) {
    return { kind: "exempt-courseLevel", courseId: course.id, reason: exempt.reason };
  }

  // Delegate to the shared classifier. The Coverage gate passes the
  // full spec corpus so missing spec slugs flip the result to
  // `partial`. The badge runtime omits this — see classifier docs.
  const status = classifyPlanResolution({
    plan: course.plan,
    modules: course.modules,
    firstCallMode: course.firstCallMode,
    knownSpecSlugs: KNOWN_SPEC_SLUGS,
  });

  switch (status.kind) {
    case "missing":
      return {
        kind: "gap",
        courseId: course.id,
        reasons: ["no assessmentPlan declared (operator must declare a plan OR set noAssessmentPlan:true)"],
      };
    case "no-plan":
      return { kind: "exempt-no-plan", courseId: course.id };
    case "partial":
      return { kind: "gap", courseId: course.id, reasons: status.reasons };
    case "resolved":
      return { kind: "covered", courseId: course.id };
  }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("CourseAssessmentPlan Coverage gate", () => {
  it("ASSESSMENT_KIND_VALUES exhaustively covers the literal union", () => {
    // Compile-time check: every kind in the matrix is a known value
    for (const kind of Object.keys(KIND_MODE_COMPATIBILITY)) {
      expect(ASSESSMENT_KIND_VALUES).toContain(kind);
    }
    // And the matrix covers every value
    for (const value of ASSESSMENT_KIND_VALUES) {
      expect(Object.keys(KIND_MODE_COMPATIBILITY)).toContain(value);
    }
  });

  it("spec corpus is discoverable (sanity)", () => {
    expect(KNOWN_SPEC_SLUGS.size).toBeGreaterThan(0);
    // The IELTS measure spec is a known anchor.
    expect(KNOWN_SPEC_SLUGS.has("IELTS-MEASURE-001-ielts-speaking-criteria")).toBe(true);
  });

  it("gap count matches ratchet", () => {
    const classifications = COURSES_UNDER_COVERAGE.map(classifyCourse);
    const gaps = classifications.filter((c) => c.kind === "gap");
    const messages = gaps.map((g) => {
      if (g.kind !== "gap") return "";
      return `  - ${g.courseId}: ${g.reasons.join(" | ")}`;
    });
    expect(
      gaps.length,
      `Gap count drifted. Expected ${EXPECTED_GAP_COUNT}, found ${gaps.length}.\n${messages.join("\n")}`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("exempt count matches ratchet", () => {
    const exemptIds = Object.keys(COURSE_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt list size drifted. Update EXPECTED_EXEMPT_COUNT consciously.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a reason ≥20 chars", () => {
    for (const [id, exempt] of Object.entries(COURSE_EXEMPT)) {
      expect(exempt.reason.length, `Exempt ${id} reason too short`).toBeGreaterThanOrEqual(20);
    }
  });

  it("no exempt entry references a course not in the manifest (stale)", () => {
    const known = new Set(COURSES_UNDER_COVERAGE.map((c) => c.id));
    for (const id of Object.keys(COURSE_EXEMPT)) {
      expect(known.has(id), `Stale exempt entry: ${id}`).toBe(true);
    }
  });

  it("no exempt course also declares a plan (contradiction)", () => {
    for (const id of Object.keys(COURSE_EXEMPT)) {
      const course = COURSES_UNDER_COVERAGE.find((c) => c.id === id);
      if (!course) continue;
      expect(
        course.plan === undefined,
        `Course ${id} is exempt but also declares a plan — pick one`,
      ).toBe(true);
    }
  });

  it("classification distribution covers every course exactly once", () => {
    const classifications = COURSES_UNDER_COVERAGE.map(classifyCourse);
    const counts = {
      covered: 0,
      exemptNoPlan: 0,
      exemptCourseLevel: 0,
      gap: 0,
    };
    for (const c of classifications) {
      if (c.kind === "covered") counts.covered++;
      else if (c.kind === "exempt-no-plan") counts.exemptNoPlan++;
      else if (c.kind === "exempt-courseLevel") counts.exemptCourseLevel++;
      else counts.gap++;
    }
    expect(
      counts.covered + counts.exemptNoPlan + counts.exemptCourseLevel + counts.gap,
    ).toBe(COURSES_UNDER_COVERAGE.length);
  });
});
