import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { JourneyLhMenu } from "@/components/journey-tab/JourneyLhMenu";

afterEach(() => cleanup());

describe("JourneyLhMenu — Phase 4 (#1697)", () => {
  it("renders all 7 group headers in chronological order", () => {
    render(
      <JourneyLhMenu
        selectedSettingId={null}
        onSelectSetting={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    for (const g of ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]) {
      expect(screen.getByTestId(`hf-journey-group-${g}`)).toBeInTheDocument();
    }
  });

  it("phase filter chip narrows visible groups (e.g. 'End' shows only G6)", () => {
    render(
      <JourneyLhMenu
        selectedSettingId={null}
        onSelectSetting={vi.fn()}
        filter="End"
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("hf-journey-group-G6")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-journey-group-G1")).toBeNull();
    expect(screen.queryByTestId("hf-journey-group-G4")).toBeNull();
  });

  it("clicking a setting row fires onSelectSetting with its id", () => {
    const onSelect = vi.fn();
    render(
      <JourneyLhMenu
        selectedSettingId={null}
        onSelectSetting={onSelect}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // G1 is open by default — pick the first intake setting
    fireEvent.click(screen.getByTestId("hf-journey-setting-row-intakeKnowledgeCheck"));
    expect(onSelect).toHaveBeenCalledWith("intakeKnowledgeCheck");
  });

  it("phase filter button clicks call onFilterChange", () => {
    const onFilter = vi.fn();
    render(
      <JourneyLhMenu
        selectedSettingId={null}
        onSelectSetting={vi.fn()}
        filter="All"
        onFilterChange={onFilter}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Call 1" }));
    expect(onFilter).toHaveBeenCalledWith("Call 1");
  });
});
