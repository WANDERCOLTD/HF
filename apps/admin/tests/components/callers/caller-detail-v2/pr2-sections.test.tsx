/**
 * PR 2 section smoke tests — AdaptationSection + ScoreTrendsSection.
 *
 * Verifies category-band grouping on the EQ mixer (PR 2 route widening) and
 * direction-sorting on the sparkline-card grid.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { AdaptationSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/AdaptationSection";
import { ScoreTrendsSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/ScoreTrendsSection";
import {
  UPLIFT_SECTIONS,
} from "@/components/callers/caller-detail/caller-detail-v2/sections/registry";

import type { UpliftData } from "@/components/callers/caller-detail/types";

function realisticAdaptationFixture(): Partial<UpliftData> {
  return {
    adaptationEvidence: [
      {
        parameterName: "BEH_PRACTICE_EXERCISES",
        parameterType: "BEHAVIOR",
        sectionId: "METHOD",
        definition:
          "How often the agent uses practice exercises vs explanations.",
        defaultValue: 0.5,
        currentValue: 0.85,
        delta: 0.35,
        callsUsed: 12,
        confidence: 0.9,
      },
      {
        parameterName: "BEH_REPETITION_FREQUENCY",
        parameterType: "BEHAVIOR",
        sectionId: "METHOD",
        definition: "Repetition cadence.",
        defaultValue: 0.5,
        currentValue: 0.2,
        delta: -0.3,
        callsUsed: 8,
        confidence: 0.8,
      },
      {
        parameterName: "TRT_FORMALITY",
        parameterType: "TRAIT",
        sectionId: "CHARACTER",
        definition: "How formal the agent's tone is.",
        defaultValue: 0.5,
        currentValue: 0.7,
        delta: 0.2,
        callsUsed: 14,
        confidence: 0.85,
      },
      {
        parameterName: "MYSTERY_PARAM",
        parameterType: null,
        sectionId: null,
        definition: null,
        defaultValue: 0.5,
        currentValue: 0.65,
        delta: 0.15,
        callsUsed: 4,
        confidence: 0.6,
      },
    ],
  };
}

function realisticTrendsFixture(): Partial<UpliftData> {
  return {
    scoreTrends: [
      {
        parameterId: "skill_pronounce",
        parameterName: "Pronunciation",
        parameterType: "STATE",
        sectionId: "EVIDENCE",
        definition: "Pronunciation clarity.",
        scores: [
          { callDate: "2026-05-20", score: 0.2, confidence: 1 },
          { callDate: "2026-05-21", score: 0.4, confidence: 1 },
          { callDate: "2026-05-22", score: 0.6, confidence: 1 },
          { callDate: "2026-05-23", score: 0.8, confidence: 1 },
        ],
      },
      {
        parameterId: "skill_gram",
        parameterName: "Grammar",
        parameterType: "STATE",
        sectionId: "EVIDENCE",
        definition: "Grammatical accuracy.",
        scores: [
          { callDate: "2026-05-20", score: 0.7, confidence: 1 },
          { callDate: "2026-05-21", score: 0.6, confidence: 1 },
          { callDate: "2026-05-22", score: 0.5, confidence: 1 },
          { callDate: "2026-05-23", score: 0.4, confidence: 1 },
        ],
      },
    ],
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

describe("AdaptationSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("groups tracks by parameterType into named bands", async () => {
    mockFetch(realisticAdaptationFixture());
    const { container } = render(<AdaptationSection callerId="c1" />);

    await waitFor(() => {
      const bands = container.querySelectorAll(".hf-eq-mixer-band");
      expect(bands.length).toBeGreaterThanOrEqual(2);
    });

    expect(container.textContent).toContain("Behaviour");
    expect(container.textContent).toContain("Trait");
    // null parameterType falls into Other
    expect(container.textContent).toContain("Other");
  });

  it("renders amplified / dampened summary line", async () => {
    mockFetch(realisticAdaptationFixture());
    const { container } = render(<AdaptationSection callerId="c1" />);

    await waitFor(() => {
      expect(container.textContent).toContain("amplified");
    });
    expect(container.textContent).toMatch(/\d+ amplified/);
    expect(container.textContent).toMatch(/\d+ dampened/);
  });

  it("renders the EQ-mixer empty state when no adaptations", async () => {
    mockFetch({ adaptationEvidence: [] });
    const { container } = render(<AdaptationSection callerId="c1" />);

    await waitFor(() => {
      expect(container.querySelector(".hf-eq-mixer-empty")).not.toBeNull();
    });
  });
});

describe("ScoreTrendsSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders one card per parameter with multi-point history", async () => {
    mockFetch(realisticTrendsFixture());
    const { container } = render(<ScoreTrendsSection callerId="c1" />);

    await waitFor(() => {
      expect(container.querySelectorAll(".hf-sparkline-card").length).toBe(2);
    });
  });

  it("places improving trend before declining trend (direction sort)", async () => {
    mockFetch(realisticTrendsFixture());
    const { container } = render(<ScoreTrendsSection callerId="c1" />);

    await waitFor(() => {
      const cards = container.querySelectorAll(".hf-sparkline-card");
      expect(cards.length).toBe(2);
    });
    const cards = container.querySelectorAll(".hf-sparkline-card");
    // The first card should be the "up" trend (Pronunciation) and the second
    // should be the "down" trend (Grammar).
    expect(cards[0].textContent).toContain("Pronunciation");
    expect(cards[1].textContent).toContain("Grammar");
    expect(cards[0].className).toMatch(/hf-direction-up/);
    expect(cards[1].className).toMatch(/hf-direction-down/);
  });

  it("renders empty state when no trends", async () => {
    mockFetch({ scoreTrends: [] });
    const { container } = render(<ScoreTrendsSection callerId="c1" />);

    await waitFor(() => {
      expect(container.querySelector(".hf-uplift-v2-trends-empty")).not.toBeNull();
    });
  });
});

describe("UPLIFT_SECTIONS registry (after PR 2)", () => {
  it("has adaptation + score-trends registered alongside hero + modules", () => {
    expect(UPLIFT_SECTIONS.hero).toBeDefined();
    expect(UPLIFT_SECTIONS.modules).toBeDefined();
    expect(UPLIFT_SECTIONS.adaptation).toBeDefined();
    expect(UPLIFT_SECTIONS["score-trends"]).toBeDefined();
  });
});
