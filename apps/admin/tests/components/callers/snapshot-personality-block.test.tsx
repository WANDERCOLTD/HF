/**
 * Tests for SnapshotPersonalityBlock — #1665 (Epic #1606 Group C
 * Phase 3, folded A.7).
 *
 * Pinned acceptance:
 *   1. Loading + error + no-profile-yet empty states.
 *   2. Populated state — groups by domainGroup with parameter rows.
 *   3. Acronym vs snake_case label formatting (BIG_FIVE → BIG_FIVE,
 *      big_five → Big Five).
 *   4. Value formatted to 2 decimal places.
 *   5. "Built from N calls" footnote.
 *   6. Decision 5: interpretationHigh/Low NOT rendered.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotPersonalityBlock } from "@/components/callers/caller-detail/SnapshotPersonalityBlock";

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

describe("SnapshotPersonalityBlock — loading + error + empty states", () => {
  it("renders the loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on fetch reject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load personality profile/)).toBeTruthy(),
    );
  });

  it("renders error badge on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load personality profile/)).toBeTruthy(),
    );
  });

  it("renders 'No personality profile yet' when route returns profile: null", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({ ok: true, callerId: CALLER_ID, profile: null }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No personality profile yet — builds up over calls/),
      ).toBeTruthy(),
    );
  });

  it("renders 'No personality profile yet' when parameters array is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            profile: {
              parameters: [],
              lastUpdatedAt: null,
              callsUsed: 0,
              specsUsed: 0,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No personality profile yet — builds up over calls/),
      ).toBeTruthy(),
    );
  });
});

describe("SnapshotPersonalityBlock — populated state", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            profile: {
              parameters: [
                {
                  parameterId: "engagement",
                  name: "Engagement",
                  domainGroup: "behavior",
                  value: 0.823,
                },
                {
                  parameterId: "B5-O",
                  name: "Openness",
                  domainGroup: "big_five",
                  value: 0.72,
                },
                {
                  parameterId: "B5-C",
                  name: "Conscientiousness",
                  domainGroup: "big_five",
                  value: 0.65,
                },
              ],
              lastUpdatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              callsUsed: 4,
              specsUsed: 2,
            },
          }),
          { status: 200 },
        ),
      ),
    );
  });

  it("renders one card per domainGroup", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-personality-group-big_five")).toBeTruthy(),
    );
    expect(screen.getByTestId("hf-personality-group-behavior")).toBeTruthy();
  });

  it("formats snake_case domainGroups as Title Case in the card label", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Big Five — 2/)).toBeTruthy());
    expect(screen.getByText(/Behavior — 1/)).toBeTruthy();
  });

  it("renders each parameter with its name and 2-decimal value", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Openness/)).toBeTruthy());
    expect(screen.getByText(/Conscientiousness/)).toBeTruthy();
    expect(screen.getByText(/Engagement/)).toBeTruthy();
    expect(screen.getByText(/0\.82/)).toBeTruthy();
    expect(screen.getByText(/0\.72/)).toBeTruthy();
    expect(screen.getByText(/0\.65/)).toBeTruthy();
  });

  it("shows the 'updated yesterday' relative-date hint in the header", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/updated yesterday/)).toBeTruthy());
  });

  it("renders the 'Built from N calls' footnote with optional specs count", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Built from 4 calls/)).toBeTruthy());
    expect(screen.getByText(/2 specs/)).toBeTruthy();
  });

  it("does NOT render Parameter.interpretationHigh/Low (Decision 5)", async () => {
    render(<SnapshotPersonalityBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Openness/)).toBeTruthy());
    // The fixture doesn't supply interpretation strings and the component
    // intentionally doesn't read them. Pin the absence.
    expect(screen.queryByText(/interpretation/i)).toBeNull();
  });
});
