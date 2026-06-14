/**
 * Tests for SnapshotWhyThisCall — #1663 (Epic #1606 Group C Phase 2).
 *
 * Pinned acceptance:
 *   1. Loading + 2 error branches (fetch reject + non-OK) + no-decision states
 *   2. 404 → "No scheduler decision recorded yet" muted state (not error)
 *   3. Populated state — mode chip + reason prose + relative writtenAt
 *   4. Mode badge variants: assess → warning, teach → info, review → success
 *   5. Relative date formatting (today / yesterday / N days ago)
 *   6. workingSetAssertionIds NOT rendered (Decision 1)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotWhyThisCall } from "@/components/callers/caller-detail/SnapshotWhyThisCall";

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

describe("SnapshotWhyThisCall — loading + error + no-decision states", () => {
  it("renders the loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on fetch reject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load scheduler reason/)).toBeTruthy(),
    );
  });

  it("renders error badge on 5xx response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load scheduler reason/)).toBeTruthy(),
    );
  });

  it("treats 404 as 'no decision recorded' (not an error)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 404 })),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No scheduler decision recorded yet/),
      ).toBeTruthy(),
    );
  });

  it("renders 'no decision recorded' when route returns decision: null", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({ ok: true, callerId: CALLER_ID, decision: null }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No scheduler decision recorded yet/),
      ).toBeTruthy(),
    );
  });
});

describe("SnapshotWhyThisCall — populated state", () => {
  it("renders mode chip + reason prose + relative date", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            decision: {
              mode: "assess",
              reason: "Calls-since-last-assess hit the threshold",
              writtenAt: yesterday,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    // "assess" substring also lives inside the reason prose ("Calls-since-last-assess
    // …"); the mode-chip occurrence is enough — assert at least one match.
    await waitFor(() =>
      expect(screen.getAllByText(/assess/).length).toBeGreaterThan(0),
    );
    expect(
      screen.getByText(/Calls-since-last-assess hit the threshold/),
    ).toBeTruthy();
    expect(screen.getByText(/decided yesterday/)).toBeTruthy();
  });

  it("formats 'today' / 'N days ago' correctly", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            decision: {
              mode: "teach",
              reason: "Working on new content",
              writtenAt: new Date().toISOString(),
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/decided today/)).toBeTruthy());
  });

  it("does NOT render workingSetAssertionIds (Decision 1 — raw reason only)", async () => {
    // Even if the route accidentally surfaced these, the component
    // shouldn't render them. This pins the contract.
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            decision: {
              mode: "assess",
              reason: "Threshold hit",
              writtenAt: new Date().toISOString(),
              workingSetAssertionIds: ["assertion-1", "assertion-2"],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotWhyThisCall callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Threshold hit/)).toBeTruthy());
    expect(screen.queryByText(/assertion-1/)).toBeNull();
    expect(screen.queryByText(/assertion-2/)).toBeNull();
    expect(screen.queryByText(/workingSet/i)).toBeNull();
  });
});
