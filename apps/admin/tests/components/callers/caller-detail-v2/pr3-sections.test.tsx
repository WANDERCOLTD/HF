/**
 * PR 3 — GoalsSection + EngagementSection + Print button on UpliftV2Tab.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

import { GoalsSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/GoalsSection";
import { EngagementSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/EngagementSection";
import { UpliftV2Tab } from "@/components/callers/caller-detail/caller-detail-v2/UpliftV2Tab";
import {
  UPLIFT_SECTIONS,
} from "@/components/callers/caller-detail/caller-detail-v2/sections/registry";

import type { UpliftData, Goal } from "@/components/callers/caller-detail/types";

function basePayload(): UpliftData {
  return {
    confidencePre: null,
    confidencePost: null,
    confidenceDelta: null,
    testScorePre: null,
    testScorePost: null,
    knowledgeDelta: null,
    overallMastery: 0,
    totalCalls: 12,
    firstCallAt: null,
    latestCallAt: null,
    timeOnPlatformDays: 30,
    moduleProgress: [],
    goals: [],
    scoreTrends: [],
    adaptationEvidence: [],
    memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
    callFrequencyPerWeek: 3,
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

function goal(over: Partial<Goal>): Goal {
  return {
    id: over.id ?? "g1",
    type: "MASTERY",
    name: "Speak fluently",
    description: null,
    status: "ACTIVE",
    priority: 1,
    progress: 0.6,
    startedAt: null,
    completedAt: null,
    targetDate: null,
    isAssessmentTarget: false,
    assessmentConfig: null,
    playbook: null,
    contentSpec: null,
    ...over,
  };
}

describe("GoalsSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("splits Active vs Completed into separate groups", async () => {
    mockFetch({
      goals: [
        goal({ id: "a", status: "ACTIVE", name: "Speak fluently", progress: 0.4 }),
        goal({ id: "b", status: "COMPLETED", name: "Daily practice", progress: 1, type: "FREQUENCY" }),
        goal({ id: "c", status: "ACTIVE", name: "Hit B2", progress: 0.7, type: "ACHIEVE" }),
      ],
    });
    const { container } = render(<GoalsSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".hf-uplift-v2-goal-card").length).toBe(3);
    });

    expect(container.querySelectorAll(".hf-uplift-v2-goals-group--active").length).toBe(1);
    expect(container.querySelectorAll(".hf-uplift-v2-goals-group--completed").length).toBe(1);
    expect(container.textContent).toContain("2 active · 1 done");
  });

  it("renders the unknown-type goal slug as-is without crashing", async () => {
    mockFetch({ goals: [goal({ id: "x", type: "RETIRED_TYPE_SLUG", name: "Old goal" })] });
    const { container } = render(<GoalsSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".hf-uplift-v2-goal-card").length).toBe(1);
    });
    expect(container.textContent?.toLowerCase()).toContain("retired_type_slug");
  });

  it("renders empty state when no goals", async () => {
    mockFetch({ goals: [] });
    const { container } = render(<GoalsSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-uplift-v2-goals-empty")).not.toBeNull();
    });
  });
});

describe("EngagementSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders memory slice donut + legend + stat tiles", async () => {
    mockFetch({
      memoryCounts: { facts: 4, preferences: 2, topics: 7, events: 1, total: 14 },
    });
    const { container } = render(<EngagementSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-slice-donut")).not.toBeNull();
    });
    expect(container.textContent).toContain("memories");
    expect(container.textContent).toContain("14");
    expect(container.querySelectorAll(".hf-stat-tile").length).toBe(2);
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it("renders empty memory donut when counts are all zero", async () => {
    mockFetch({
      memoryCounts: { facts: 0, preferences: 0, topics: 0, events: 0, total: 0 },
    });
    const { container } = render(<EngagementSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-slice-donut--empty")).not.toBeNull();
    });
  });
});

describe("UpliftV2Tab — Print / Export PDF button", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("invokes window.print() when clicked", async () => {
    mockFetch({});
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    // Mock window.print since jsdom doesn't implement it.
    Object.defineProperty(window, "print", { value: printSpy, configurable: true });

    const { getByRole } = render(<UpliftV2Tab callerId="c1" />);
    const btn = getByRole("button", { name: /Print or export this report/i });
    fireEvent.click(btn);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});

describe("UPLIFT_SECTIONS registry (after PR 3)", () => {
  it("has all six PR1b+PR2+PR3 sections registered", () => {
    expect(UPLIFT_SECTIONS.hero).toBeDefined();
    expect(UPLIFT_SECTIONS.modules).toBeDefined();
    expect(UPLIFT_SECTIONS.adaptation).toBeDefined();
    expect(UPLIFT_SECTIONS["score-trends"]).toBeDefined();
    expect(UPLIFT_SECTIONS.goals).toBeDefined();
    expect(UPLIFT_SECTIONS.engagement).toBeDefined();
  });
});
