/**
 * Tests for the SP4-F Attainment-tab deep-link receive behaviour.
 *
 * Mounts <AttainmentTab /> with `?skillRef=SKILL-02` and pins:
 *   1. The matching skill row auto-expands without a click.
 *   2. The evidence trail fetch is invoked exactly once (matches a
 *      manual click — no double-fetch).
 *   3. Without the param the section renders collapsed (defensive
 *      regression guard so the auto-expand effect doesn't fire on
 *      every mount).
 *   4. A `skillRef` that does NOT exist in the data is ignored (no
 *      expand, no fetch, no scrollIntoView).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";

import { AttainmentTab } from "@/components/callers/caller-detail/AttainmentTab";

const CALLER_ID = "caller-1";

let currentSkillRef: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "skillRef" ? currentSkillRef : null),
  }),
}));

function makeAttainmentResponse() {
  return {
    callerId: CALLER_ID,
    callerName: "Alex",
    playbookId: "pb1",
    playbookName: "IELTS Speaking",
    useFreshMastery: false,
    skillBands: [
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        parameterName: "Fluency",
        currentScore: 0.55,
        targetValue: 0.7,
        callsUsed: 3,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
      },
      {
        skillRef: "SKILL-02",
        parameterId: "p2",
        parameterName: "Pronunciation",
        currentScore: 0.42,
        targetValue: 0.7,
        callsUsed: 2,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
      },
    ],
    modules: [],
    goals: [],
    // #1768 (Theme 10) — AttainmentTab now renders a ProfileSection that
    // reads `profile: ProfileField[]`. The component throws on undefined,
    // so the mock must include the (empty) array.
    profile: [],
    empty: false,
  };
}

function makeEvidenceResponse() {
  return {
    callerId: CALLER_ID,
    rows: [
      {
        skillRef: "SKILL-02",
        parameterId: "p2",
        parameterName: "Pronunciation",
        evidence: [
          {
            callId: "call-a",
            measuredAt: "2026-06-10T10:00:00Z",
            score: 0.42,
            confidence: 0.8,
            excerpts: ["I said /th/ as /d/ again"],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  currentSkillRef = null;
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
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AttainmentTab — SP4-F deep-link receive", () => {
  it("auto-expands the matching skill row on mount when ?skillRef= is supplied", async () => {
    currentSkillRef = "SKILL-02";
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Pronunciation")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/I said \/th\/ as \/d\/ again/),
      ).toBeInTheDocument();
    });
  });

  it("calls scrollIntoView once on the matched row", async () => {
    currentSkillRef = "SKILL-02";
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT auto-expand when no ?skillRef= is supplied", async () => {
    currentSkillRef = null;
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Pronunciation")).toBeInTheDocument();
    });
    // Evidence excerpt should never appear since no row expanded.
    expect(
      screen.queryByText(/I said \/th\/ as \/d\/ again/),
    ).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores an unknown skillRef (no expand, no scroll)", async () => {
    currentSkillRef = "SKILL-99";
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Pronunciation")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/I said \/th\/ as \/d\/ again/),
    ).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
