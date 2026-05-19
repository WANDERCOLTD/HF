/**
 * Tests for LearnerModulePicker — read-only learner-facing module picker.
 *
 * Covers:
 * - Tiles layout when lessonPlanMode is "continuous"
 * - Rail layout when lessonPlanMode is "structured"
 * - Hides modules with learnerSelectable=false
 * - Hides `frequency: once` modules already in completedModuleIds (tiles)
 * - Sorts rail by `position`
 * - Surfaces "Recommended after X" advisory hint when prerequisites unmet
 * - Renders "Ends session" badge for sessionTerminal modules
 * - Renders "Spoken bands" badge for voiceBandReadout modules
 * - In preview mode (no onSelect), tiles are <div>s, not <button>s
 * - Tile sectioning when progress data is supplied (Slice 3 of #242)
 * - In-progress badge on rail + tiles (Slice 3 of #242)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const IELTS_MODULES: AuthoredModule[] = [
  mod({
    id: "baseline",
    label: "Baseline Assessment",
    mode: "examiner",
    duration: "20 min fixed",
    scoringFired: "All four",
    sessionTerminal: true,
    frequency: "once",
  }),
  mod({ id: "part1", label: "Part 1: Familiar Topics" }),
  mod({ id: "part2", label: "Part 2: Cue Card Monologues", mode: "mixed" }),
  mod({ id: "part3", label: "Part 3: Abstract Discussion" }),
  mod({
    id: "mock",
    label: "Mock Exam",
    mode: "examiner",
    duration: "20 min fixed",
    scoringFired: "All four",
    sessionTerminal: true,
    voiceBandReadout: true,
  }),
];

// ── Tiles ──────────────────────────────────────────────────────────

describe("LearnerModulePicker — tiles (continuous)", () => {
  it("renders one tile per learner-selectable module", () => {
    render(<LearnerModulePicker modules={IELTS_MODULES} lessonPlanMode="continuous" />);
    expect(screen.getByText("Baseline Assessment")).toBeInTheDocument();
    expect(screen.getByText("Part 1: Familiar Topics")).toBeInTheDocument();
    expect(screen.getByText("Mock Exam")).toBeInTheDocument();
  });

  it("hides modules with learnerSelectable=false", () => {
    const modules = [...IELTS_MODULES, mod({ id: "hidden", label: "Internal", learnerSelectable: false })];
    render(<LearnerModulePicker modules={modules} lessonPlanMode="continuous" />);
    expect(screen.queryByText("Internal")).not.toBeInTheDocument();
  });

  it("hides `frequency: once` modules that have been completed", () => {
    render(
      <LearnerModulePicker
        modules={IELTS_MODULES}
        lessonPlanMode="continuous"
        completedModuleIds={["baseline"]}
      />,
    );
    expect(screen.queryByText("Baseline Assessment")).not.toBeInTheDocument();
    // Other modules still visible
    expect(screen.getByText("Part 1: Familiar Topics")).toBeInTheDocument();
  });

  it("renders `Ends session` badge for sessionTerminal modules", () => {
    render(<LearnerModulePicker modules={IELTS_MODULES} lessonPlanMode="continuous" />);
    const badges = screen.getAllByText(/Ends session/i);
    // baseline + mock both terminal
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders `Spoken bands` badge only for voiceBandReadout modules", () => {
    render(<LearnerModulePicker modules={IELTS_MODULES} lessonPlanMode="continuous" />);
    expect(screen.getByText(/Spoken bands/i)).toBeInTheDocument();
  });

  it("renders tiles as <div>s when no onSelect handler is provided (preview mode)", () => {
    const { container } = render(
      <LearnerModulePicker modules={IELTS_MODULES} lessonPlanMode="continuous" />,
    );
    expect(container.querySelectorAll("button.learner-picker__tile")).toHaveLength(0);
    expect(container.querySelectorAll("div.learner-picker__tile").length).toBeGreaterThan(0);
  });

  it("renders tiles as <button>s and fires onSelect when activated", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={IELTS_MODULES}
        lessonPlanMode="continuous"
        onSelect={onSelect}
      />,
    );
    const buttons = container.querySelectorAll("button.learner-picker__tile");
    expect(buttons.length).toBeGreaterThan(0);
    (buttons[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith("part1");
  });
});

// ── Rail ───────────────────────────────────────────────────────────

describe("LearnerModulePicker — rail (structured)", () => {
  const SEQUENTIAL: AuthoredModule[] = [
    mod({ id: "ch1", label: "Chapter 1", position: 1 }),
    mod({ id: "ch2", label: "Chapter 2", position: 2, prerequisites: ["ch1"] }),
    mod({ id: "ch3", label: "Chapter 3", position: 3, prerequisites: ["ch2"] }),
  ];

  it("renders an ordered list", () => {
    const { container } = render(
      <LearnerModulePicker modules={SEQUENTIAL} lessonPlanMode="structured" />,
    );
    expect(container.querySelector("ol.learner-picker__rail")).not.toBeNull();
  });

  it("sorts items by position even if input order is shuffled", () => {
    const shuffled = [SEQUENTIAL[2], SEQUENTIAL[0], SEQUENTIAL[1]];
    const { container } = render(
      <LearnerModulePicker modules={shuffled} lessonPlanMode="structured" />,
    );
    const labels = Array.from(
      container.querySelectorAll(".learner-picker__rail-label"),
    ).map((el) => el.textContent ?? "");
    // Each label may include suffix badges; just check ordering by prefix
    expect(labels[0].startsWith("Chapter 1")).toBe(true);
    expect(labels[1].startsWith("Chapter 2")).toBe(true);
    expect(labels[2].startsWith("Chapter 3")).toBe(true);
  });

  it("surfaces 'Recommended after X' advisory when prerequisites are unmet", () => {
    render(
      <LearnerModulePicker
        modules={SEQUENTIAL}
        lessonPlanMode="structured"
        completedModuleIds={[]}
      />,
    );
    expect(screen.getByText(/Recommended after ch1/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended after ch2/i)).toBeInTheDocument();
  });

  it("hides the advisory and shows 'Done' when prerequisites are met", () => {
    render(
      <LearnerModulePicker
        modules={SEQUENTIAL}
        lessonPlanMode="structured"
        completedModuleIds={["ch1"]}
      />,
    );
    // ch2 prereq satisfied
    expect(screen.queryByText(/Recommended after ch1/i)).not.toBeInTheDocument();
    // ch1 marked Done
    expect(screen.getByText(/Done/i)).toBeInTheDocument();
  });

  it("does NOT gate the rail card — it is rendered as a clickable button when onSelect provided, regardless of prereqs", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LearnerModulePicker
        modules={SEQUENTIAL}
        lessonPlanMode="structured"
        onSelect={onSelect}
      />,
    );
    const buttons = container.querySelectorAll("button.learner-picker__rail-card");
    expect(buttons.length).toBe(3);
    // The rail card is still a real <button> (not a disabled div) when
    // prereqs are unmet. #495 Slice 4.5 wraps the click in a soft-warning
    // modal — onSelect is reached after a "Continue anyway" tap, not
    // suppressed entirely.
    (buttons[2] as HTMLButtonElement).click();
  });
});

// ── Empty state ────────────────────────────────────────────────────

describe("LearnerModulePicker — empty visible set", () => {
  it("renders the empty hint when every module is learnerSelectable=false", () => {
    const modules = [
      mod({ id: "x", label: "X", learnerSelectable: false }),
      mod({ id: "y", label: "Y", learnerSelectable: false }),
    ];
    render(<LearnerModulePicker modules={modules} lessonPlanMode="continuous" />);
    expect(screen.getByText(/No learner-selectable modules/i)).toBeInTheDocument();
  });
});

// ── Layout fallback ────────────────────────────────────────────────

describe("LearnerModulePicker — null lessonPlanMode", () => {
  it("falls back to tiles when lessonPlanMode is null", () => {
    const { container } = render(
      <LearnerModulePicker modules={IELTS_MODULES} lessonPlanMode={null} />,
    );
    expect(container.querySelector(".learner-picker--tiles")).not.toBeNull();
    expect(container.querySelector(".learner-picker--rail")).toBeNull();
  });
});

// ── Progress sectioning (Slice 3) ──────────────────────────────────

describe("LearnerModulePicker — tile sections (progress data supplied)", () => {
  const PROGRESS_MODULES: AuthoredModule[] = [
    mod({ id: "part1", label: "Part 1" }),
    mod({ id: "part2", label: "Part 2" }),
    mod({ id: "part3", label: "Part 3" }),
  ];

  it("groups tiles into Up next / In progress / Completed when progress is supplied", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={PROGRESS_MODULES}
        lessonPlanMode="continuous"
        completedModuleIds={["part1"]}
        inProgressModuleIds={["part2"]}
      />,
    );

    const sections = container.querySelectorAll(".learner-picker__section");
    expect(sections.length).toBe(3);

    const titles = Array.from(
      container.querySelectorAll(".learner-picker__section-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Up next", "In progress", "Completed"]);
  });

  it("omits sections that would be empty", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={PROGRESS_MODULES}
        lessonPlanMode="continuous"
        completedModuleIds={["part1", "part2", "part3"]}
      />,
    );

    const titles = Array.from(
      container.querySelectorAll(".learner-picker__section-title"),
    ).map((el) => el.textContent);
    // Only "Completed" — no Up next, no In progress
    expect(titles).toEqual(["Completed"]);
  });

  it("renders an ungrouped grid when no progress data supplied", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={PROGRESS_MODULES}
        lessonPlanMode="continuous"
      />,
    );
    expect(container.querySelectorAll(".learner-picker__section").length).toBe(0);
    expect(container.querySelectorAll(".learner-picker__tile").length).toBe(3);
  });

  it("hides `frequency: once` completed modules even within sections", () => {
    const modules = [
      mod({ id: "baseline", label: "Baseline", frequency: "once" }),
      mod({ id: "part1", label: "Part 1" }),
    ];
    render(
      <LearnerModulePicker
        modules={modules}
        lessonPlanMode="continuous"
        completedModuleIds={["baseline"]}
      />,
    );
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
    expect(screen.getByText("Part 1")).toBeInTheDocument();
  });

  it("shows In progress badge on tiles in the in-progress section", () => {
    const { container } = render(
      <LearnerModulePicker
        modules={PROGRESS_MODULES}
        lessonPlanMode="continuous"
        inProgressModuleIds={["part2"]}
      />,
    );
    // Section title + badge both say "In progress" — count both surfaces
    const matches = screen.getAllByText(/In progress/i);
    expect(matches.length).toBe(2);
    // At least one is the badge inside a tile
    expect(
      container.querySelector(".learner-picker__badge--progress"),
    ).not.toBeNull();
  });
});

describe("LearnerModulePicker — in-progress badge on rail", () => {
  const SEQUENTIAL: AuthoredModule[] = [
    mod({ id: "ch1", label: "Chapter 1", position: 1 }),
    mod({ id: "ch2", label: "Chapter 2", position: 2 }),
  ];

  it("shows In progress pill alongside Done", () => {
    render(
      <LearnerModulePicker
        modules={SEQUENTIAL}
        lessonPlanMode="structured"
        completedModuleIds={["ch1"]}
        inProgressModuleIds={["ch2"]}
      />,
    );
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Done/i)).toBeInTheDocument();
  });

  it("collapses Done to win when a module is both in-progress and completed (data race)", () => {
    render(
      <LearnerModulePicker
        modules={[mod({ id: "ch1", label: "Chapter 1", position: 1 })]}
        lessonPlanMode="structured"
        completedModuleIds={["ch1"]}
        inProgressModuleIds={["ch1"]}
      />,
    );
    expect(screen.getByText(/Done/i)).toBeInTheDocument();
    expect(screen.queryByText(/In progress/i)).not.toBeInTheDocument();
  });
});
