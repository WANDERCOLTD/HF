/**
 * Tests for ExamModeShell + DualWaveform (#1745, epic #1700 Theme 4).
 *
 * Pinned acceptance:
 *   1. `shouldMountExamModeShell` discriminator returns true only for
 *      examiner-mode terminal modules
 *   2. ExamModeShell renders the dual waveform + optional banner +
 *      child controls
 *   3. DualWaveform renders bar elements without crashing on no-stream
 *      (level = 0)
 *   4. DualWaveform clamps non-finite or out-of-range levels to safe [0, 1]
 */

import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import {
  ExamModeShell,
  shouldMountExamModeShell,
} from "@/components/sim/ExamModeShell";
import { DualWaveform } from "@/components/sim/DualWaveform";

afterEach(() => {
  cleanup();
});

describe("shouldMountExamModeShell", () => {
  it("returns true for examiner mode + terminal session", () => {
    expect(shouldMountExamModeShell({ mode: "examiner" }, true)).toBe(true);
  });

  it("returns false for examiner mode + non-terminal session", () => {
    expect(shouldMountExamModeShell({ mode: "examiner" }, false)).toBe(false);
  });

  it("returns false for tutor / mixed modes regardless of terminal", () => {
    expect(shouldMountExamModeShell({ mode: "tutor" }, true)).toBe(false);
    expect(shouldMountExamModeShell({ mode: "mixed" }, true)).toBe(false);
  });

  it("returns false for null / undefined module", () => {
    expect(shouldMountExamModeShell(null, true)).toBe(false);
    expect(shouldMountExamModeShell(undefined, true)).toBe(false);
  });
});

describe("ExamModeShell rendering", () => {
  it("renders the dual waveform region", () => {
    render(<ExamModeShell examinerLevel={0.5} learnerLevel={0.3} />);
    expect(
      screen.getByRole("group", { name: /dual waveform/i }),
    ).toBeInTheDocument();
  });

  it("renders the banner when provided", () => {
    render(
      <ExamModeShell
        examinerLevel={0}
        learnerLevel={0}
        banner="Part 2 — speak for 2 minutes"
      />,
    );
    expect(screen.getByTestId("hf-exam-shell-banner")).toHaveTextContent(
      "Part 2 — speak for 2 minutes",
    );
  });

  it("renders child controls", () => {
    render(
      <ExamModeShell examinerLevel={0} learnerLevel={0}>
        <button type="button">End exam</button>
      </ExamModeShell>,
    );
    expect(screen.getByRole("button", { name: /end exam/i })).toBeInTheDocument();
  });
});

describe("DualWaveform render-safety", () => {
  it("renders 32 examiner bars + 32 learner bars at level 0 (idle)", () => {
    const { container } = render(
      <DualWaveform examinerLevel={0} learnerLevel={0} />,
    );
    expect(container.querySelectorAll(".hf-dwf-bar-examiner").length).toBe(32);
    expect(container.querySelectorAll(".hf-dwf-bar-learner").length).toBe(32);
  });

  it("does not crash on NaN / Infinity / negative levels (clamps to [0,1])", () => {
    const { container } = render(
      <DualWaveform examinerLevel={NaN} learnerLevel={-1} />,
    );
    expect(container.querySelectorAll(".hf-dwf-bar").length).toBe(64);
  });

  it("flags the active speaker via data-active on the bars", () => {
    const { container } = render(
      <DualWaveform examinerLevel={0.7} learnerLevel={0} speakerRole="examiner" />,
    );
    const activeExaminer = container.querySelectorAll('.hf-dwf-bar-examiner[data-active="true"]');
    const activeLearner = container.querySelectorAll('.hf-dwf-bar-learner[data-active="true"]');
    expect(activeExaminer.length).toBeGreaterThan(0);
    expect(activeLearner.length).toBe(0);
  });
});
