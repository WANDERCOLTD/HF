/**
 * Tests for the Snapshot v3 landing tab — #1660 (Epic #1606 Group C
 * foundation).
 *
 * Pinned acceptance:
 *   1. 4 parallel fetches fire on mount (Promise.all, no waterfall) —
 *      verifies cold-load behaviour from #1660 AC.
 *   2. 404 from sub-skills + scheduler-decision degrades to stub renders
 *      (sibling stories not yet merged) — foundation ships ahead.
 *   3. Skill bands render from attainment response.
 *   4. Goals render from attainment response with evidence trail.
 *   5. Heatmap placeholder shows module count.
 *   6. Empty attainment → empty-state badges on every section.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

import { SnapshotTabContent } from "@/components/callers/caller-detail/SnapshotTabContent";

vi.mock("@/components/callers/caller-detail/cards/LearningTrajectoryCard", () => ({
  LearningTrajectoryCard: ({ callerId }: { callerId: string }) => (
    <div data-testid="hf-trajectory-card">trajectory-{callerId}</div>
  ),
}));

const CALLER_ID = "caller-1";

function makeAttainmentResponse() {
  return {
    callerId: CALLER_ID,
    callerName: "Alex",
    playbookId: "pb1",
    playbookName: "Calculus 1",
    useFreshMastery: false,
    skillBands: [
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        parameterName: "Algebra",
        currentScore: 0.62,
        targetValue: 0.7,
        callsUsed: 3,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
      },
    ],
    modules: [
      { id: "m1", slug: "limits", title: "Limits" },
      { id: "m2", slug: "derivatives", title: "Derivatives" },
    ],
    goals: [
      {
        id: "g1",
        type: "LEARN",
        name: "Master limits",
        description: null,
        progress: 0.45,
        trail: {
          excerpts: ["Got the squeeze theorem right"],
          totalCount: 1,
          extractionMethod: "EXPLICIT" as const,
          sourceCallId: "call-7",
        },
      },
    ],
    empty: false,
  };
}

function mockFetch(handlers: Record<string, (url: string) => Response | Promise<Response>>) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    for (const [pattern, h] of Object.entries(handlers)) {
      if (u.includes(pattern)) return h(u);
    }
    return new Response(null, { status: 404 });
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

describe("SnapshotTabContent — cold-load behaviour", () => {
  it("fires parallel fetches on mount (attainment + skills-evidence + sub-skills + scheduler-decision + carry-over actions)", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push(u);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SnapshotTabContent callerId={CALLER_ID} />);

    // 5 parallel fetches: 2 from the foundation (attainment +
    // skills-evidence) + 1 from SnapshotSubSkills (#1662) + 1 from
    // SnapshotCarryOverActions (#1666) + 1 from SnapshotWhyThisCall
    // (#1663 owns its own fetch now). Per-module lo-mastery fetches
    // from SnapshotLoHeatmap (#1661) only fire AFTER attainment lands.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(calls.some((u) => u.includes("/attainment"))).toBe(true);
    expect(calls.some((u) => u.includes("/skills-evidence"))).toBe(true);
    expect(calls.some((u) => u.includes("/sub-skills"))).toBe(true);
    expect(calls.some((u) => u.includes("/scheduler-decision"))).toBe(true);
    expect(calls.some((u) => u.includes("/actions"))).toBe(true);
  });

  it("renders the trajectory card in the header slot", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    expect(screen.getByTestId("hf-trajectory-card").textContent).toContain(CALLER_ID);
  });
});

describe("SnapshotTabContent — slot stubs (sibling stories not yet merged)", () => {
  it("shows personality stub on render (A.7 not merged)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    expect(screen.getByTestId("hf-snapshot-personality-stub")).toBeTruthy();
    expect(screen.getByText(/coming in story A\.7/i)).toBeTruthy();
  });

  it("mounts SnapshotSubSkills component (#1662 shipped — component owns its own fetch + error state)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/sub-skills": () => new Response(null, { status: 404 }),
        "/attainment": () =>
          new Response(JSON.stringify(makeAttainmentResponse()), { status: 200 }),
        "/skills-evidence": () =>
          new Response(JSON.stringify({ callerId: CALLER_ID, evidence: [] }), {
            status: 200,
          }),
        "/scheduler-decision": () => new Response(null, { status: 404 }),
      }),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    // Sub-skills component renders its own section/testid; on 404 it shows
    // the error state.
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-subskills")).toBeTruthy(),
    );
  });

  it("mounts SnapshotWhyThisCall component (#1663 shipped — component owns its own fetch + 404 → no-decision badge)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/scheduler-decision": () => new Response(null, { status: 404 }),
        "/attainment": () =>
          new Response(JSON.stringify(makeAttainmentResponse()), { status: 200 }),
        "/skills-evidence": () =>
          new Response(JSON.stringify({ callerId: CALLER_ID, evidence: [] }), {
            status: 200,
          }),
        "/sub-skills": () => new Response(null, { status: 404 }),
      }),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    // SnapshotWhyThisCall renders its own section/testid; on 404 it
    // shows the "no decision recorded" muted badge (not an error).
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-why-this-call")).toBeTruthy(),
    );
  });

  it("mounts the SnapshotLoHeatmap component once attainment lands (#1661 shipped)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/attainment": () =>
          new Response(JSON.stringify(makeAttainmentResponse()), { status: 200 }),
        "/skills-evidence": () =>
          new Response(JSON.stringify({ callerId: CALLER_ID, evidence: [] }), {
            status: 200,
          }),
        "/sub-skills": () => new Response(null, { status: 404 }),
        "/scheduler-decision": () => new Response(null, { status: 404 }),
        "/lo-mastery": (url: string) => {
          // Echo the moduleId param back so the heatmap renders one sticky
          // header per requested module (not two duplicates of the same one).
          const m = url.match(/moduleId=([^&]+)/);
          const id = m ? decodeURIComponent(m[1]) : "?";
          const slug = id === "m1" ? "limits" : "derivatives";
          const title = id === "m1" ? "Limits" : "Derivatives";
          return new Response(
            JSON.stringify({
              callerId: CALLER_ID,
              playbookId: "pb-1",
              moduleId: id,
              moduleSlug: slug,
              moduleTitle: title,
              useFreshMastery: false,
              scratchSourceCallId: null,
              learningObjectives: [],
            }),
            { status: 200 },
          );
        },
      }),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    // The full wiring (attainment → heatmap → per-module lo-mastery →
    // sticky module headers) only completes once the per-module fetches
    // resolve. Wait on the deepest assertion directly.
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-lo-modhdr-limits")).toBeTruthy(),
    );
    expect(screen.getByTestId("hf-snapshot-lo-modhdr-derivatives")).toBeTruthy();
    expect(screen.getByTestId("hf-snapshot-lo-heatmap")).toBeTruthy();
  });

  it("mounts the SnapshotCarryOverActions component (#1666 shipped)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    // Component renders its own loading/error states via the
    // hf-snapshot-carryover-actions testid; the stub testid is retired.
    expect(screen.getByTestId("hf-snapshot-carryover-actions")).toBeTruthy();
  });
});

describe("SnapshotTabContent — populated state from /attainment", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/attainment": () =>
          new Response(JSON.stringify(makeAttainmentResponse()), { status: 200 }),
        "/skills-evidence": () =>
          new Response(JSON.stringify({ callerId: CALLER_ID, evidence: [] }), {
            status: 200,
          }),
        "/sub-skills": () => new Response(null, { status: 404 }),
        "/scheduler-decision": () => new Response(null, { status: 404 }),
      }),
    );
  });

  it("renders skill bands with parameter name + tier", async () => {
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Algebra/)).toBeTruthy());
    expect(screen.getByText(/developing/)).toBeTruthy();
  });

  it("renders goals with type, name, progress %, evidence excerpt", async () => {
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Master limits/)).toBeTruthy());
    expect(screen.getByText(/45%/)).toBeTruthy();
    expect(screen.getByText(/squeeze theorem/i)).toBeTruthy();
    expect(screen.getByText(/EXPLICIT/)).toBeTruthy();
  });

  it("hands attainment.modules to the SnapshotLoHeatmap which renders one sticky header per module", async () => {
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    // The populated-state /attainment fixture above carries two modules
    // (m1=Limits, m2=Derivatives). SnapshotLoHeatmap should render a
    // sticky module header for each.
    await waitFor(() =>
      expect(screen.getByTestId("hf-snapshot-lo-modhdr-limits")).toBeTruthy(),
    );
    expect(screen.getByTestId("hf-snapshot-lo-modhdr-derivatives")).toBeTruthy();
  });
});

describe("SnapshotTabContent — empty attainment response", () => {
  it("shows empty-state badges when attainment returns no skills + no goals + no modules", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/attainment": () =>
          new Response(
            JSON.stringify({
              callerId: CALLER_ID,
              callerName: null,
              playbookId: null,
              playbookName: null,
              useFreshMastery: false,
              skillBands: [],
              modules: [],
              goals: [],
              empty: true,
            }),
            { status: 200 },
          ),
        "/skills-evidence": () =>
          new Response(JSON.stringify({ callerId: CALLER_ID, evidence: [] }), {
            status: 200,
          }),
        "/sub-skills": () => new Response(null, { status: 404 }),
        "/scheduler-decision": () => new Response(null, { status: 404 }),
      }),
    );
    render(<SnapshotTabContent callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/No skills tracked yet/i)).toBeTruthy());
    expect(screen.getByText(/No active goals/i)).toBeTruthy();
    expect(screen.getByText(/No modules in curriculum yet/i)).toBeTruthy();
  });
});
