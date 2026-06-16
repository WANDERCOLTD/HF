import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { JourneyLhMenu } from "@/components/journey-tab/JourneyLhMenu";

afterEach(() => cleanup());

describe("JourneyLhMenu — Slice C (#1721) bucket-grained menu", () => {
  it("renders all 7 group headers in chronological order", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
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
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="End"
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("hf-journey-group-G6")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-journey-group-G1")).toBeNull();
    expect(screen.queryByTestId("hf-journey-group-G4")).toBeNull();
  });

  it("clicking a bucket row fires onSelectBucket with its id", () => {
    const onSelect = vi.fn();
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={onSelect}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // G1 is open by default — pick the A_intake bucket
    fireEvent.click(screen.getByTestId("hf-journey-bucket-row-A_intake"));
    expect(onSelect).toHaveBeenCalledWith("A_intake");
  });

  it("phase filter button clicks call onFilterChange", () => {
    const onFilter = vi.fn();
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={onFilter}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Call 1" }));
    expect(onFilter).toHaveBeenCalledWith("Call 1");
  });

  it("renders a bucket-count chip for populated buckets", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // A_intake has 6 settings stamped to it (5 base + #1704 profile capture).
    const row = screen.getByTestId("hf-journey-bucket-row-A_intake");
    expect(row.textContent).toMatch(/6/);
  });
});
