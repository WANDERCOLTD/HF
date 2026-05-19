/**
 * Tests for the #495 Slice 4.5 soft-warning modal in LearnerModulePicker.
 *
 * When `strictPrerequisites === false` (default) and a learner clicks a
 * module whose prereqs aren't all MASTERED, the picker intercepts the
 * click and shows a modal. The modal offers:
 *   - "Cancel" (primary) — dismiss, picker stays put, onSelect NOT called
 *   - "Continue anyway" (secondary) — forwards to onSelect with the
 *     original moduleId
 *   - Escape key + backdrop click also dismiss
 *
 * Mastery is the gate (`progress.status === "MASTERED"`) — not mere
 * completion — so the test fixtures wire the per-module `progress`
 * field rather than the legacy `completedModuleIds` set.
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

describe("LearnerModulePicker — soft-warning modal (#495 Slice 4.5)", () => {
  it("does NOT show the modal when prereqs are all mastered — onSelect fires immediately", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    // m2's only prereq is m1, which is MASTERED → click should pass through.
    const m2Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Two")) as HTMLButtonElement;
    expect(m2Button).toBeTruthy();
    fireEvent.click(m2Button);

    expect(onSelect).toHaveBeenCalledWith("m2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the modal when prereqs are NOT mastered and strictPrerequisites=false", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    // m3's prereq is m2 (NOT_STARTED) → click should open the modal.
    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    expect(m3Button).toBeTruthy();
    fireEvent.click(m3Button);

    // Modal is rendered with the prereq title in its body
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText(/Heads up — you haven't completed the prereqs/i),
    ).toBeInTheDocument();
    // Bulleted list inside the modal contains the unmet prereq's TITLE
    // (not slug). Scope the lookup to the dialog so it doesn't collide
    // with the m2 tile label outside.
    const listItems = dialog.querySelectorAll(
      ".learner-picker-page__prereq-modal-list li",
    );
    const itemTexts = Array.from(listItems).map((li) => li.textContent);
    expect(itemTexts).toContain("Module Two");
    // onSelect must NOT have fired yet
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking 'Continue anyway' forwards to onSelect and closes the modal", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start Module Three anyway/i }));
    expect(onSelect).toHaveBeenCalledWith("m3");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking 'Cancel' closes the modal WITHOUT calling onSelect", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Cancel — go back to the picker/i }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape key dismisses the modal", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("backdrop click dismisses the modal", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);
    const backdrop = container.querySelector(
      ".learner-picker-page__prereq-modal-backdrop",
    ) as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("modal has correct ARIA attributes for accessibility", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={false}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "picker-prereq-soft-warning-title",
    );
    const title = container.querySelector("#picker-prereq-soft-warning-title");
    expect(title).toBeTruthy();
  });

  it("falls through to the soft-warning modal when strictPrerequisites=true (slice 4.6 placeholder)", () => {
    // Until slice 4.6 lands, strict-mode unmet prereqs use the same soft-
    // warning UX so the learner is never silently blocked. This test
    // pins that contract.
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={FIXTURE}
        lessonPlanMode="continuous"
        onSelect={onSelect}
        strictPrerequisites={true}
      />,
    );

    const m3Button = Array.from(
      container.querySelectorAll("button.learner-picker__tile"),
    ).find((b) => b.textContent?.includes("Module Three")) as HTMLButtonElement;
    fireEvent.click(m3Button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
