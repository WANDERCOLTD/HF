/**
 * LearnerModulePicker — per-module `prerequisiteStrict` override.
 *
 * Story: #2104 (S2 of epic #2102). Pins the resolution rule
 *   `mod.prerequisiteStrict ?? strictPrerequisites ?? false`
 * across the picker's two consumers:
 *   - `lockedModuleIds` useMemo (drives the lock badge + desaturate)
 *   - `handlePick` (drives hard-lock vs soft-warn modal selection)
 *
 * AC coverage:
 *   1. `prerequisiteStrict: true` hard-locks regardless of course flag
 *   2. `prerequisiteStrict: false` forces soft-warn even when course flag is true
 *   3. `prerequisiteStrict` absent → falls back to course-level flag
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearnerModulePicker } from "@/app/x/courses/[courseId]/_components/LearnerModulePicker";
import type { AuthoredModule } from "@/lib/types/json-fields";

function baseMod(overrides: Partial<AuthoredModule> = {}): AuthoredModule {
  return {
    id: "part1",
    label: "Part 1",
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "LR + GRA only",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: ["OUT-01"],
    prerequisites: [],
    ...overrides,
  };
}

describe("LearnerModulePicker — per-module prerequisiteStrict override (#2104)", () => {
  it("AC1: prerequisiteStrict=true hard-locks the module even when course-level strictPrerequisites=false", () => {
    // Setup: Part 1 not mastered; Mock Exam declares prerequisiteStrict=true with Part 1 as prereq.
    // Course-level flag is false (soft-warn default).
    const part1 = baseMod({
      id: "part1",
      label: "Part 1",
      progress: { status: "NOT_STARTED", callCount: 0 },
    });
    const mock = baseMod({
      id: "mock",
      label: "Mock Exam",
      prerequisites: ["part1"],
      prerequisiteStrict: true,
    });

    const onSelect = vi.fn();
    render(
      <LearnerModulePicker
        modules={[part1, mock]}
        lessonPlanMode="continuous"
        strictPrerequisites={false}
        onSelect={onSelect}
      />,
    );

    // Lock badge present on the Mock Exam tile (lockedModuleIds includes "mock").
    const lockBadges = screen.getAllByLabelText(
      "Locked — complete the prereqs first",
    );
    expect(lockBadges.length).toBe(1);

    // Clicking the Mock Exam tile opens the HARD-LOCK modal, not the soft-warn.
    const mockTile = screen.getByRole("button", { name: /Mock Exam/i });
    fireEvent.click(mockTile);

    expect(screen.getByText("Complete these first")).toBeTruthy();
    expect(screen.queryByText(/Heads up/i)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("AC2: prerequisiteStrict=false forces soft-warn even when course-level strictPrerequisites=true", () => {
    // Setup: Part 1 not mastered; Part 2 declares prerequisiteStrict=false override
    // against the otherwise-strict course flag.
    const part1 = baseMod({
      id: "part1",
      label: "Part 1",
      progress: { status: "NOT_STARTED", callCount: 0 },
    });
    const part2 = baseMod({
      id: "part2",
      label: "Part 2",
      prerequisites: ["part1"],
      prerequisiteStrict: false,
    });

    const onSelect = vi.fn();
    render(
      <LearnerModulePicker
        modules={[part1, part2]}
        lessonPlanMode="continuous"
        strictPrerequisites={true}
        onSelect={onSelect}
      />,
    );

    // No lock badge on Part 2 — per-module override won, lockedModuleIds is empty.
    expect(
      screen.queryByLabelText("Locked — complete the prereqs first"),
    ).toBeNull();

    // Clicking Part 2 opens the SOFT-WARN modal, not the hard-lock.
    const part2Tile = screen.getByRole("button", { name: /Part 2/i });
    fireEvent.click(part2Tile);

    expect(screen.getByText(/Heads up/i)).toBeTruthy();
    expect(screen.queryByText("Complete these first")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("AC3: prerequisiteStrict absent → falls back to course-level strictPrerequisites flag", () => {
    // Setup: Part 1 not mastered; Part 2 does NOT declare prerequisiteStrict.
    // Course-level flag is true → should hard-lock (course flag wins via fallback).
    const part1 = baseMod({
      id: "part1",
      label: "Part 1",
      progress: { status: "NOT_STARTED", callCount: 0 },
    });
    const part2 = baseMod({
      id: "part2",
      label: "Part 2",
      prerequisites: ["part1"],
      // prerequisiteStrict: undefined (omitted)
    });

    const onSelect = vi.fn();
    render(
      <LearnerModulePicker
        modules={[part1, part2]}
        lessonPlanMode="continuous"
        strictPrerequisites={true}
        onSelect={onSelect}
      />,
    );

    // Lock badge IS present on Part 2 — fallback to course-level true.
    const lockBadges = screen.getAllByLabelText(
      "Locked — complete the prereqs first",
    );
    expect(lockBadges.length).toBe(1);

    // Clicking Part 2 opens the HARD-LOCK modal (course-level flag drives via fallback).
    const part2Tile = screen.getByRole("button", { name: /Part 2/i });
    fireEvent.click(part2Tile);

    expect(screen.getByText("Complete these first")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
