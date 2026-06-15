/**
 * Tests for SnapshotEngagementBlock — Wave C1 of the legacy-tab
 * retirement plan. Smoke-test that the section + delegate mount.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotEngagementBlock } from "@/components/callers/caller-detail/SnapshotEngagementBlock";

const CALLER_ID = "caller-c1-engage";

function upliftWithMemories() {
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
        totalCalls: 7,
        firstCallAt: "2026-06-01T00:00:00Z",
        latestCallAt: "2026-06-15T00:00:00Z",
        callDates: ["2026-06-14T10:00:00Z", "2026-06-15T10:00:00Z"],
        timeOnPlatformDays: 14,
        callFrequencyPerWeek: 3.5,
        scoreTrends: [],
        adaptationEvidence: [],
        modules: [],
        goals: [],
        memoryCounts: {
          facts: 12,
          preferences: 3,
          events: 5,
          topics: 8,
          total: 28,
        },
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

describe("SnapshotEngagementBlock", () => {
  it("renders Engagement heading + Calls/week tile + 14-day strip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithMemories()));
    render(<SnapshotEngagementBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Engagement")).toBeTruthy();
      expect(screen.getByText(/Calls \/ week/)).toBeTruthy();
      expect(screen.getByText(/Last 14 days/)).toBeTruthy();
    });
  });

  it("shows memory total in slice-donut center", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithMemories()));
    render(<SnapshotEngagementBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("28")).toBeTruthy();
    });
  });

  it("carries the hf-snapshot-engagement data-testid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithMemories()));
    const { container } = render(<SnapshotEngagementBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-engagement"]')).toBeTruthy();
    });
  });
});
