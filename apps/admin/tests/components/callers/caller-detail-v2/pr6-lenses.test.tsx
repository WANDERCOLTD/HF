/**
 * PR 6 — Parameters / Adaptation / Modules lenses.
 *
 * The Adaptation + Modules lenses are thin wrappers over their Uplift v2
 * counterparts; they get a single smoke check. Parameters lens has its
 * own band-isation logic so it gets a focused test.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { ParametersLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/ParametersLens";
import { AdaptationLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/AdaptationLens";
import { ModulesLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/ModulesLens";
import {
  LENSES,
} from "@/components/callers/caller-detail/caller-detail-v2/lenses/registry";

import type { UpliftData } from "@/components/callers/caller-detail/types";

function basePayload(): UpliftData {
  return {
    confidencePre: null,
    confidencePost: null,
    confidenceDelta: null,
    testScorePre: null,
    testScorePost: null,
    knowledgeDelta: null,
    overallMastery: 0,
    totalCalls: 0,
    firstCallAt: null,
    latestCallAt: null,
    timeOnPlatformDays: 0,
    moduleProgress: [],
    goals: [],
    scoreTrends: [],
    adaptationEvidence: [],
    memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
    callFrequencyPerWeek: 0,
  };
}

function mockFetch(payload: Partial<UpliftData>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        json: async () => ({ ok: true, uplift: { ...basePayload(), ...payload } }),
      } as unknown as Response),
    ),
  );
}

describe("ParametersLens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups score trends into bands by parameterType", async () => {
    mockFetch({
      scoreTrends: [
        {
          parameterId: "skill_pronounce",
          parameterName: "Pronunciation",
          parameterType: "STATE",
          sectionId: "EVIDENCE",
          scores: [{ callDate: "2026-05-20", score: 0.4, confidence: 1 }],
        },
        {
          parameterId: "skill_gram",
          parameterName: "Grammar",
          parameterType: "STATE",
          scores: [{ callDate: "2026-05-20", score: 0.5, confidence: 1 }],
        },
        {
          parameterId: "beh_chatty",
          parameterName: "Chatty",
          parameterType: "BEHAVIOR",
          scores: [{ callDate: "2026-05-20", score: 0.8, confidence: 1 }],
        },
        {
          parameterId: "unknown",
          parameterName: "Mystery",
          parameterType: null,
          scores: [{ callDate: "2026-05-20", score: 0.5, confidence: 1 }],
        },
      ],
    });
    const { container } = render(<ParametersLens callerId="c1" />);
    await waitFor(() => {
      const bands = container.querySelectorAll(".hf-eq-mixer-band");
      expect(bands.length).toBeGreaterThanOrEqual(3);
    });
    expect(container.textContent).toContain("Behaviour");
    expect(container.textContent).toContain("State");
    expect(container.textContent).toContain("Other");
  });

  it("renders the EQ-mixer empty state when no scored params", async () => {
    mockFetch({ scoreTrends: [] });
    const { container } = render(<ParametersLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-eq-mixer-empty")).not.toBeNull();
    });
  });
});

describe("AdaptationLens (wrapper)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the Uplift v2 AdaptationSection underneath", async () => {
    mockFetch({
      adaptationEvidence: [
        {
          parameterName: "BEH_TEST",
          parameterType: "BEHAVIOR",
          defaultValue: 0.5,
          currentValue: 0.85,
          delta: 0.35,
          callsUsed: 5,
          confidence: 0.9,
        },
      ],
    });
    const { container } = render(<AdaptationLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-uplift-v2-adaptation")).not.toBeNull();
    });
  });
});

describe("ModulesLens (wrapper)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the Uplift v2 ModulesSection heatmap underneath", async () => {
    mockFetch({
      moduleProgress: [
        {
          moduleId: "m1",
          slug: "p1",
          title: "Part 1",
          sortOrder: 1,
          mastery: 0.5,
          status: "ACTIVE",
          callCount: 3,
        },
      ],
    });
    const { container } = render(<ModulesLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-uplift-v2-modules")).not.toBeNull();
    });
  });
});

describe("LENSES registry (after PR 6)", () => {
  it("Parameters / Adaptation / Modules all have a Component", () => {
    expect(LENSES.parameters.Component).toBeDefined();
    expect(LENSES.adaptation.Component).toBeDefined();
    expect(LENSES.modules.Component).toBeDefined();
  });
});
