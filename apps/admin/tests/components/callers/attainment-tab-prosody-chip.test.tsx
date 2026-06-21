/**
 * #2140 (S5 of #2135) — AttainmentTab prosody-enhancement chip.
 *
 * Pins the SkillBandsSection chip behaviour: when the
 * `/api/callers/[id]/attainment` response carries
 * `prosodyContributed: true` on a skill band, a small "+ prosody" chip
 * renders next to the parameter name; when false (or absent for
 * backwards-compat with pre-#2140 payloads), no chip renders. Pure UI
 * observability — no logic / scoring change.
 *
 * Sister of `attainment-tab-segment-matrix.test.tsx` (#1887 Slice 1).
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

const CALLER_ID = "caller-prosody-1";

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
        parameterId: "skill_fluency_and_coherence_fc",
        parameterName: "Fluency & Coherence",
        currentScore: 0.6,
        targetValue: 0.7,
        callsUsed: 4,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
        prosodyContributed: true,
      },
      {
        skillRef: "SKILL-LR",
        parameterId: "skill_lexical_resource_lr",
        parameterName: "Lexical Resource",
        currentScore: 0.55,
        targetValue: 0.7,
        callsUsed: 4,
        tier: "developing",
        bandLabel: 2,
        exceedsTarget: false,
        prosodyContributed: false,
      },
    ],
    modules: [],
    goals: [],
    recentCallTalkTime: null,
    profile: [],
    empty: false,
  };
}

beforeEach(() => {
  global.fetch = vi.fn((url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes("/attainment")) {
      return Promise.resolve({
        ok: true,
        json: async () => makeAttainmentResponse(),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ callerId: CALLER_ID, rows: [] }),
    } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AttainmentTab — #2140 prosody enhancement chip", () => {
  it("renders the '+ prosody' chip on bands where prosodyContributed is true", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Fluency & Coherence")).toBeInTheDocument();
    });
    const chip = screen.getByTestId("hf-skill-band-prosody-chip-SKILL-FLU");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("+ prosody");
  });

  it("omits the chip on bands where prosodyContributed is false", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Lexical Resource")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("hf-skill-band-prosody-chip-SKILL-LR"),
    ).not.toBeInTheDocument();
  });

  it("carries an accessible tooltip on the chip explaining the augmentation", async () => {
    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Fluency & Coherence")).toBeInTheDocument();
    });
    const chip = screen.getByTestId("hf-skill-band-prosody-chip-SKILL-FLU");
    expect(chip.getAttribute("title")).toBe(
      "Vendor audio analysis contributed to this score",
    );
  });

  it("treats missing prosodyContributed (pre-#2140 payload) as no chip", async () => {
    // Override the mock with a payload that lacks the field entirely
    // (the field is optional client-side for forward-compat).
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          callerId: CALLER_ID,
          callerName: "Sam",
          playbookId: "pb-x",
          playbookName: "Course",
          useFreshMastery: false,
          skillBands: [
            {
              skillRef: "SKILL-X",
              parameterId: "skill_x",
              parameterName: "Skill X",
              currentScore: 0.5,
              targetValue: 0.7,
              callsUsed: 1,
              tier: "developing",
              bandLabel: 2,
              exceedsTarget: false,
              // prosodyContributed intentionally absent
            },
          ],
          modules: [],
          goals: [],
          recentCallTalkTime: null,
          profile: [],
          empty: false,
        }),
      } as Response),
    ) as unknown as typeof fetch;

    render(<AttainmentTab callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Skill X")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("hf-skill-band-prosody-chip-SKILL-X"),
    ).not.toBeInTheDocument();
  });
});
