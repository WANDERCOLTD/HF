/**
 * CurriculumHealthTabs — `readOnly` prop suppresses the two silent
 * auto-reconcile useEffects (issue #418).
 *
 * Today the component fires two background POSTs on mount whenever the
 * scorecard reports orphans:
 *   1. POST /api/curricula/:id/reconcile-orphans
 *   2. POST /api/courses/:id/reconcile-mcqs
 *
 * When the curriculum tab renders this component in preview mode (i.e.
 * the educator is peeking at the derived view on an authored-modules
 * course), those silent fires must not run — they'd mutate a curriculum
 * that isn't the active source of truth. This test holds that contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { CourseLinkageScorecard } from "@/lib/content-trust/validate-lo-linkage";
import { CurriculumHealthTabs } from "@/app/x/courses/[courseId]/CurriculumHealthTabs";

// ── Stubs ──────────────────────────────────────────────────────────────
// The child panels each fire their own data-fetch on mount. Stub them
// here so we don't pollute the fetch spy with unrelated requests.
vi.mock("@/app/x/subjects/_components/CurriculumEditor", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/shared/AssertionDetailDrawer", () => ({
  AssertionDetailDrawer: () => null,
}));

// ── Fixtures ───────────────────────────────────────────────────────────

function scorecardWithOrphans(): CourseLinkageScorecard {
  return {
    course: { id: "course-1", name: "Test" },
    curriculumId: "curr-1",
    health: "needs_attention",
    studentContent: { total: 10, linkedToOutcome: 5, linkedPct: 50 },
    assessmentItems: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
    tutorInstructions: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
    // The two metrics that drive the silent fires
    questions: { total: 8, linkedToTp: 2, linkedPct: 25 }, // 6 orphan MCQs
    structure: {
      activeModules: 3,
      totalModules: 3,
      learningOutcomes: 5,
      outcomesWithContent: 3,
      outcomesWithoutContent: 2, // > 0 → triggers orphan reconcile
      garbageDescriptions: 0,
    },
    warnings: [],
    scorecard: {
      total: 10,
      withValidRef: 5,
      withFk: 5,
      distinctRefs: 5,
      orphans: 5,
      garbageDescriptions: 0,
      coveragePct: 50,
      fkCoveragePct: 50,
    },
    loRows: { total: 5, garbageDescriptions: 0, orphanLos: 2 },
    modules: { total: 3, active: 3 },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("CurriculumHealthTabs — readOnly prop", () => {
  beforeEach(() => {
    localStorage.clear();
    // Default: every fetch resolves with an empty success payload so the
    // panel children (which we also stub) don't throw on json().
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires both silent reconciles on mount when readOnly is false", async () => {
    render(
      <CurriculumHealthTabs
        scorecard={scorecardWithOrphans()}
        courseId="course-1"
        curriculumId="curr-1"
        isOperator={true}
        regenerating={false}
        readOnly={false}
      />,
    );

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => String(c[0]),
      );
      expect(calls.some((u) => u.includes("/reconcile-orphans"))).toBe(true);
      expect(calls.some((u) => u.includes("/reconcile-mcqs"))).toBe(true);
    });
  });

  it("does NOT fire silent reconciles when readOnly is true", async () => {
    render(
      <CurriculumHealthTabs
        scorecard={scorecardWithOrphans()}
        courseId="course-1"
        curriculumId="curr-1"
        isOperator={true}
        regenerating={false}
        readOnly={true}
      />,
    );

    // Give effects a tick to run, then assert nothing matching either
    // reconcile URL was POSTed.
    await new Promise((r) => setTimeout(r, 30));
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(calls.some((u) => u.includes("/reconcile-orphans"))).toBe(false);
    expect(calls.some((u) => u.includes("/reconcile-mcqs"))).toBe(false);
  });
});
