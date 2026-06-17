import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { JourneyLhMenu } from "@/components/journey-tab/JourneyLhMenu";
import { BUCKETS_BY_TAB } from "@/lib/journey/buckets-by-tab";

afterEach(() => cleanup());

describe("JourneyLhMenu — Slice C (#1721) bucket-grained menu", () => {
  it("renders only the group headers that own a Journey-tab bucket (P4 #1850 prune)", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // The 7 Journey buckets distribute across G1, G2, G3, G5, G6 —
    // G4 and G7 collapse after the P4 prune because all their
    // buckets moved to Teaching / Scoring tabs.
    for (const g of ["G1", "G2", "G3", "G5", "G6"]) {
      expect(screen.getByTestId(`hf-journey-group-${g}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("hf-journey-group-G4")).toBeNull();
    expect(screen.queryByTestId("hf-journey-group-G7")).toBeNull();
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
    // A_intake has 8 settings (5 base + Lane 3 PR1 added 3 + #1704 profile
    // capture, minus the dead intakeConsentFlow contract removed in followup).
    const row = screen.getByTestId("hf-journey-bucket-row-A_intake");
    expect(row.textContent).toMatch(/8/);
  });
});

describe("JourneyLhMenu — P4 (#1850) LH pruning to Journey-owned buckets", () => {
  it("renders exactly the 7 Journey-owned buckets from BUCKETS_BY_TAB.journey", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // Open every collapsed group so all rows are in the DOM —
    // sessionStorage defaults to G1+G2 open only.
    for (const g of ["G3", "G5", "G6"]) {
      fireEvent.click(
        screen.getByTestId(`hf-journey-group-${g}`).querySelector("button")!,
      );
    }
    for (const id of BUCKETS_BY_TAB.journey) {
      expect(
        screen.getByTestId(`hf-journey-bucket-row-${id}`),
      ).toBeInTheDocument();
    }
    expect(BUCKETS_BY_TAB.journey).toHaveLength(7);
  });

  it("does NOT render Teaching-owned buckets (C/E/F/J)", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // Teaching tab owns C_teaching_style, E_learner_visual,
    // F_stall_recovery, J_feedback (parentGroup G4) — none should
    // render in Journey LH after the P4 prune.
    expect(
      screen.queryByTestId("hf-journey-bucket-row-C_teaching_style"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-journey-bucket-row-E_learner_visual"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-journey-bucket-row-F_stall_recovery"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-journey-bucket-row-J_feedback"),
    ).toBeNull();
  });

  it("does NOT render Scoring-owned buckets (I/K)", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // Scoring tab owns I_scoring (G7) + K_between_calls (G7).
    expect(
      screen.queryByTestId("hf-journey-bucket-row-I_scoring"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-journey-bucket-row-K_between_calls"),
    ).toBeNull();
  });

  it("does NOT render the Voice-owned bucket (N_voice)", () => {
    render(
      <JourneyLhMenu
        selectedBucketId={null}
        onSelectBucket={vi.fn()}
        filter="All"
        onFilterChange={vi.fn()}
      />,
    );
    // Voice tab owns N_voice (G4).
    expect(screen.queryByTestId("hf-journey-bucket-row-N_voice")).toBeNull();
  });
});
