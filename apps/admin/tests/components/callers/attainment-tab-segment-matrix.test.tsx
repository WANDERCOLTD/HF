/**
 * #1887 Slice 1 — AttainmentTab per-segment matrix.
 *
 * Pins the criterion × segment expansion behaviour: clicking a skill row
 * fetches `/api/callers/[id]/skills-evidence`, the response's `segments[]`
 * lands in a matrix beneath the per-call evidence list, each cell carries
 * a provenance chip + tooltip, and empty `segments[]` shows the evidence
 * list with no matrix (so a continuous course doesn't render a confusing
 * empty grid).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";

import { AttainmentTab } from "@/components/callers/caller-detail/AttainmentTab";

const CALLER_ID = "caller-segments-1";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

function makeAttainmentResponse() {
  return {
    callerId: CALLER_ID,
    callerName: "Sam",
    playbookId: "pb-ielts",
    playbookName: "IELTS Speaking",
    useFreshMastery: false,
    skillBands: [
      {
        skillRef: "SKILL-FLU",
        parameterId: "p-flu",
        parameterName: "Fluency & Coherence",
        currentScore: 0.6,
        targetValue: 0.7,
        callsUsed: 4,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
      },
      {
        skillRef: "SKILL-PRO",
        parameterId: "p-pro",
        parameterName: "Pronunciation",
        currentScore: 0.5,
        targetValue: 0.7,
        callsUsed: 2,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
      },
    ],
    modules: [],
    goals: [],
    profile: [],
    empty: false,
  };
}

function makeEvidenceResponse() {
  return {
    callerId: CALLER_ID,
    rows: [
      {
        skillRef: "SKILL-FLU",
        parameterId: "p-flu",
        parameterName: "Fluency & Coherence",
        evidence: [
          {
            callId: "call-1",
            measuredAt: "2026-06-17T10:00:00Z",
            score: 0.6,
            confidence: 0.8,
            excerpts: ["I was thinking about it"],
          },
        ],
        segments: [
          {
            segmentKey: null,
            namespace: "overall",
            label: "Overall",
            band: 0.6,
            callId: "call-1",
            measuredAt: "2026-06-17T10:00:00Z",
            durationSeconds: null,
          },
          {
            segmentKey: "phase:p1",
            namespace: "phase",
            label: "Part 1",
            band: 0.65,
            callId: "call-1",
            measuredAt: "2026-06-17T10:00:00Z",
            durationSeconds: 45,
          },
          {
            segmentKey: "phase:p2_monologue",
            namespace: "phase",
            label: "Part 2 (monologue)",
            band: 0.55,
            callId: "call-1",
            measuredAt: "2026-06-17T10:00:00Z",
            durationSeconds: 90,
          },
          {
            segmentKey: "text:part3",
            namespace: "text",
            label: "Part 3",
            band: 0.7,
            callId: "call-1",
            measuredAt: "2026-06-17T10:00:00Z",
            durationSeconds: null,
          },
        ],
      },
      {
        skillRef: "SKILL-PRO",
        parameterId: "p-pro",
        parameterName: "Pronunciation",
        evidence: [
          {
            callId: "call-2",
            measuredAt: "2026-06-15T09:00:00Z",
            score: 0.5,
            confidence: 0.7,
            excerpts: ["I said /th/ as /d/"],
          },
        ],
        segments: [], // No segmented scoring for this skill yet
      },
    ],
  };
}

beforeEach(() => {
  global.fetch = vi.fn((url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes("/skills-evidence")) {
      return Promise.resolve({
        ok: true,
        json: async () => makeEvidenceResponse(),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => makeAttainmentResponse(),
    } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AttainmentTab — #1887 Slice 1 segment matrix", () => {
  it("renders the criterion × segment matrix with provenance chips on expand", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Fluency & Coherence")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Fluency & Coherence"));

    // Wait for the matrix to mount.
    await waitFor(() => {
      expect(
        screen.getByTestId("hf-attainment-segment-matrix"),
      ).toBeInTheDocument();
    });

    // 4 cells (Overall + 3 Parts) — scoped to the matrix listbox so
    // sibling evidence excerpt `<li>`s aren't counted.
    const matrix = screen.getByTestId("hf-attainment-segment-matrix");
    const cells = matrix.querySelectorAll('[role="listitem"]');
    expect(cells.length).toBe(4);

    // Cell labels are visible.
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("Part 1")).toBeInTheDocument();
    expect(screen.getByText("Part 2 (monologue)")).toBeInTheDocument();
    expect(screen.getByText("Part 3")).toBeInTheDocument();

    // Provenance chips — multiple "audio" chips (Part 1 + Part 2),
    // one "text" chip (Part 3), one "overall".
    const audioChips = screen.getAllByText("audio");
    expect(audioChips.length).toBe(2);
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("overall")).toBeInTheDocument();
  });

  it("includes the duration-aware tooltip for audio-derived cells", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Fluency & Coherence")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fluency & Coherence"));
    await waitFor(() => {
      expect(
        screen.getByTestId("hf-attainment-segment-matrix"),
      ).toBeInTheDocument();
    });

    // Part 2 monologue carries duration in its title attribute.
    const cell = screen.getByTestId("hf-attainment-segment-cell-part-2-(monologue)");
    expect(cell.getAttribute("title")).toContain("Audio-derived");
    expect(cell.getAttribute("title")).toContain("90s");
  });

  it("hides the matrix when the skill has no segmented scoring history", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Pronunciation")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pronunciation"));
    // Wait until the evidence list mounts so we know the toggle landed.
    await waitFor(() => {
      expect(screen.getByText(/I said \/th\/ as \/d\//)).toBeInTheDocument();
    });

    // Empty segments[] → no matrix.
    expect(
      screen.queryByTestId("hf-attainment-segment-matrix"),
    ).not.toBeInTheDocument();
  });

  it("renders the band value in IELTS-band form (0..10 with one decimal)", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Fluency & Coherence")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fluency & Coherence"));
    await waitFor(() => {
      expect(
        screen.getByTestId("hf-attainment-segment-matrix"),
      ).toBeInTheDocument();
    });

    // band 0.65 → "6.5"; 0.55 → "5.5"; 0.7 → "7.0"; 0.6 → "6.0".
    const matrix = screen.getByTestId("hf-attainment-segment-matrix");
    expect(matrix.textContent).toContain("6.5");
    expect(matrix.textContent).toContain("5.5");
    expect(matrix.textContent).toContain("7.0");
    expect(matrix.textContent).toContain("6.0");
  });
});
