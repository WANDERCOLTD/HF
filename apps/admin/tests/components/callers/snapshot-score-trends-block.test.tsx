/**
 * Tests for SnapshotScoreTrendsBlock — Wave C2 of the legacy-tab
 * retirement plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotScoreTrendsBlock } from "@/components/callers/caller-detail/SnapshotScoreTrendsBlock";

const CALLER_ID = "caller-c2-trends";

function emptyUpliftResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
      uplift: {
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
        callDates: [],
        timeOnPlatformDays: 0,
        callFrequencyPerWeek: 0,
        scoreTrends: [],
        adaptationEvidence: [],
        moduleProgress: [],
        goals: [],
        memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
        topTopics: [],
      },
    }),
    { status: 200 },
  );
}

function trendsUpliftResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
      uplift: {
        confidencePre: null,
        confidencePost: null,
        confidenceDelta: null,
        testScorePre: null,
        testScorePost: null,
        knowledgeDelta: null,
        overallMastery: 0.6,
        totalCalls: 4,
        firstCallAt: "2026-06-01T00:00:00Z",
        latestCallAt: "2026-06-14T00:00:00Z",
        callDates: [],
        timeOnPlatformDays: 14,
        callFrequencyPerWeek: 2,
        scoreTrends: [
          {
            parameterId: "skill_clarity",
            parameterName: "Clarity",
            parameterType: "skill",
            sectionId: null,
            definition: "Clarity of expression.",
            scores: [
              { callDate: "2026-06-10T00:00:00Z", score: 0.5, confidence: 0.8 },
              { callDate: "2026-06-14T00:00:00Z", score: 0.7, confidence: 0.85 },
            ],
          },
        ],
        adaptationEvidence: [],
        moduleProgress: [],
        goals: [],
        memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
        topTopics: [],
      },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotScoreTrendsBlock", () => {
  it("renders Score trends heading with empty-state copy when no params tracked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    render(<SnapshotScoreTrendsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Score trends")).toBeTruthy();
      expect(screen.getByText(/No score trends yet/)).toBeTruthy();
    });
  });

  it("renders parameter name and count when scoreTrends populated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => trendsUpliftResponse()));
    render(<SnapshotScoreTrendsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Clarity")).toBeTruthy();
      expect(screen.getByText(/1 param tracked/)).toBeTruthy();
    });
  });

  it("carries the hf-snapshot-score-trends data-testid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    const { container } = render(<SnapshotScoreTrendsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="hf-snapshot-score-trends"]'),
      ).toBeTruthy();
    });
  });
});
