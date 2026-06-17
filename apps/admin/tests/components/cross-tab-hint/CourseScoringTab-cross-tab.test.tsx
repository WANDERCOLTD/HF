/**
 * CourseScoringTab — Phase P3b (#1850) cross-tab Inspector hint tests.
 *
 * Verifies the same out-of-tab / in-tab / jump flow as the Teaching
 * sibling, with the Scoring tab as the current tab.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
  act,
} from "@testing-library/react";

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

const __testHooks: { lastOnSelect: ((s: string | null) => void) | null } = {
  lastOnSelect: null,
};
vi.mock("@/app/x/courses/[courseId]/_components/PreviewLens", () => ({
  PreviewLens: ({
    onSelectSection,
  }: {
    onSelectSection?: (s: string | null) => void;
  }) => {
    __testHooks.lastOnSelect = onSelectSection ?? null;
    return <div data-testid="hf-mock-preview-lens" />;
  },
}));

import { CourseScoringTab } from "@/components/scoring-tab/CourseScoringTab";

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response),
);

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockClear();
  __testHooks.lastOnSelect = null;
});

describe("CourseScoringTab — P3b cross-tab Inspector hint", () => {
  it("renders <CrossTabHintCard> when a Preview click maps to a Journey-tab bucket (intake)", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseScoringTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    act(() => __testHooks.lastOnSelect!("intake"));
    const card = screen.getByTestId("hf-cross-tab-hint-card");
    expect(card).toBeInTheDocument();
    expect(
      within(card).getByTestId("hf-cross-tab-hint-jump"),
    ).toHaveTextContent(/Open in Journey/);
  });

  it("clicking the jump button fires onTabSwitch with the owning tab + bucket", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseScoringTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    act(() => __testHooks.lastOnSelect!("intake"));
    fireEvent.click(screen.getByTestId("hf-cross-tab-hint-jump"));
    expect(onTabSwitch).toHaveBeenCalledTimes(1);
    expect(onTabSwitch).toHaveBeenCalledWith("journey", {
      selectedBucket: "A_intake",
    });
  });

  it("clicking a Scoring LH bucket still opens the Inspector directly (regression guard)", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseScoringTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-scoring-bucket-row-I_scoring"));
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-I_scoring"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("hf-cross-tab-hint-card")).toBeNull();
    expect(onTabSwitch).not.toHaveBeenCalled();
  });

  it("seeds the Inspector from ?selectedBucket= when the param is in scope", () => {
    render(
      <CourseScoringTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={vi.fn()}
        selectedBucketParam="I_scoring"
      />,
    );
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-I_scoring"),
    ).toBeInTheDocument();
  });

  it("ignores ?selectedBucket= when the bucket is out of scope (URL meant for another tab)", () => {
    render(
      <CourseScoringTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={vi.fn()}
        selectedBucketParam="A_intake"
      />,
    );
    // Should show the empty Inspector (no bucket selected) — the
    // foreign bucket id is silently ignored on this tab.
    expect(screen.getByTestId("hf-journey-inspector-empty")).toBeInTheDocument();
  });
});
