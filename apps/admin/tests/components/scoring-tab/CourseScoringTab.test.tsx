import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";

// jsdom doesn't ship matchMedia; DesignerShell uses it for the narrow-
// viewport drawer behaviour. Stub once for the file.
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

import { CourseScoringTab } from "@/components/scoring-tab/CourseScoringTab";

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

describe("CourseScoringTab — P1 (#1850) Inspector wiring", () => {
  it("mounts the empty-state Inspector when no bucket is selected", () => {
    render(<CourseScoringTab courseId="c1" playbookConfig={{}} />);
    expect(
      screen.getByTestId("hf-journey-inspector-empty"),
    ).toBeInTheDocument();
  });

  it("renders only Scoring-tab buckets in the LH menu", () => {
    render(<CourseScoringTab courseId="c1" playbookConfig={{}} />);
    // BUCKETS_BY_TAB.scoring = [I_scoring, K_between_calls].
    expect(
      screen.getByTestId("hf-scoring-bucket-row-I_scoring"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-scoring-bucket-row-K_between_calls"),
    ).toBeInTheDocument();
    // Teaching + Journey buckets do not leak in.
    expect(
      screen.queryByTestId("hf-scoring-bucket-row-C_teaching_style"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-scoring-bucket-row-A_intake"),
    ).toBeNull();
  });

  it("clicking a Scoring bucket mounts the real Inspector with that bucket's stack", () => {
    render(<CourseScoringTab courseId="c1" playbookConfig={{}} />);
    fireEvent.click(
      screen.getByTestId("hf-scoring-bucket-row-I_scoring"),
    );
    const inspectorRoot = screen.getByTestId(
      "hf-journey-inspector-bucket-I_scoring",
    );
    expect(inspectorRoot).toBeInTheDocument();
    // Header copy from JOURNEY_MENU_ITEMS_BY_ID for I_scoring, scoped
    // to the Inspector container (LH menu uses the same label).
    expect(
      within(inspectorRoot).getByText(/How learners are scored/),
    ).toBeInTheDocument();
  });

  it("does not show the old P0 placeholder text once wired", () => {
    render(<CourseScoringTab courseId="c1" playbookConfig={{}} />);
    fireEvent.click(
      screen.getByTestId("hf-scoring-bucket-row-I_scoring"),
    );
    expect(
      screen.queryByText(/Inspector slot — wires up post-P0/),
    ).toBeNull();
  });
});
