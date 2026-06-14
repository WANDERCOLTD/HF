/**
 * Tests for SnapshotSubSkills — #1662 (Epic #1606 Group C Phase 2).
 *
 * Pinned acceptance:
 *   1. Loading + error + empty states render the appropriate badge.
 *   2. Populated state renders one card per domainGroup, with parameters
 *      inside each card.
 *   3. Tier badge present when currentScore is set; "Awaiting evidence"
 *      muted badge when null.
 *   4. exceedsTarget rows get the "exceeds target" success chip.
 *   5. domainGroup formatting: acronyms (DISC) stay uppercase;
 *      snake_case → Title Case.
 *   6. Score line shows "currentScore / target X" + calls-used count.
 *   7. interpretationHigh/Low strings NOT rendered (Decision 5 — #1664
 *      sweeps interpretations as OPERATOR-only separately).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotSubSkills } from "@/components/callers/caller-detail/SnapshotSubSkills";

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

describe("SnapshotSubSkills — loading + error + empty", () => {
  it("renders the loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on fetch reject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load sub-skills/)).toBeTruthy(),
    );
  });

  it("renders error badge on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to load sub-skills/)).toBeTruthy(),
    );
  });

  it("renders 'No sub-skills tracked yet' when groups array is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({ ok: true, callerId: CALLER_ID, groups: [] }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/No sub-skills tracked yet/)).toBeTruthy(),
    );
  });
});

describe("SnapshotSubSkills — populated state", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            callerId: CALLER_ID,
            groups: [
              {
                domainGroup: "communication",
                parameters: [
                  {
                    parameterId: "directness",
                    name: "Directness",
                    currentScore: 0.55,
                    targetValue: 0.6,
                    exceedsTarget: false,
                    tier: "developing",
                    callsUsed: 3,
                  },
                ],
              },
              {
                domainGroup: "DISC",
                parameters: [
                  {
                    parameterId: "DISC_D",
                    name: "Dominance",
                    currentScore: 0.82,
                    targetValue: 0.6,
                    exceedsTarget: true,
                    tier: "secure",
                    callsUsed: 5,
                  },
                  {
                    parameterId: "DISC_S",
                    name: "Steadiness",
                    currentScore: null,
                    targetValue: 0.5,
                    exceedsTarget: false,
                    tier: null,
                    callsUsed: 0,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
  });

  it("renders one card per domainGroup", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("hf-subskill-group-communication")).toBeTruthy(),
    );
    expect(screen.getByTestId("hf-subskill-group-DISC")).toBeTruthy();
  });

  it("formats acronyms as-is and snake_case as Title Case", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/DISC — 2/)).toBeTruthy());
    expect(screen.getByText(/Communication — 1/)).toBeTruthy();
  });

  it("shows tier badge when currentScore is set", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/Dominance/)).toBeTruthy(),
    );
    expect(screen.getByText(/Secure/)).toBeTruthy();
    expect(screen.getByText(/Developing/)).toBeTruthy();
  });

  it("shows 'Awaiting evidence' muted badge when currentScore is null", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Steadiness/)).toBeTruthy());
    expect(screen.getByText(/Awaiting evidence/)).toBeTruthy();
  });

  it("shows 'exceeds target' chip when exceedsTarget is true", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Dominance/)).toBeTruthy());
    expect(screen.getByText(/exceeds target/)).toBeTruthy();
  });

  it("shows current/target score + calls-used count in the meta line", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Directness/)).toBeTruthy());
    expect(screen.getByText(/0\.55 \/ target 0\.60/)).toBeTruthy();
    expect(screen.getByText(/3 calls/)).toBeTruthy();
  });

  it("does NOT render Parameter.interpretationHigh/Low (Decision 5 — OPERATOR-only sweep ships in #1664)", async () => {
    render(<SnapshotSubSkills callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Dominance/)).toBeTruthy());
    // No interpretation strings appear (the fixture doesn't supply them
    // and the component intentionally doesn't read them).
    expect(screen.queryByText(/interpretation/i)).toBeNull();
  });
});
