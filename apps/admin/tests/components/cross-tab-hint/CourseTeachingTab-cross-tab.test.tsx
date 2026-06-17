/**
 * CourseTeachingTab — Phase P3b (#1850) cross-tab Inspector hint tests.
 *
 * Verifies:
 *  1. Out-of-tab Preview click → `<CrossTabHintCard>` mounts in the
 *     Inspector slot with the owning bucket's label + tab label.
 *  2. Clicking the hint card's primary button fires `onTabSwitch` with
 *     the owning tab id + `{ selectedBucket }` payload.
 *  3. In-tab Preview click → Inspector opens directly (regression guard
 *     for the pre-P3b behaviour).
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

// PreviewLens mock exposes a hook to fire `onSelectSection` from the
// test. Each test stashes the latest callback on `__lastOnSelect` so
// it can dispatch a section key without rendering the real lens.
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

import { CourseTeachingTab } from "@/components/teaching-tab/CourseTeachingTab";

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

describe("CourseTeachingTab — P3b cross-tab Inspector hint", () => {
  it("renders <CrossTabHintCard> when a Preview click maps to a Journey-tab bucket", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseTeachingTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    // Fire the simulated bubble click for the "intake" section. Every
    // setting touching intake lives in `A_intake` (Journey tab).
    expect(__testHooks.lastOnSelect).not.toBeNull();
    act(() => __testHooks.lastOnSelect!("intake"));
    const card = screen.getByTestId("hf-cross-tab-hint-card");
    expect(card).toBeInTheDocument();
    // Jump button mentions the owning tab.
    expect(
      within(card).getByTestId("hf-cross-tab-hint-jump"),
    ).toHaveTextContent(/Open in Journey/);
    // Headline carries A_intake's educator label.
    expect(
      within(card).getByText(/Sign-up & pre-call profile/),
    ).toBeInTheDocument();
  });

  it("clicking the jump button fires onTabSwitch with the owning tab + bucket", () => {
    const onTabSwitch = vi.fn();
    render(
      <CourseTeachingTab
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

  it("in-tab Preview click (Teaching bucket) opens the Inspector directly — no hint card", () => {
    // J_feedback lives on the Teaching tab; the `priorCallFeedback`
    // section is exclusively touched by J_feedback settings (verified
    // 2026-06-17 via grep — 8 of 8 priorCallFeedback locators carry
    // `menuGroupKey: "J_feedback"`). Clicking it should select the
    // bucket, NOT show a cross-tab card.
    const onTabSwitch = vi.fn();
    render(
      <CourseTeachingTab
        courseId="c1"
        playbookConfig={{}}
        onTabSwitch={onTabSwitch}
      />,
    );
    act(() => __testHooks.lastOnSelect!("priorCallFeedback"));
    expect(screen.queryByTestId("hf-cross-tab-hint-card")).toBeNull();
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-J_feedback"),
    ).toBeInTheDocument();
    expect(onTabSwitch).not.toHaveBeenCalled();
  });
});
