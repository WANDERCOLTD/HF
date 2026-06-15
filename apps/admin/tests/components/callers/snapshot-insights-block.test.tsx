/**
 * Tests for SnapshotInsightsBlock — Wave B of the legacy-tab retirement
 * plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotInsightsBlock } from "@/components/callers/caller-detail/SnapshotInsightsBlock";

const CALLER_ID = "caller-1";

function mockFetch(response: Response | (() => Response | Promise<Response>)) {
  return vi.fn(async () =>
    typeof response === "function" ? response() : response,
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

describe("SnapshotInsightsBlock — empty + error states", () => {
  it("renders loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on non-OK", async () => {
    vi.stubGlobal("fetch", mockFetch(new Response(null, { status: 500 })));
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load insights/)).toBeTruthy(),
    );
  });

  it("renders 'No achievements or focus areas yet' when both lists empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            momentum: "new",
            callStreak: 0,
            lastCallDaysAgo: null,
            totalCalls: 0,
            focusAreas: [],
            achievements: [],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No achievements or focus areas yet/),
      ).toBeTruthy(),
    );
  });
});

describe("SnapshotInsightsBlock — populated state", () => {
  function populatedFixture() {
    return {
      ok: true,
      callerId: CALLER_ID,
      momentum: "accelerating" as const,
      callStreak: 4,
      lastCallDaysAgo: 1,
      totalCalls: 12,
      focusAreas: [
        {
          type: "needs_attention" as const,
          moduleId: "m1",
          moduleName: "Chain Rule",
          mastery: 0.3,
          reason: "30% mastery",
          recommendation: "Needs more practice",
        },
      ],
      achievements: [
        { icon: "🔥", label: "4-lesson streak", value: "" },
        { icon: "⭐", label: "Limits mastered", value: "" },
        { icon: "💬", label: "12 lessons total", value: "" },
      ],
    };
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
  });

  it("renders the momentum badge (success variant for accelerating)", async () => {
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-insights-momentum")).toBeTruthy(),
    );
    expect(screen.getByText("Accelerating")).toBeTruthy();
  });

  it("renders the call-count + streak + last-call line", async () => {
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/12 calls/)).toBeTruthy(),
    );
    expect(screen.getByText(/4-call streak/)).toBeTruthy();
    expect(screen.getByText(/last call yesterday/)).toBeTruthy();
  });

  it("renders achievements as badge row", async () => {
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-achievements")).toBeTruthy(),
    );
    expect(screen.getByText(/4-lesson streak/)).toBeTruthy();
    expect(screen.getByText(/Limits mastered/)).toBeTruthy();
    expect(screen.getByText(/12 lessons total/)).toBeTruthy();
  });

  it("renders focus areas with type chip + module name + reason + recommendation", async () => {
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-focus-areas")).toBeTruthy(),
    );
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
    expect(screen.getByText(/Chain Rule/)).toBeTruthy();
    expect(screen.getByText(/30% mastery — Needs more practice/)).toBeTruthy();
  });

  it("formats lastCallDaysAgo 'today' / 'Nd ago' correctly", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            momentum: "steady",
            callStreak: 0,
            lastCallDaysAgo: 0,
            totalCalls: 1,
            focusAreas: [],
            achievements: [],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/last call today/)).toBeTruthy(),
    );
  });

  it("renders 'no calls yet' suffix when lastCallDaysAgo is null", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            momentum: "new",
            callStreak: 0,
            lastCallDaysAgo: null,
            totalCalls: 0,
            focusAreas: [],
            achievements: [],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotInsightsBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/no calls yet/)).toBeTruthy(),
    );
  });
});
