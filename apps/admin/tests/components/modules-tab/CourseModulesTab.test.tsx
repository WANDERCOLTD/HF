import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

// jsdom doesn't ship matchMedia; DesignerShell uses it for the narrow-
// viewport drawer behaviour. Stub once for the file (mirrors
// `tests/components/designer-shell.test.tsx`).
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { CourseModulesTab } from "@/components/modules-tab/CourseModulesTab";

// Mock PreviewLens — it pulls in fetch + composition pipeline state that
// the tab-level mount test doesn't need to exercise (the journey-tab
// sibling tests follow the same shape: test the Inspector wiring, not
// the canvas).
vi.mock("@/app/x/courses/[courseId]/_components/PreviewLens", () => ({
  PreviewLens: () => <div data-testid="hf-mock-preview-lens" />,
}));

const moduleFixtures = [
  {
    id: "part1",
    label: "Part 1 — Interview",
    duration: "4 min fixed",
    mode: "examiner",
    frequency: "repeatable",
    learnerSelectable: true,
    sessionTerminal: false,
    position: 1,
    settings: {
      questionTarget: { min: 10, target: 13 },
    },
  },
  {
    id: "part2",
    label: "Part 2 — Long Turn",
    duration: "4 min fixed",
    mode: "examiner",
    frequency: "repeatable",
    learnerSelectable: true,
    sessionTerminal: false,
    position: 2,
    settings: {
      questionTarget: { min: 1, target: 1 },
      cueCardPool: [{ topic: "A book", bullets: ["author", "why"] }],
    },
  },
];

beforeEach(() => {
  global.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({ ok: true, modules: moduleFixtures }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe("CourseModulesTab — P3 (#1850) Inspector wiring", () => {
  it("renders the continuous-course empty state when courseStyle='continuous' AND no authored modules", () => {
    render(<CourseModulesTab courseId="c1" courseStyle="continuous" />);
    expect(screen.getByText(/No modules/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Continuous courses don't have authored modules/i),
    ).toBeInTheDocument();
    // LH picker must NOT mount on continuous courses.
    expect(screen.queryByTestId("hf-modules-lh-picker")).toBeNull();
  });

  it("mounts the canvas empty-state when no module is selected", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    // Post-#2120/#2121, the canvas is `ModuleEditor`; when no module
    // is selected it renders its own "Pick a module to tune" empty.
    expect(screen.getByTestId("hf-module-editor-empty")).toBeInTheDocument();
  });

  it("lists modules from the dedicated /api/courses/<id>/modules route", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    // ModulesLhPicker fires the fetch on mount; rows appear once it resolves.
    await waitFor(() => {
      expect(screen.getByTestId("hf-modules-row-part1")).toBeInTheDocument();
      expect(screen.getByTestId("hf-modules-row-part2")).toBeInTheDocument();
    });
    // Fetch hit the dedicated route, NOT the legacy /sessions one.
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const urls = calls.map((args) => String(args[0]));
    expect(urls.some((u) => u.includes("/api/courses/c1/modules"))).toBe(true);
    expect(urls.every((u) => !u.includes("/api/courses/c1/sessions"))).toBe(
      true,
    );
  });

  it("clicking a module mounts the per-module Inspector with G8 rows", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    const row = await waitFor(() =>
      screen.getByTestId("hf-modules-row-part1"),
    );
    fireEvent.click(row);
    // The inspector container appears, keyed on the selected module id.
    await waitFor(() => {
      expect(
        screen.getByTestId("hf-module-inspector-part1"),
      ).toBeInTheDocument();
    });
    // At least one G8 row renders (the module-scoped settings).
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
  });

  // 4-cell matrix pinning the (lessonPlanMode × modules.length) gate:
  // the empty-state must fire only when BOTH continuous AND zero
  // authored modules — modules-present always wins. Live evidence:
  // IELTS Speaking Practice ships 5 modules with `lessonPlanMode`
  // unset; the parent-fork casts `courseStyle` to `"continuous"`, but
  // the Modules tab must still show the 5 authored modules.
  describe("modules-present overrides continuous empty-state", () => {
    const playbookConfigWithModules = {
      modules: [
        { id: "part1", label: "Part 1" },
        { id: "part2", label: "Part 2" },
        { id: "part3", label: "Part 3" },
        { id: "baseline", label: "Baseline" },
        { id: "mock", label: "Mock" },
      ],
    };

    it("structured + 0 modules → modules surface (NOT continuous empty-state)", () => {
      render(
        <CourseModulesTab
          courseId="c1"
          courseStyle="structured"
          playbookConfig={{ modules: [] }}
        />,
      );
      // Continuous empty-state copy must be absent.
      expect(
        screen.queryByText(/Continuous courses don't have authored modules/i),
      ).toBeNull();
      // The modules-tab surface renders — picker mounts. The canvas
      // shows the editor's "Pick a module to tune" empty state when
      // no module is selected.
      expect(screen.getByTestId("hf-modules-lh-picker")).toBeInTheDocument();
      expect(
        screen.getByTestId("hf-module-editor-empty"),
      ).toBeInTheDocument();
    });

    it("structured + 5 modules → modules surface populated", async () => {
      render(
        <CourseModulesTab
          courseId="c1"
          courseStyle="structured"
          playbookConfig={playbookConfigWithModules}
        />,
      );
      expect(
        screen.queryByText(/Continuous courses don't have authored modules/i),
      ).toBeNull();
      await waitFor(() => {
        expect(screen.getByTestId("hf-modules-row-part1")).toBeInTheDocument();
        expect(screen.getByTestId("hf-modules-row-part2")).toBeInTheDocument();
      });
    });

    it("continuous + 0 modules → continuous empty-state (the canonical empty case)", () => {
      render(
        <CourseModulesTab
          courseId="c1"
          courseStyle="continuous"
          playbookConfig={{ modules: [] }}
        />,
      );
      expect(
        screen.getByText(/Continuous courses don't have authored modules/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("hf-modules-lh-picker")).toBeNull();
    });

    it("continuous + 5 modules → modules surface populated (the bug fix)", async () => {
      // Live fingerprint: IELTS Speaking Practice ships 5 modules with
      // `lessonPlanMode` unset → parent-fork casts to "continuous" →
      // pre-fix the operator saw the continuous empty-state instead of
      // their authored modules.
      render(
        <CourseModulesTab
          courseId="c1"
          courseStyle="continuous"
          playbookConfig={playbookConfigWithModules}
        />,
      );
      expect(
        screen.queryByText(/Continuous courses don't have authored modules/i),
      ).toBeNull();
      expect(screen.queryByText(/No modules/i)).toBeNull();
      await waitFor(() => {
        expect(screen.getByTestId("hf-modules-row-part1")).toBeInTheDocument();
        expect(screen.getByTestId("hf-modules-row-part2")).toBeInTheDocument();
      });
    });
  });

  it("Inspector read-only banner is GONE — P3c (#1850) wired the mutator", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    const row = await waitFor(() =>
      screen.getByTestId("hf-modules-row-part1"),
    );
    fireEvent.click(row);
    await waitFor(() =>
      screen.getByTestId("hf-module-inspector-part1"),
    );
    // The Inspector-side "Read-only preview" banner is GONE — the
    // mutator is wired in P3c. (The post-#2120/#2121 refactor also
    // dropped the canvas-side "Showing course-wide preview" banner.)
    expect(
      screen.queryByText(/Read-only preview/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/module-scope writer ships in a follow-on/i),
    ).not.toBeInTheDocument();
  });
});
