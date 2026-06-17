/**
 * CourseJourneyTab — Phase P4 (#1850) regression guard for P3b
 * cross-tab Inspector hints.
 *
 * P4 prunes the Journey LH to the 7 Journey-owned buckets (Teaching /
 * Scoring / Voice buckets are no longer reachable via LH). The cross-
 * tab hint card is now the ONLY on-tab affordance for those settings.
 * This test pins that:
 *
 *  1. Out-of-tab Preview click (e.g. `priorCallFeedback`, a Teaching-
 *     owned section) → `<CrossTabHintCard>` mounts in the Inspector slot.
 *  2. Clicking the hint card's primary button fires `onTabSwitch` with
 *     the owning tab id + `{ selectedBucket }` payload.
 *  3. In-tab Preview click (e.g. `intake`, A_intake) → Inspector opens
 *     directly (regression guard for the in-tab path).
 *
 * Mirrors the structure of CourseTeachingTab-cross-tab.test.tsx +
 * CourseScoringTab-cross-tab.test.tsx.
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

// PreviewLens mock — exposes the latest `onSelectSection` callback so
// the test can dispatch section keys without rendering the real lens.
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

import { CourseJourneyTab } from "@/components/journey-tab/CourseJourneyTab";

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

describe("CourseJourneyTab — P4 cross-tab Inspector hint", () => {
  it("renders <CrossTabHintCard> when a Preview click maps to a Teaching-tab bucket (priorCallFeedback → J_feedback)", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseJourneyTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    // priorCallFeedback locators map to J_feedback (Teaching tab) —
    // see CourseTeachingTab-cross-tab.test.tsx for the inverse case.
    expect(__testHooks.lastOnSelect).not.toBeNull();
    act(() => __testHooks.lastOnSelect!("priorCallFeedback"));
    const card = screen.getByTestId("hf-cross-tab-hint-card");
    expect(card).toBeInTheDocument();
    expect(
      within(card).getByTestId("hf-cross-tab-hint-jump"),
    ).toHaveTextContent(/Open in Teaching/);
  });

  it("clicking the jump button fires onTabSwitch with the owning tab + bucket", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseJourneyTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    act(() => __testHooks.lastOnSelect!("priorCallFeedback"));
    fireEvent.click(screen.getByTestId("hf-cross-tab-hint-jump"));
    expect(onTabSwitch).toHaveBeenCalledTimes(1);
    expect(onTabSwitch).toHaveBeenCalledWith("teaching", {
      selectedBucket: "J_feedback",
    });
  });

  it("in-tab Preview click (intake → A_intake) does NOT show the cross-tab hint card", () => {
    // intake lives on the Journey tab via A_intake — the in-tab path
    // catches it before the cross-tab fork runs. Regression guard
    // that the P4 prune didn't break the in-tab affordance.
    //
    // We assert the absence of the cross-tab card (the cross-tab fork
    // never fired) rather than the presence of the A_intake Inspector
    // — the latter depends on URL state propagation through
    // `useJourneySelection` + `next/navigation`'s router, which would
    // require a heavier router mock without adding signal here.
    const onTabSwitch = vi.fn();
    render(
      <CourseJourneyTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    act(() => __testHooks.lastOnSelect!("intake"));
    expect(screen.queryByTestId("hf-cross-tab-hint-card")).toBeNull();
    expect(onTabSwitch).not.toHaveBeenCalled();
  });
});
