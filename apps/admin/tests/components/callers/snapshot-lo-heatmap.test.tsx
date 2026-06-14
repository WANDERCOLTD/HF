/**
 * Tests for SnapshotLoHeatmap — #1661 (Epic #1606 Group C).
 *
 * Pins the ADR contract (`docs/decisions/2026-06-14-caller-snapshot-heatmap-grid.md`):
 *   1. Per-module parallel fetch on mount; module count = fetch count
 *   2. 4-tier CTO scheme detected from observed `tier` values
 *   3. 3-tier scheme detected when only emerging/developing/secure appear
 *   4. Awaiting-evidence rows render with all cells dashed (no active cell)
 *   5. Click cell → side panel opens; click same cell again → closes
 *   6. Escape key closes the panel
 *   7. Empty modules array → "No modules in curriculum yet" empty state
 *   8. Module-level avg mastery shown in sticky header; "—" when all
 *      LOs are not_started
 *   9. useFreshMastery=true renders the scratch-mastery lozenge
 *  10. Evidence side panel: 404 → "Evidence not available" muted note
 *  11. Evidence side panel: populated response → excerpts render
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { SnapshotLoHeatmap } from "@/components/callers/caller-detail/SnapshotLoHeatmap";

const CALLER_ID = "caller-1";

function makeLoMasteryResponse(opts: {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  los: Array<{
    ref: string;
    description: string;
    mastery: number | null;
    tier: string | null;
    status: "mastered" | "in_progress" | "not_started";
  }>;
}) {
  return {
    callerId: CALLER_ID,
    playbookId: "pb-1",
    moduleId: opts.moduleId,
    moduleSlug: opts.moduleSlug,
    moduleTitle: opts.moduleTitle,
    useFreshMastery: false,
    scratchSourceCallId: null,
    learningObjectives: opts.los.map((lo) => ({
      ref: lo.ref,
      description: lo.description,
      mastery: lo.mastery,
      tier: lo.tier,
      bandLabel: lo.tier === "distinction" ? 4 : lo.tier === "practitioner" ? 3 : 2,
      masteryThreshold: 0.7,
      status: lo.status,
      updatedAt: lo.mastery !== null ? "2026-06-14T10:00:00.000Z" : null,
    })),
  };
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u);
  });
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotLoHeatmap — empty + loading states", () => {
  it("renders the 'No modules' empty state when modules array is empty", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <SnapshotLoHeatmap callerId={CALLER_ID} modules={[]} useFreshMastery={false} />,
    );
    expect(screen.getByTestId("hf-snapshot-lo-heatmap-empty")).toBeTruthy();
    expect(screen.getByText(/No modules in curriculum yet/i)).toBeTruthy();
  });

  it("shows a loading placeholder before the first fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})), // never resolves
    );
    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );
    expect(screen.getByTestId("hf-snapshot-lo-heatmap-loading")).toBeTruthy();
  });
});

describe("SnapshotLoHeatmap — parallel fetch + tier-scheme detection", () => {
  it("fires one fetch per module in parallel", async () => {
    const fetchSpy = mockFetch((url) => {
      const match = url.match(/moduleId=([^&]+)/);
      const id = match ? decodeURIComponent(match[1]) : "?";
      return new Response(
        JSON.stringify(
          makeLoMasteryResponse({
            moduleId: id,
            moduleSlug: id,
            moduleTitle: id,
            los: [],
          }),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[
          { id: "m1", slug: "m1", title: "M1" },
          { id: "m2", slug: "m2", title: "M2" },
          { id: "m3", slug: "m3", title: "M3" },
        ]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
  });

  it("detects 4-tier CTO scheme when LO tiers include 'foundation' / 'distinction'", async () => {
    const fetchSpy = mockFetch((url) => {
      if (!url.includes("/lo-mastery")) {
        return new Response(null, { status: 404 });
      }
      return new Response(
        JSON.stringify(
          makeLoMasteryResponse({
            moduleId: "m1",
            moduleSlug: "m1",
            moduleTitle: "M1",
            los: [
              {
                ref: "LO-01",
                description: "Foundation skill",
                mastery: 0.3,
                tier: "foundation",
                status: "in_progress",
              },
              {
                ref: "LO-02",
                description: "Distinction skill",
                mastery: 0.92,
                tier: "distinction",
                status: "mastered",
              },
            ],
          }),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    // Column headers + cell aria-labels both carry these labels, so use
    // getAllByText and assert at least one occurrence per scheme member.
    await waitFor(() =>
      expect(screen.getAllByText(/Foundation/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Practitioner/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Distinction/).length).toBeGreaterThan(0);
  });

  it("detects 3-tier default scheme when only emerging/developing/secure appear", async () => {
    const fetchSpy = mockFetch((url) => {
      if (!url.includes("/lo-mastery")) {
        return new Response(null, { status: 404 });
      }
      return new Response(
        JSON.stringify(
          makeLoMasteryResponse({
            moduleId: "m1",
            moduleSlug: "m1",
            moduleTitle: "M1",
            los: [
              {
                ref: "LO-01",
                description: "Emerging",
                mastery: 0.2,
                tier: "emerging",
                status: "in_progress",
              },
              {
                ref: "LO-02",
                description: "Secure",
                mastery: 0.85,
                tier: "secure",
                status: "mastered",
              },
            ],
          }),
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Emerging/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Secure/).length).toBeGreaterThan(0);
    // 4-tier-only labels MUST NOT appear (neither as column header nor as
    // cell aria-label) when 3-tier scheme is selected.
    expect(screen.queryAllByText(/Foundation/).length).toBe(0);
    expect(screen.queryAllByText(/Distinction/).length).toBe(0);
    expect(screen.queryAllByText(/Practitioner/).length).toBe(0);
  });
});

describe("SnapshotLoHeatmap — module header avg + useFreshMastery", () => {
  it("shows module-level avg mastery in the sticky header", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        if (!url.includes("/lo-mastery")) {
          return new Response(null, { status: 404 });
        }
        return new Response(
          JSON.stringify(
            makeLoMasteryResponse({
              moduleId: "m1",
              moduleSlug: "module-1",
              moduleTitle: "Module 1",
              los: [
                { ref: "LO-01", description: "x", mastery: 0.4, tier: "developing", status: "in_progress" },
                { ref: "LO-02", description: "y", mastery: 0.8, tier: "secure", status: "mastered" },
              ],
            }),
          ),
          { status: 200 },
        );
      }),
    );

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "module-1", title: "Module 1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-lo-modhdr-module-1")).toBeTruthy(),
    );
    // (0.4 + 0.8) / 2 = 0.60
    expect(screen.getByText(/avg 0\.60/)).toBeTruthy();
  });

  it("shows avg '—' when all LOs are not_started", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        new Response(
          JSON.stringify(
            makeLoMasteryResponse({
              moduleId: "m1",
              moduleSlug: "m1",
              moduleTitle: "M1",
              los: [
                { ref: "LO-01", description: "x", mastery: null, tier: null, status: "not_started" },
              ],
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(screen.getByText(/avg —/)).toBeTruthy());
    // Awaiting-evidence row uses the score-column copy
    expect(screen.getAllByText(/Awaiting evidence/).length).toBeGreaterThan(0);
  });

  it("renders the mock-exam scratch mastery lozenge when useFreshMastery is true", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        new Response(
          JSON.stringify(
            makeLoMasteryResponse({
              moduleId: "m1",
              moduleSlug: "m1",
              moduleTitle: "M1",
              los: [],
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={true}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/mock-exam scratch mastery/i)).toBeTruthy(),
    );
  });
});

describe("SnapshotLoHeatmap — cell click + side panel", () => {
  function populatedFetch() {
    return mockFetch((url) => {
      if (url.includes("/lo-mastery")) {
        return new Response(
          JSON.stringify(
            makeLoMasteryResponse({
              moduleId: "m1",
              moduleSlug: "m1",
              moduleTitle: "M1",
              los: [
                {
                  ref: "LO-01",
                  description: "Chain rule",
                  mastery: 0.55,
                  tier: "developing",
                  status: "in_progress",
                },
              ],
            }),
          ),
          { status: 200 },
        );
      }
      if (url.includes("/skills-evidence")) {
        return new Response(
          JSON.stringify({
            callerId: CALLER_ID,
            evidence: [
              {
                skillRef: "LO-01",
                excerpts: [
                  { excerpt: "Applied chain rule correctly", callId: "call-7", at: null },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
  }

  it("opens the side panel on first click and toggles closed on second click of the same cell", async () => {
    vi.stubGlobal("fetch", populatedFetch());

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Chain rule/)).toBeTruthy());

    // Click the active "developing" cell for LO-01
    const cellBtn = screen.getByLabelText(/LO-01 Developing/);
    fireEvent.click(cellBtn);

    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-lo-evidence-panel")).toBeTruthy(),
    );
    // Panel renders LO ref + description + mastery
    expect(screen.getAllByText(/Chain rule/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mastery: 0\.55/)).toBeTruthy();

    // Click again → panel closes
    fireEvent.click(cellBtn);
    await waitFor(() =>
      expect(screen.queryByTestId("hf-snapshot-lo-evidence-panel")).toBeNull(),
    );
  });

  it("renders fetched evidence excerpts in the side panel", async () => {
    vi.stubGlobal("fetch", populatedFetch());

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Chain rule/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/LO-01 Developing/));

    await waitFor(() =>
      expect(screen.getByText(/Applied chain rule correctly/)).toBeTruthy(),
    );
    expect(screen.getByText(/from call-7/)).toBeTruthy();
  });

  it("Escape key closes the side panel", async () => {
    vi.stubGlobal("fetch", populatedFetch());

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Chain rule/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/LO-01 Developing/));
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-lo-evidence-panel")).toBeTruthy(),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("hf-snapshot-lo-evidence-panel")).toBeNull(),
    );
  });

  it("renders 'Evidence not available' note when skills-evidence returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => {
        if (url.includes("/lo-mastery")) {
          return new Response(
            JSON.stringify(
              makeLoMasteryResponse({
                moduleId: "m1",
                moduleSlug: "m1",
                moduleTitle: "M1",
                los: [
                  {
                    ref: "LO-01",
                    description: "x",
                    mastery: 0.5,
                    tier: "developing",
                    status: "in_progress",
                  },
                ],
              }),
            ),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(
      <SnapshotLoHeatmap
        callerId={CALLER_ID}
        modules={[{ id: "m1", slug: "m1", title: "M1" }]}
        useFreshMastery={false}
      />,
    );

    await waitFor(() => expect(screen.getByText(/LO-01/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/LO-01 Developing/));

    await waitFor(() =>
      expect(screen.getByText(/Evidence not available for this LO yet/i)).toBeTruthy(),
    );
  });
});
