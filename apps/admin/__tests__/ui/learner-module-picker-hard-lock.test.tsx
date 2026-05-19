/**
 * Tests for the #495 Slice 4.6 hard-lock modal + locked-tile state in
 * LearnerModulePicker.
 *
 * When `strictPrerequisites === true` AND a learner clicks a module
 * whose prereqs aren't all MASTERED, the picker intercepts the click
 * and shows a dismiss-only modal. There is NO "Continue anyway"
 * affordance in strict mode — the only escape is to dismiss and pick
 * a prereq instead.
 *
 * Visual cues on each locked tile:
 *   - `learner-picker-page__tile--locked` (or rail-card equivalent)
 *   - a small grey Lock icon in the top-LEFT corner
 *   - the recommended-next badge is SUPPRESSED on locked tiles
 *
 * Soft-warning path (`strictPrerequisites === false`) is covered in
 * `learner-module-picker-soft-warning.test.tsx` and is unchanged by
 * this slice — we don't re-test it here.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearnerModulePicker } from "@/app/x/courses/[courseId]/_components/LearnerModulePicker";
import type { AuthoredModule } from "@/lib/types/json-fields";

function mod(over: Partial<AuthoredModule>): AuthoredModule {
  return {
    id: "m",
    label: "Module",
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "LR + GRA",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    ...over,
  };
}

const FIXTURE: AuthoredModule[] = [
  mod({
    id: "m1",
    label: "Module One",
    progress: { status: "MASTERED", callCount: 4 },
  }),
  mod({
    id: "m2",
    label: "Module Two",
    prerequisites: ["m1"],
    progress: { status: "NOT_STARTED", callCount: 0 },
  }),
  mod({
    id: "m3",
    label: "Module Three",
    prerequisites: ["m2"],
    progress: { status: "NOT_STARTED", callCount: 0 },
  }),
];

function getTile(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(
    container.querySelectorAll("button.learner-picker__tile"),
  ).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  expect(btn, `tile for ${label}`).toBeTruthy();
  return btn;
}

describe("LearnerModulePicker — hard-lock modal (#495 Slice 4.6)", () => {
  it("opens the hard-lock modal when prereqs are NOT mastered and strictPrerequisites=true", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Complete these first/i)).toBeInTheDocument();
    // Unmet prereq title appears in the bulleted list (scoped to dialog
    // so it doesn't collide with the tile label outside).
    const listItems = dialog.querySelectorAll(
      ".learner-picker-page__hardlock-modal-list li",
    );
    const itemTexts = Array.from(listItems).map((li) => li.textContent);
    expect(itemTexts).toContain("Module Two");
    // Original handler must NOT have fired
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hard-lock modal exposes NO 'Continue anyway' affordance — only OK", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // No "Continue anyway" button in strict mode
    expect(
      screen.queryByRole("button", { name: /continue/i }),
    ).not.toBeInTheDocument();
    // Single OK affordance is present
    expect(
      screen.getByRole("button", { name: /OK, take me back/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'OK, take me back' closes the modal WITHOUT calling onSelect", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /OK, take me back/i }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape dismisses the hard-lock modal", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("backdrop click dismisses the hard-lock modal", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));
    const backdrop = container.querySelector(
      ".learner-picker-page__hardlock-modal-backdrop",
    ) as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards to onSelect immediately when prereqs ARE mastered (even with strictPrerequisites=true)", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    // m2's only prereq is m1, which is MASTERED → click should pass through.
    fireEvent.click(getTile(container, "Module Two"));

    expect(onSelect).toHaveBeenCalledWith("m2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("locked tile carries the --locked class + a visible Lock icon", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={vi.fn()}
        strictPrerequisites={true}
      />,
    );

    const m3 = getTile(container, "Module Three");
    expect(m3.classList.contains("learner-picker-page__tile--locked")).toBe(
      true,
    );
    expect(m3.getAttribute("data-locked")).toBe("true");
    // The lock badge sits inside the tile
    const lockBadge = m3.querySelector(".learner-picker-page__lock-badge");
    expect(lockBadge).toBeTruthy();
    // Tooltip is present
    expect(m3.getAttribute("title")).toBe("Complete the prereqs first");
  });

  it("recommended-next badge is suppressed on a locked tile", () => {
    // Force the upstream to pick a locked module — defence-in-depth: the
    // recommender shouldn't do this, but the picker must defend itself.
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={vi.fn()}
        strictPrerequisites={true}
        recommendedModuleId="m3"
        recommendedReason="next-in-sequence"
      />,
    );

    const m3 = getTile(container, "Module Three");
    expect(m3.querySelector(".learner-picker-page__lock-badge")).toBeTruthy();
    expect(
      m3.querySelector(".learner-picker-page__recommended-badge"),
    ).toBeNull();
    expect(m3.getAttribute("data-recommended")).toBeNull();
  });

  it("does NOT add the --locked class when strictPrerequisites=false", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={vi.fn()}
        strictPrerequisites={false}
      />,
    );

    const m3 = getTile(container, "Module Three");
    expect(m3.classList.contains("learner-picker-page__tile--locked")).toBe(
      false,
    );
    expect(m3.querySelector(".learner-picker-page__lock-badge")).toBeNull();
  });

  it("hard-lock modal has correct ARIA attributes", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={vi.fn()}
        strictPrerequisites={true}
      />,
    );

    fireEvent.click(getTile(container, "Module Three"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "picker-prereq-hard-lock-title",
    );
    const title = container.querySelector("#picker-prereq-hard-lock-title");
    expect(title).toBeTruthy();
  });

  it("works on the rail layout (structured mode) — locked rail card gets the locked class + Lock icon", () => {
    const ordered = FIXTURE.map((m, i) => ({ ...m, position: i + 1 }));
    const { container } = render(
      <LearnerModulePicker
        modules={ordered}
        lessonPlanMode="structured"
        onSelect={vi.fn()}
        strictPrerequisites={true}
      />,
    );

    const railCards = Array.from(
      container.querySelectorAll("button.learner-picker__rail-card"),
    );
    const m3Card = railCards.find((c) =>
      c.textContent?.includes("Module Three"),
    ) as HTMLButtonElement;
    expect(m3Card).toBeTruthy();
    expect(
      m3Card.classList.contains("learner-picker-page__rail-card--locked"),
    ).toBe(true);
    expect(
      m3Card.querySelector(".learner-picker-page__lock-badge"),
    ).toBeTruthy();
  });
});
