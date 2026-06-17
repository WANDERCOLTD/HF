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
  it("renders the continuous-course empty state when courseStyle='continuous'", () => {
    render(<CourseModulesTab courseId="c1" courseStyle="continuous" />);
    expect(screen.getByText(/No modules/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Continuous courses don't have authored modules/i),
    ).toBeInTheDocument();
    // LH picker must NOT mount on continuous courses.
    expect(screen.queryByTestId("hf-modules-lh-picker")).toBeNull();
  });

  it("mounts the empty-state Inspector when no module is selected", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    // ModuleInspectorPanel renders this testid when selectedModuleId is null.
    expect(
      screen.getByTestId("hf-module-inspector-empty"),
    ).toBeInTheDocument();
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

  it("surfaces the course-wide-preview banner only — P3c (#1850) removed the Inspector read-only banner", async () => {
    render(<CourseModulesTab courseId="c1" courseStyle="structured" />);
    const row = await waitFor(() =>
      screen.getByTestId("hf-modules-row-part1"),
    );
    fireEvent.click(row);
    await waitFor(() =>
      screen.getByTestId("hf-module-inspector-part1"),
    );
    // The canvas-side "Showing course-wide preview" banner persists
    // until the preview-scope follow-on lands.
    expect(
      screen.getByText(/Showing course-wide preview/i),
    ).toBeInTheDocument();
    // The Inspector-side "Read-only preview" banner is GONE — the
    // mutator is wired in P3c.
    expect(
      screen.queryByText(/Read-only preview/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/module-scope writer ships in a follow-on/i),
    ).not.toBeInTheDocument();
  });
});
