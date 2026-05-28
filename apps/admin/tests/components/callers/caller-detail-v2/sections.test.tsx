/**
 * Section smoke + registry tests for Uplift v2.
 *
 * Sections are pure presentational once their data lands. Each one is
 * tested against a realistic fixture, an "awaiting first call" empty
 * fixture, and a fetch failure. Registry parity check guards against
 * stale section definitions slipping through.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { HeroSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/HeroSection";
import { ModulesSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/ModulesSection";
import {
  UPLIFT_SECTIONS,
  UPLIFT_PLACEHOLDERS,
} from "@/components/callers/caller-detail/caller-detail-v2/sections/registry";

import type { UpliftData } from "@/components/callers/caller-detail/types";

function realisticFixture(): UpliftData {
  return {
    confidencePre: 3.4,
    confidencePost: 4.2,
    confidenceDelta: 0.8,
    testScorePre: 0.54,
    testScorePost: 0.72,
    knowledgeDelta: 0.18,
    overallMastery: 0.85,
    totalCalls: 12,
    firstCallAt: "2026-05-01T00:00:00Z",
    latestCallAt: "2026-05-27T00:00:00Z",
    timeOnPlatformDays: 47,
    moduleProgress: [
      {
        moduleId: "m1",
        slug: "part-1",
        title: "Part 1: Familiar Topics",
        sortOrder: 1,
        mastery: 0.85,
        status: "ACTIVE",
        callCount: 12,
      },
      {
        moduleId: "m2",
        slug: "part-2",
        title: "Part 2: Long Turn",
        sortOrder: 2,
        mastery: 0.32,
        status: "ACTIVE",
        callCount: 4,
      },
      {
        moduleId: "m3",
        slug: "part-3",
        title: "Part 3: Discussion",
        sortOrder: 3,
        mastery: 0.58,
        status: "COMPLETED",
        callCount: 7,
      },
    ],
    goals: [],
    scoreTrends: [
      {
        parameterId: "skill_a",
        parameterName: "Pronunciation",
        scores: [
          { callDate: "2026-05-20", score: 0.4, confidence: 1 },
          { callDate: "2026-05-22", score: 0.6, confidence: 1 },
          { callDate: "2026-05-24", score: 0.8, confidence: 1 },
        ],
      },
    ],
    adaptationEvidence: [],
    memoryCounts: { facts: 3, preferences: 2, events: 0, topics: 7, total: 12 },
    callFrequencyPerWeek: 3,
  };
}

function awaitingFixture(): UpliftData {
  return {
    ...realisticFixture(),
    confidencePre: null,
    confidencePost: null,
    confidenceDelta: null,
    testScorePre: null,
    testScorePost: null,
    knowledgeDelta: null,
    overallMastery: 0,
    totalCalls: 0,
    timeOnPlatformDays: 0,
    moduleProgress: [],
    scoreTrends: [],
  };
}

function mockUpliftFetch(payload: UpliftData | null, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        json: async () => (payload ? { ok, uplift: payload } : { ok: false, error: "boom" }),
      } as unknown as Response),
    ),
  );
}

describe("HeroSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders mastery / confidence / knowledge from fixture data", async () => {
    mockUpliftFetch(realisticFixture());
    const { container, queryAllByText } = render(<HeroSection callerId="c1" />);

    await waitFor(() => {
      expect(container.textContent).toContain("85%");
    });

    // pre→post centre is rendered for confidence and knowledge
    expect(queryAllByText("→").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Mastery");
    expect(container.textContent).toContain("Confidence");
    expect(container.textContent).toContain("Knowledge");
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it("shows 'Awaiting first call' empty state with no data", async () => {
    mockUpliftFetch(awaitingFixture());
    const { container } = render(<HeroSection callerId="c1" />);

    await waitFor(() => {
      expect(container.textContent).toContain("Awaiting first call");
    });
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it("renders without crashing on fetch failure", async () => {
    mockUpliftFetch(null, false);
    const { container } = render(<HeroSection callerId="c1" />);

    await waitFor(() => {
      // After fetch error the component should not be stuck at "Loading…"
      expect(container.textContent).not.toContain("Loading proof points");
    });
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe("ModulesSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders one heatmap cell per module in sortOrder", async () => {
    mockUpliftFetch(realisticFixture());
    const { container } = render(<ModulesSection callerId="c1" />);

    await waitFor(() => {
      expect(container.querySelectorAll(".hf-heatmap-cell").length).toBe(3);
    });

    // First cell should be "Part 1: Familiar Topics" (sortOrder 1)
    const firstLabel = container.querySelector(".hf-heatmap-cell-label");
    expect(firstLabel?.textContent).toContain("Part 1");
  });

  it("shows '1 of 3 complete' subhead for fixture", async () => {
    mockUpliftFetch(realisticFixture());
    const { container } = render(<ModulesSection callerId="c1" />);

    await waitFor(() => {
      expect(container.textContent).toContain("1 of 3 complete");
    });
  });

  it("renders empty state when no modules", async () => {
    mockUpliftFetch(awaitingFixture());
    const { container } = render(<ModulesSection callerId="c1" />);

    await waitFor(() => {
      expect(container.querySelector(".hf-heatmap-empty")).not.toBeNull();
    });
  });
});

describe("UPLIFT_SECTIONS registry", () => {
  it("has Hero and Modules registered after PR 1b", () => {
    expect(UPLIFT_SECTIONS.hero).toBeDefined();
    expect(UPLIFT_SECTIONS.modules).toBeDefined();
  });

  it("every registered section has a Component and a span", () => {
    for (const [id, def] of Object.entries(UPLIFT_SECTIONS)) {
      if (!def) continue;
      expect(def.Component, `${id} Component`).toBeTypeOf("function");
      expect([4, 6, 8, 12]).toContain(def.span ?? 12);
    }
  });

  it("every registered section id has a matching placeholder entry", () => {
    for (const id of Object.keys(UPLIFT_SECTIONS)) {
      expect(
        UPLIFT_PLACEHOLDERS[id as keyof typeof UPLIFT_PLACEHOLDERS],
        `placeholder for ${id}`,
      ).toBeDefined();
    }
  });
});
