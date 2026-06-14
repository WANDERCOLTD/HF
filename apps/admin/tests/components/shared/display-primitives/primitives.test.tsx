/**
 * Smoke + edge-data tests for the display-primitives package.
 *
 * Coverage gate for PR 1a: every primitive must render without throwing for
 * (a) realistic data, (b) empty input, (c) null / undefined / NaN inputs.
 * No primitive may render `NaN%` or `0.NaN` strings.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// #1664 — PersonalityRadar now calls useSession to gate interpretation
// tooltips. Default to STUDENT (no interpretation text) so these smoke
// tests don't depend on operator UI surface.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "STUDENT" } } }),
}));

import {
  CardGrid,
  StatTile,
  DeltaPill,
  Donut,
  SliceDonut,
  HeatmapStrip,
  CalendarStrip,
  SparklineCard,
  Radar,
  EQMixer,
  TopicCloud,
  TimelineRibbon,
} from "@/components/shared/display-primitives";

function expectNoNaNText(container: HTMLElement): void {
  expect(container.textContent ?? "").not.toMatch(/NaN/);
}

describe("CardGrid", () => {
  it("renders children inside a grid host", () => {
    const { container } = render(
      <CardGrid>
        <div>one</div>
        <div>two</div>
      </CardGrid>,
    );
    expect(container.querySelector(".hf-card-grid")).not.toBeNull();
  });
});

describe("StatTile", () => {
  it("renders headline value and label", () => {
    const { getByText } = render(<StatTile value="12" label="Calls" />);
    expect(getByText("12")).toBeTruthy();
    expect(getByText("Calls")).toBeTruthy();
  });

  it("renders em-dash for null value", () => {
    const { container } = render(<StatTile value={null} label="Calls" />);
    expect(container.textContent).toContain("—");
    expectNoNaNText(container);
  });
});

describe("DeltaPill", () => {
  it("renders signed value with pp", () => {
    const { container } = render(<DeltaPill value={0.12} kind="pp" />);
    expect(container.textContent).toContain("+12pp");
  });

  it("renders em-dash for null", () => {
    const { container } = render(<DeltaPill value={null} kind="abs" />);
    expect(container.textContent).toContain("—");
    expectNoNaNText(container);
  });

  it("classifies negative as down", () => {
    const { container } = render(<DeltaPill value={-0.5} />);
    expect(container.querySelector(".hf-direction-down")).not.toBeNull();
  });

  it("classifies zero as neutral", () => {
    const { container } = render(<DeltaPill value={0} />);
    expect(container.querySelector(".hf-direction-neutral")).not.toBeNull();
  });
});

describe("Donut", () => {
  it("renders progress arc for valid value", () => {
    const { container } = render(<Donut value={0.5} />);
    expect(container.querySelector(".hf-donut-progress")).not.toBeNull();
  });

  it("renders empty state for null", () => {
    const { container } = render(<Donut value={null} />);
    expect(container.querySelector(".hf-donut--empty")).not.toBeNull();
    expectNoNaNText(container);
  });

  it("renders empty state for NaN", () => {
    const { container } = render(<Donut value={NaN} />);
    expect(container.querySelector(".hf-donut--empty")).not.toBeNull();
  });

  it("clamps values > 1", () => {
    const { container } = render(<Donut value={5} />);
    expect(container.querySelector(".hf-donut-progress")).not.toBeNull();
  });
});

describe("SliceDonut", () => {
  it("renders all slices", () => {
    const { container } = render(
      <SliceDonut
        slices={[
          { label: "facts", value: 3 },
          { label: "prefs", value: 2 },
          { label: "topics", value: 7 },
        ]}
      />,
    );
    expect(container.querySelector(".hf-slice-donut")).not.toBeNull();
    expectNoNaNText(container);
  });

  it("handles empty slices", () => {
    const { container } = render(<SliceDonut slices={[]} />);
    expect(container.querySelector(".hf-slice-donut--empty")).not.toBeNull();
  });

  it("handles all-zero slices", () => {
    const { container } = render(
      <SliceDonut
        slices={[
          { label: "facts", value: 0 },
          { label: "prefs", value: 0 },
        ]}
      />,
    );
    expect(container.querySelector(".hf-slice-donut--empty")).not.toBeNull();
  });
});

describe("HeatmapStrip", () => {
  it("renders one cell per item", () => {
    const { container } = render(
      <HeatmapStrip
        cells={[
          { key: "a", label: "Part 1", value: 0.85 },
          { key: "b", label: "Part 2", value: 0.32 },
          { key: "c", label: "Part 3", value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll(".hf-heatmap-cell").length).toBe(3);
    expectNoNaNText(container);
  });

  it("renders empty state when no cells", () => {
    const { container } = render(<HeatmapStrip cells={[]} />);
    expect(container.querySelector(".hf-heatmap-empty")).not.toBeNull();
  });

  it("renders em-dash for null value cells", () => {
    const { container } = render(
      <HeatmapStrip
        cells={[{ key: "a", label: "Part 1", value: null }]}
      />,
    );
    expect(container.textContent).toContain("—");
  });
});

describe("CalendarStrip", () => {
  it("renders one dot per day", () => {
    const { container } = render(
      <CalendarStrip
        days={[
          { date: "2026-05-20", active: true },
          { date: "2026-05-21", active: false },
          { date: "2026-05-22", active: true },
        ]}
      />,
    );
    expect(container.querySelectorAll(".hf-calendar-dot").length).toBe(3);
    expect(container.querySelectorAll(".hf-calendar-dot--active").length).toBe(
      2,
    );
  });

  it("renders empty state for zero days", () => {
    const { container } = render(<CalendarStrip days={[]} />);
    expect(container.querySelector(".hf-calendar-strip--empty")).not.toBeNull();
  });
});

describe("SparklineCard", () => {
  it("renders trend with multi-point history", () => {
    const { container } = render(
      <SparklineCard
        title="Pronunciation"
        history={[0.2, 0.4, 0.6, 0.8]}
        avg={0.5}
        delta={0.6}
      />,
    );
    expect(container.querySelector(".hf-sparkline-card")).not.toBeNull();
    expectNoNaNText(container);
  });

  it("shows 'Not enough data' for <2 points", () => {
    const { container } = render(
      <SparklineCard title="Pronunciation" history={[0.5]} />,
    );
    expect(container.textContent).toContain("Not enough data");
  });

  it("handles empty history", () => {
    const { container } = render(
      <SparklineCard title="Pronunciation" history={[]} />,
    );
    expectNoNaNText(container);
  });
});

describe("Radar", () => {
  it("renders for ≥3 dimensions", () => {
    const { container } = render(
      <Radar
        dimensions={[
          { id: "speaking", label: "Speaking", value: 0.6 },
          { id: "listening", label: "Listening", value: 0.7 },
          { id: "writing", label: "Writing", value: 0.5 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders null for <3 dimensions", () => {
    const { container } = render(
      <Radar
        dimensions={[{ id: "speaking", label: "Speaking", value: 0.6 }]}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("EQMixer", () => {
  it("renders bands and tracks", () => {
    const { container } = render(
      <EQMixer
        bands={[
          {
            id: "BEH",
            label: "Behaviour",
            tracks: [
              { id: "a", label: "Practice", current: 0.85, default: 0.5 },
              { id: "b", label: "Repetition", current: 0.2, default: 0.5 },
            ],
          },
        ]}
      />,
    );
    expect(container.querySelector(".hf-eq-mixer-band")).not.toBeNull();
    expectNoNaNText(container);
  });

  it("renders empty state for zero tracks", () => {
    const { container } = render(<EQMixer bands={[]} />);
    expect(container.querySelector(".hf-eq-mixer-empty")).not.toBeNull();
  });
});

describe("TopicCloud", () => {
  it("renders one chip per topic", () => {
    const { container } = render(
      <TopicCloud
        topics={[
          { key: "a", label: "family", weight: 5, ageDays: 2 },
          { key: "b", label: "travel", weight: 3, ageDays: 10 },
        ]}
      />,
    );
    expect(container.querySelectorAll(".hf-topic-chip").length).toBe(2);
  });

  it("renders empty state for zero topics", () => {
    const { container } = render(<TopicCloud topics={[]} />);
    expect(container.querySelector(".hf-topic-cloud-empty")).not.toBeNull();
  });
});

describe("TimelineRibbon", () => {
  it("renders sequence of nodes", () => {
    const { container } = render(
      <TimelineRibbon
        nodes={[
          { key: "s1", label: "S1", status: "done" },
          { key: "s2", label: "S2", status: "current" },
          { key: "s3", label: "S3", status: "upcoming" },
        ]}
      />,
    );
    expect(container.querySelectorAll(".hf-timeline-node").length).toBe(3);
    expect(container.querySelector(".hf-timeline-node--current")).not.toBeNull();
  });

  it("renders empty state for zero nodes", () => {
    const { container } = render(<TimelineRibbon nodes={[]} />);
    expect(container.querySelector(".hf-timeline-ribbon-empty")).not.toBeNull();
  });
});
