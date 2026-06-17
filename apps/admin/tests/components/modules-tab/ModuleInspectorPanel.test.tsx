import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { ModuleInspectorPanel } from "@/components/modules-tab/ModuleInspectorPanel";

afterEach(() => {
  cleanup();
});

describe("ModuleInspectorPanel — P3 (#1850)", () => {
  it("renders the empty-state when selectedModuleId is null", () => {
    render(
      <ModuleInspectorPanel
        selectedModuleId={null}
        selectedModuleLabel={null}
        settings={null}
        onSaveAttempt={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("hf-module-inspector-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Select a module from the left/i),
    ).toBeInTheDocument();
  });

  it("renders G8 rows when a module is selected", () => {
    render(
      <ModuleInspectorPanel
        selectedModuleId="part1"
        selectedModuleLabel="Part 1 — Interview"
        settings={{ questionTarget: { min: 10, target: 13 } }}
        onSaveAttempt={vi.fn()}
      />,
    );
    // Container keyed on the selected module id.
    expect(
      screen.getByTestId("hf-module-inspector-part1"),
    ).toBeInTheDocument();
    // Module label surfaces as the header.
    expect(
      screen.getByText("Part 1 — Interview"),
    ).toBeInTheDocument();
    // At least one G8 field renders (moduleQuestionTarget is the first
    // G8 entry; assert it by testid so we don't depend on the field's
    // visual label string).
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
  });

  it("renders the deferred-writer banner so saves do not look silent", () => {
    render(
      <ModuleInspectorPanel
        selectedModuleId="part1"
        selectedModuleLabel="Part 1"
        settings={null}
        onSaveAttempt={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Read-only preview/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/module-scope writer ships in a follow-on/i),
    ).toBeInTheDocument();
  });
});
