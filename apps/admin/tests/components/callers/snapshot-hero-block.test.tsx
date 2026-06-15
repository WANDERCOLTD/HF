/**
 * Tests for SnapshotHeroBlock — Wave C1 of the legacy-tab retirement plan.
 *
 * Thin wrapper around HeroSection — we smoke-test that the section
 * shell + delegate mount cleanly. The donut/sparkline rendering details
 * are pinned by the existing HeroSection bank.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotHeroBlock } from "@/components/callers/caller-detail/SnapshotHeroBlock";

const CALLER_ID = "caller-c1-hero";

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
        modules: [],
        goals: [],
        memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
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

describe("SnapshotHeroBlock", () => {
  it("renders the section shell with Proof points category label", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    render(<SnapshotHeroBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Proof points/)).toBeTruthy();
    });
  });

  it("delegates to HeroSection (Mastery / Confidence / Knowledge labels render)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    render(<SnapshotHeroBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Mastery")).toBeTruthy();
      expect(screen.getByText("Confidence")).toBeTruthy();
      expect(screen.getByText("Knowledge")).toBeTruthy();
    });
  });

  it("renders awaiting-first-call empty state when totalCalls=0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    render(<SnapshotHeroBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Awaiting first call/)).toBeTruthy();
    });
  });

  it("carries the hf-snapshot-hero data-testid for tab-content composition", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyUpliftResponse()));
    const { container } = render(<SnapshotHeroBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-hero"]')).toBeTruthy();
    });
  });
});
