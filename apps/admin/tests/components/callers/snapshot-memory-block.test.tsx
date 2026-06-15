/**
 * Tests for SnapshotMemoryBlock — Wave A1 of the legacy-tab retirement
 * plan (Profile memories fold into Snapshot).
 *
 * Pinned acceptance:
 *   1. Loading + error + empty states
 *   2. 4 category tiles always render with counts
 *   3. Memory list collapsed by default, "Show all N" expands
 *   4. Each memory row renders category chip + key + value +
 *      confidence % + decay (when < 1) + age
 *   5. Evidence excerpt rendered as quoted muted line when present
 *   6. lastMemoryAt formatted as relative ("today" / "yesterday" / N)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SnapshotMemoryBlock } from "@/components/callers/caller-detail/SnapshotMemoryBlock";

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

describe("SnapshotMemoryBlock — loading + error + empty", () => {
  it("renders loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load memory/)).toBeTruthy(),
    );
  });

  it("renders 'No memories captured yet' empty state when totals + list are zero", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            memories: [],
            summary: {
              factCount: 0,
              preferenceCount: 0,
              eventCount: 0,
              topicCount: 0,
              totalCount: 0,
              lastMemoryAt: null,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No memories captured yet — builds up over calls/),
      ).toBeTruthy(),
    );
  });
});

describe("SnapshotMemoryBlock — populated state", () => {
  function populatedFixture(memoryCount = 3) {
    const yesterday = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const memories = Array.from({ length: memoryCount }, (_, i) => ({
      id: `m${i + 1}`,
      category: ["FACT", "PREFERENCE", "EVENT", "TOPIC"][i % 4],
      key: `key_${i + 1}`,
      value: `value ${i + 1}`,
      confidence: 0.8 - i * 0.02,
      evidence: i === 0 ? "Quoted evidence excerpt" : null,
      extractedAt: yesterday,
      decayFactor: i === 1 ? 0.7 : 1.0,
    }));
    return {
      ok: true,
      callerId: CALLER_ID,
      memories,
      summary: {
        factCount: 12,
        preferenceCount: 4,
        eventCount: 2,
        topicCount: 7,
        totalCount: 25,
        lastMemoryAt: yesterday,
      },
    };
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
  });

  it("renders 4 category tiles with counts", async () => {
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-memory-tile-facts")).toBeTruthy(),
    );
    expect(screen.getByTestId("hf-memory-tile-prefs")).toBeTruthy();
    expect(screen.getByTestId("hf-memory-tile-events")).toBeTruthy();
    expect(screen.getByTestId("hf-memory-tile-topics")).toBeTruthy();
    // The numbers 12 / 4 / 2 / 7 should appear
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("renders memory rows with category chip + key + value + confidence + decay + age", async () => {
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText("key_1")).toBeTruthy());
    expect(screen.getByText("value 1")).toBeTruthy();
    // Confidence rendered as percentage
    expect(screen.getByText(/confidence 80%/)).toBeTruthy();
    // m2 has decayFactor 0.7 → "decayed to 70%"
    expect(screen.getByText(/decayed to 70%/)).toBeTruthy();
    // Relative age rendered as "yesterday"
    expect(screen.getAllByText(/yesterday/).length).toBeGreaterThan(0);
  });

  it("renders evidence excerpt as quoted muted line", async () => {
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Quoted evidence excerpt/)).toBeTruthy());
  });

  it("renders the lastMemoryAt relative-time hint in the header", async () => {
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/last updated yesterday/)).toBeTruthy(),
    );
  });

  it("renders header with totalCount", async () => {
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Memory — 25 captured/)).toBeTruthy(),
    );
  });
});

describe("SnapshotMemoryBlock — preview cap + expand toggle", () => {
  it("shows preview cap (6) + 'Show all N' toggle expands the full list", async () => {
    const lots = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i + 1}`,
      category: "FACT",
      key: `key_${i + 1}`,
      value: `value ${i + 1}`,
      confidence: 0.8,
      evidence: null,
      extractedAt: null,
      decayFactor: 1.0,
    }));
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            memories: lots,
            summary: {
              factCount: 10,
              preferenceCount: 0,
              eventCount: 0,
              topicCount: 0,
              totalCount: 10,
              lastMemoryAt: null,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotMemoryBlock callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText("key_1")).toBeTruthy());

    // First 6 visible
    expect(screen.getByText("key_6")).toBeTruthy();
    // key_7+ not yet visible
    expect(screen.queryByText("key_7")).toBeNull();

    // Click expand toggle
    fireEvent.click(screen.getByTestId("hf-snapshot-memory-toggle"));
    expect(screen.getByText("key_7")).toBeTruthy();
    expect(screen.getByText("key_10")).toBeTruthy();

    // Click again → collapses
    fireEvent.click(screen.getByTestId("hf-snapshot-memory-toggle"));
    expect(screen.queryByText("key_7")).toBeNull();
  });
});
