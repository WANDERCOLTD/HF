/**
 * PR 8 — Overview / Plan / Trajectory lenses.
 *
 * Trajectory wraps an external card; smoke check only. Overview + Plan
 * compose primitives from data; verify the data → primitive mapping.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { OverviewLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/OverviewLens";
import { PlanLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/PlanLens";
import { TrajectoryLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/TrajectoryLens";
import {
  LENSES,
  LENS_ORDER,
} from "@/components/callers/caller-detail/caller-detail-v2/lenses/registry";

import type { UpliftData } from "@/components/callers/caller-detail/types";

function basePayload(): UpliftData {
  return {
    confidencePre: null,
    confidencePost: null,
    confidenceDelta: null,
    testScorePre: null,
    testScorePost: null,
    knowledgeDelta: null,
    overallMastery: 0,
    totalCalls: 0,
    firstCallAt: null,
    latestCallAt: null,
    timeOnPlatformDays: 0,
    moduleProgress: [],
    goals: [],
    scoreTrends: [],
    adaptationEvidence: [],
    memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
    callFrequencyPerWeek: 0,
  };
}

function mockFetch(payload: Partial<UpliftData>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        json: async () => ({ ok: true, uplift: { ...basePayload(), ...payload } }),
      } as unknown as Response),
    ),
  );
}

describe("OverviewLens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders mastery + calls + days; survives missing pre/post", async () => {
    mockFetch({
      overallMastery: 0.72,
      totalCalls: 14,
      timeOnPlatformDays: 28,
      callFrequencyPerWeek: 3.5,
    });
    const { container } = render(<OverviewLens callerId="c1" />);
    await waitFor(() => {
      expect(container.textContent).toContain("72%");
    });
    expect(container.textContent).toContain("Mastery");
    expect(container.textContent).toContain("Confidence");
    expect(container.textContent).toContain("Knowledge");
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe("PlanLens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a TimelineRibbon node per call (most recent → 'current')", async () => {
    const dates = [
      "2026-05-20T00:00:00Z",
      "2026-05-22T00:00:00Z",
      "2026-05-25T00:00:00Z",
    ];
    mockFetch({ callDates: dates });
    const { container } = render(<PlanLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".hf-timeline-node").length).toBe(3);
    });
    expect(container.querySelectorAll(".hf-timeline-node--current").length).toBe(1);
    expect(container.querySelectorAll(".hf-timeline-node--done").length).toBe(2);
  });

  it("renders TimelineRibbon empty state when no callDates", async () => {
    mockFetch({ callDates: [] });
    const { container } = render(<PlanLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-timeline-ribbon-empty")).not.toBeNull();
    });
  });
});

describe("TrajectoryLens (wrapper)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders without crashing for a valid callerId", () => {
    // LearningTrajectoryCard does its own fetching; we just smoke-check
    // that the wrapper mounts.
    mockFetch({});
    const { container } = render(<TrajectoryLens callerId="c1" />);
    expect(container.querySelector(".hf-progress-v2-lens")).not.toBeNull();
  });
});

describe("LENSES registry (after PR 8)", () => {
  it("every lens in LENS_ORDER has a Component", () => {
    for (const id of LENS_ORDER) {
      expect(
        LENSES[id].Component,
        `LENSES.${id} must have a Component after PR 8`,
      ).toBeDefined();
    }
  });
});
