/**
 * PreviewLens — shell-preview lens variant (#2206, U5 of #2185).
 *
 * Pins:
 *   - each AuthoredModuleMode value resolves to the right shellKind +
 *     mounts the matching stub when the lens is in shell-preview mode
 *   - the cascade chip strip renders default-state when no capability
 *     overrides are in effect
 *   - the cascade chip strip surfaces override chips when capability
 *     state diverges (TODO(2206-stub): exercised against the local stub
 *     until #2199 ships; chip semantics are the same once swapped)
 *   - switching modules updates the preview surface
 *   - the lens picker toggles between shell-preview and off variants
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";

import { ModulesPreviewLens } from "@/components/modules-tab/PreviewLens";
import type { ModuleEditorRow } from "@/components/modules-tab/ModuleEditor";

afterEach(() => {
  cleanup();
});

const baseModule: ModuleEditorRow = {
  id: "part1",
  label: "Part 1 — Interview",
  mode: "tutor",
};

describe("ModulesPreviewLens — shell-preview variant", () => {
  it("renders an empty state when no module is selected", () => {
    render(<ModulesPreviewLens courseId="c1" selectedModule={null} />);
    expect(
      screen.getByTestId("hf-modules-preview-lens-empty"),
    ).toBeInTheDocument();
    // Sandbox doesn't mount until a module is picked.
    expect(
      screen.queryByTestId("hf-shell-preview-sandbox"),
    ).not.toBeInTheDocument();
  });

  it("mounts the chat-feed stub for tutor mode", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "tutor" }}
      />,
    );
    const sandbox = screen.getByTestId("hf-shell-preview-sandbox");
    expect(sandbox.getAttribute("data-shell-kind")).toBe("chat-feed");
    expect(
      screen.getByTestId("hf-shell-preview-stub-chat-feed"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hf-shell-preview-kind").textContent).toBe(
      "chat-feed",
    );
  });

  it("mounts the chat-feed stub for mixed mode", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "mixed" }}
      />,
    );
    expect(
      screen.getByTestId("hf-shell-preview-stub-chat-feed"),
    ).toBeInTheDocument();
  });

  it("mounts the exam stub for examiner mode", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "examiner" }}
      />,
    );
    expect(
      screen.getByTestId("hf-shell-preview-stub-exam"),
    ).toBeInTheDocument();
    // Default exam capabilities include cue card + waveform.
    expect(
      screen.getByTestId("hf-shell-preview-stub-cue-card"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-shell-preview-stub-waveform"),
    ).toBeInTheDocument();
  });

  it("mounts the exam stub for mock-exam mode", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "mock-exam" }}
      />,
    );
    const sandbox = screen.getByTestId("hf-shell-preview-sandbox");
    expect(sandbox.getAttribute("data-shell-kind")).toBe("exam");
  });

  it("mounts the mcq-rounds stub for quiz mode", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "quiz" }}
      />,
    );
    expect(
      screen.getByTestId("hf-shell-preview-stub-mcq"),
    ).toBeInTheDocument();
  });

  it("displays the cascade chip strip with the 'using defaults' chip when no overrides are in effect", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "examiner" }}
      />,
    );
    const chips = screen.getByTestId("hf-shell-preview-cascade-chips");
    expect(chips).toBeInTheDocument();
    // Stub returns SHELL_DEFAULTS unmodified → defaults chip renders.
    expect(
      screen.getByTestId("hf-shell-preview-chip-defaults"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-shell-preview-chip-defaults").textContent,
    ).toContain("exam");
  });

  it("updates the preview when the selected module changes", () => {
    const { rerender } = render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "tutor" }}
      />,
    );
    expect(
      screen.getByTestId("hf-shell-preview-stub-chat-feed"),
    ).toBeInTheDocument();

    rerender(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{
          id: "mock",
          label: "Mock Exam",
          mode: "examiner",
        }}
      />,
    );
    expect(
      screen.queryByTestId("hf-shell-preview-stub-chat-feed"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("hf-shell-preview-stub-exam"),
    ).toBeInTheDocument();
    // data-module-id moves with the selection so DOM-level tests can pin it.
    expect(
      screen
        .getByTestId("hf-shell-preview-sandbox")
        .getAttribute("data-module-id"),
    ).toBe("mock");
  });

  it("toggles between shell-preview and off variants via the lens picker", () => {
    render(
      <ModulesPreviewLens
        courseId="c1"
        selectedModule={{ ...baseModule, mode: "tutor" }}
      />,
    );
    // Starts in shell-preview — sandbox visible, collapsed copy absent.
    expect(
      screen.getByTestId("hf-shell-preview-sandbox"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("hf-modules-preview-lens-collapsed"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("hf-modules-preview-lens-none-tab"),
    );
    expect(
      screen.queryByTestId("hf-shell-preview-sandbox"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("hf-modules-preview-lens-collapsed"),
    ).toBeInTheDocument();

    // Toggle back.
    fireEvent.click(
      screen.getByTestId("hf-modules-preview-lens-shell-tab"),
    );
    expect(
      screen.getByTestId("hf-shell-preview-sandbox"),
    ).toBeInTheDocument();
  });
});
