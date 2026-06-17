import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
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

import { CourseTeachingTab } from "@/components/teaching-tab/CourseTeachingTab";

// Mock PreviewLens — it pulls in fetch + composition pipeline state that
// the tab-level mount test doesn't need to exercise (the journey-tab
// sibling tests follow the same shape: test the Inspector wiring, not
// the canvas).
vi.mock("@/app/x/courses/[courseId]/_components/PreviewLens", () => ({
  PreviewLens: () => <div data-testid="hf-mock-preview-lens" />,
}));

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response),
);

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockClear();
});

describe("CourseTeachingTab — P1 (#1850) Inspector wiring", () => {
  it("mounts the empty-state Inspector when no bucket is selected", () => {
    render(<CourseTeachingTab courseId="c1" playbookConfig={{}} />);
    // JourneyInspectorPanel renders this testid when selectedBucketId is null.
    expect(
      screen.getByTestId("hf-journey-inspector-empty"),
    ).toBeInTheDocument();
  });

  it("renders only Teaching-tab buckets in the LH menu", () => {
    render(<CourseTeachingTab courseId="c1" playbookConfig={{}} />);
    // BUCKETS_BY_TAB.teaching = [C_teaching_style, E_learner_visual,
    // F_stall_recovery, J_feedback]. All 4 rows present.
    expect(
      screen.getByTestId("hf-teaching-bucket-row-C_teaching_style"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-teaching-bucket-row-E_learner_visual"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-teaching-bucket-row-F_stall_recovery"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-teaching-bucket-row-J_feedback"),
    ).toBeInTheDocument();
    // Journey-tab buckets (A_intake, B_call1_opening etc.) must NOT
    // leak into the teaching LH.
    expect(
      screen.queryByTestId("hf-teaching-bucket-row-A_intake"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-teaching-bucket-row-B_call1_opening"),
    ).toBeNull();
  });

  it("clicking a Teaching bucket mounts the real Inspector with that bucket's stack", () => {
    render(<CourseTeachingTab courseId="c1" playbookConfig={{}} />);
    fireEvent.click(
      screen.getByTestId("hf-teaching-bucket-row-C_teaching_style"),
    );
    // JourneyInspectorPanel mounts the bucket container — proves we're
    // running the real component (not the prior <div>Inspector slot…</div>
    // P0 placeholder, which carried no such testid).
    const inspectorRoot = screen.getByTestId(
      "hf-journey-inspector-bucket-C_teaching_style",
    );
    expect(inspectorRoot).toBeInTheDocument();
    // And the header copy from JOURNEY_MENU_ITEMS_BY_ID, scoped to the
    // Inspector container (the LH menu uses the same label string).
    expect(
      within(inspectorRoot).getByText(/How the tutor teaches every call/),
    ).toBeInTheDocument();
  });

  it("does not show the old P0 placeholder text once wired", () => {
    render(<CourseTeachingTab courseId="c1" playbookConfig={{}} />);
    fireEvent.click(
      screen.getByTestId("hf-teaching-bucket-row-F_stall_recovery"),
    );
    // The P0 placeholder said "Inspector slot — wires up post-P0"; we
    // remove that path entirely in P1. The empty-reservation bucket
    // header (still rendered by the panel for empty IELTS-deferred
    // buckets) is the expected content.
    expect(
      screen.queryByText(/Inspector slot — wires up post-P0/),
    ).toBeNull();
  });
});
