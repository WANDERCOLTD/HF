/**
 * CourseCurriculumTab — segmented toggle + flash fix (issue #418).
 *
 * Covers:
 *  - Renders only a spinner while `activeCurriculumMode` is null (no
 *    flash of the wrong panel on mount).
 *  - With `activeCurriculumMode="authored"`, the Authored panel is the
 *    default view; switching the toggle to Derived shows a preview-mode
 *    banner and mounts CurriculumHealthTabs in read-only mode with a
 *    reconcile-only subset of regenerate actions.
 *  - With `activeCurriculumMode="derived"`, the Derived view (scorecard)
 *    is default; switching to Authored shows the AuthoredModulesPanel.
 *  - The internal McqPanel section is suppressed in preview mode on the
 *    Authored branch (the Derived view brings its own MCQ tab).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

// ── Child mocks ────────────────────────────────────────────────────────
// We stub the heavy children so we can assert on the parent's branching
// logic without pulling in their own fetches / DOM.
const authoredMock = vi.fn();
const healthMock = vi.fn();
const mcqMock = vi.fn();

vi.mock("@/app/x/courses/[courseId]/_components/AuthoredModulesPanel", () => ({
  AuthoredModulesPanel: (props: { courseId: string; isOperator: boolean }) => {
    authoredMock(props);
    return <div data-testid="authored-panel">authored</div>;
  },
}));

vi.mock("@/app/x/courses/[courseId]/CurriculumHealthTabs", () => ({
  CurriculumHealthTabs: (props: {
    readOnly?: boolean;
    regenerateActions?: Record<string, unknown>;
  }) => {
    healthMock(props);
    return (
      <div
        data-testid="health-tabs"
        data-readonly={props.readOnly ? "true" : "false"}
        data-action-keys={
          props.regenerateActions
            ? Object.keys(props.regenerateActions).sort().join(",")
            : ""
        }
      >
        health
      </div>
    );
  },
  McqPanel: (props: { courseId: string }) => {
    mcqMock(props);
    return <div data-testid="mcq-panel">mcq</div>;
  },
}));

// Stub fetch — scorecard endpoint is the only one the tab hits directly.
function mockScorecard() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      scorecard: {
        course: { id: "c1", name: "Test" },
        curriculumId: "curr-1",
        health: "ready",
        studentContent: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
        assessmentItems: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
        tutorInstructions: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
        questions: { total: 0, linkedToTp: 0, linkedPct: 0 },
        structure: {
          activeModules: 3,
          totalModules: 3,
          learningOutcomes: 5,
          outcomesWithContent: 5,
          outcomesWithoutContent: 0,
          garbageDescriptions: 0,
        },
        warnings: [],
        scorecard: {
          total: 0,
          withValidRef: 0,
          withFk: 0,
          distinctRefs: 0,
          orphans: 0,
          garbageDescriptions: 0,
          coveragePct: 0,
          fkCoveragePct: 0,
        },
        loRows: { total: 5, garbageDescriptions: 0, orphanLos: 0 },
        modules: { total: 3, active: 3 },
      },
    }),
  }) as unknown as typeof fetch;
}

// Import after the mocks are registered.
import { CourseCurriculumTab } from "@/app/x/courses/[courseId]/CourseCurriculumTab";

beforeEach(() => {
  authoredMock.mockReset();
  healthMock.mockReset();
  mcqMock.mockReset();
  mockScorecard();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("CourseCurriculumTab — flash prevention (#418)", () => {
  it("renders only a spinner while activeCurriculumMode is null", () => {
    const { container } = render(
      <CourseCurriculumTab
        courseId="c1"
        playbookId="c1"
        isOperator={true}
        activeCurriculumMode={null}
      />,
    );
    expect(container.querySelector(".hf-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("authored-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("health-tabs")).not.toBeInTheDocument();
  });
});

describe("CourseCurriculumTab — Authored mode active", () => {
  it("renders the Authored panel by default and exposes the toggle", async () => {
    render(
      <CourseCurriculumTab
        courseId="c1"
        playbookId="c1"
        isOperator={true}
        activeCurriculumMode="authored"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("authored-panel")).toBeInTheDocument();
    });
    // CurriculumHealthTabs is NOT mounted in the default Authored view.
    expect(screen.queryByTestId("health-tabs")).not.toBeInTheDocument();
    // Toggle present with both options.
    expect(screen.getByRole("tab", { name: /Authored/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Derived/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switching to Derived shows preview banner, mounts health-tabs in readOnly with reconcile-only actions", async () => {
    render(
      <CourseCurriculumTab
        courseId="c1"
        playbookId="c1"
        isOperator={true}
        activeCurriculumMode="authored"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("authored-panel")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Derived/ }));
    });

    // Preview banner appears.
    expect(screen.getByText(/Preview only/i)).toBeInTheDocument();
    // Health tabs now mounted in read-only mode.
    const tabs = await screen.findByTestId("health-tabs");
    expect(tabs.getAttribute("data-readonly")).toBe("true");
    // Only the link-only / idempotent actions are exposed in preview.
    expect(tabs.getAttribute("data-action-keys")).toBe(
      ["onReconcileTPs", "onRegenerateMcqs"].sort().join(","),
    );
  });
});

describe("CourseCurriculumTab — Derived mode active", () => {
  it("renders CurriculumHealthTabs by default with full actions and readOnly=false", async () => {
    render(
      <CourseCurriculumTab
        courseId="c1"
        playbookId="c1"
        isOperator={true}
        activeCurriculumMode="derived"
      />,
    );
    const tabs = await screen.findByTestId("health-tabs");
    expect(tabs.getAttribute("data-readonly")).toBe("false");
    expect(tabs.getAttribute("data-action-keys")).toBe(
      [
        "onReExtractInstructions",
        "onReclassifyLos",
        "onReconcileTPs",
        "onRegenerateMcqs",
        "onRegenerateModules",
      ]
        .sort()
        .join(","),
    );
    // Authored panel is hidden in the active Derived view.
    expect(screen.queryByTestId("authored-panel")).not.toBeInTheDocument();
  });

  it("switching to Authored shows the AuthoredModulesPanel as a preview", async () => {
    render(
      <CourseCurriculumTab
        courseId="c1"
        playbookId="c1"
        isOperator={true}
        activeCurriculumMode="derived"
      />,
    );
    await screen.findByTestId("health-tabs");

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Authored/ }));
    });

    expect(screen.getByTestId("authored-panel")).toBeInTheDocument();
    expect(screen.getByText(/Preview only/i)).toBeInTheDocument();
    // McqPanel section is hidden in preview mode on the authored branch
    // (the user is peeking, not configuring; the active Derived view's
    // own MCQ tab is the canonical surface).
    expect(screen.queryByTestId("mcq-panel")).not.toBeInTheDocument();
  });
});
