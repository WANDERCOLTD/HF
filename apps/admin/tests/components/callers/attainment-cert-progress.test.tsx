/**
 * Tests for AttainmentCertProgressSection — Wave A2 of the legacy-tab
 * retirement plan. Lifts ProgressTab v1's TrustProgressSection into
 * AttainmentTab.
 *
 * Pinned acceptance:
 *   1. Loading + error + empty (no curricula) + empty-modules states
 *   2. Per-curriculum card renders name + cert readiness % + supplementary %
 *   3. Per-module row renders trustLevel badge (L0-L5/UNVERIFIED) + counts/supplementary flag + mastery %
 *   4. "N of M modules count toward certification" summary line
 *   5. Multiple curricula render as separate cards in a grid
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AttainmentCertProgressSection } from "@/components/callers/caller-detail/AttainmentCertProgressSection";

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

describe("AttainmentCertProgressSection — loading + error + empty", () => {
  it("renders loading badge before fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders error badge on non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Unable to load certification progress/),
      ).toBeTruthy(),
    );
  });

  it("renders 'No certification track yet' when curricula array empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(JSON.stringify({ ok: true, curricula: [] }), {
          status: 200,
        }),
      ),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/No certification track yet/)).toBeTruthy(),
    );
  });
});

describe("AttainmentCertProgressSection — populated state", () => {
  function populatedFixture() {
    return {
      ok: true,
      curricula: [
        {
          specSlug: "ielts-speaking-v1",
          specName: "IELTS Speaking",
          specId: "spec-1",
          currentModuleId: "part1",
          lastAccessedAt: "2026-06-14T09:00:00.000Z",
          certifiedMastery: 0.55,
          supplementaryMastery: 0.62,
          certificationReadiness: 0.5,
          moduleBreakdown: {
            part1: {
              mastery: 0.7,
              trustLevel: "L4",
              trustWeight: 0.85,
              countsToCertification: true,
            },
            mock: {
              mastery: 0.4,
              trustLevel: "UNVERIFIED",
              trustWeight: 0.05,
              countsToCertification: false,
            },
          },
        },
      ],
    };
  }

  it("renders the curriculum card with name + cert readiness + supplementary", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("hf-cert-curriculum-ielts-speaking-v1"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/IELTS Speaking/)).toBeTruthy();
    expect(screen.getByText(/Cert readiness 50%/)).toBeTruthy();
    expect(screen.getByText(/supplementary 62%/)).toBeTruthy();
  });

  it("renders the 'N of M modules count' summary line", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/1 of 2 modules count toward certification/),
      ).toBeTruthy(),
    );
  });

  it("renders per-module trust badges (L4 success, UNVERIFIED muted) + counts/supplementary flag", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText("part1")).toBeTruthy());
    expect(screen.getByText("L4")).toBeTruthy();
    expect(screen.getByText("UNVERIFIED")).toBeTruthy();
    expect(screen.getByText("counts")).toBeTruthy();
    expect(screen.getByText("supplementary")).toBeTruthy();
  });

  it("renders mastery % + trust-weight per module", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(populatedFixture()), { status: 200 })),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/70% mastery/)).toBeTruthy());
    expect(screen.getByText(/40% mastery/)).toBeTruthy();
    expect(screen.getByText(/trust weight 0\.85/)).toBeTruthy();
    expect(screen.getByText(/trust weight 0\.05/)).toBeTruthy();
  });

  it("renders 'No modules registered yet' when moduleBreakdown is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify({
            ok: true,
            curricula: [
              {
                specSlug: "empty-curr",
                specName: "Empty Curriculum",
                specId: null,
                currentModuleId: null,
                lastAccessedAt: null,
                certifiedMastery: 0,
                supplementaryMastery: 0,
                certificationReadiness: 0,
                moduleBreakdown: {},
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<AttainmentCertProgressSection callerId={CALLER_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/No modules registered yet/)).toBeTruthy(),
    );
  });
});
