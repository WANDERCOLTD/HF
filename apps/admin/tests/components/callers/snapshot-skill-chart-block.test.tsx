/**
 * Tests for SnapshotSkillChartBlock — Wave C2 of the legacy-tab
 * retirement plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotSkillChartBlock } from "@/components/callers/caller-detail/SnapshotSkillChartBlock";

const CALLER_ID = "caller-c2-skill";

function upliftWithSkills() {
  return new Response(
    JSON.stringify({
      ok: true,
      uplift: {
        confidencePre: null,
        confidencePost: null,
        confidenceDelta: null,
        testScorePre: null,
        testScorePost: null,
        knowledgeDelta: null,
        overallMastery: 0.5,
        totalCalls: 5,
        firstCallAt: "2026-06-01T00:00:00Z",
        latestCallAt: "2026-06-14T00:00:00Z",
        callDates: [],
        timeOnPlatformDays: 14,
        callFrequencyPerWeek: 2.5,
        scoreTrends: [
          {
            parameterId: "skill_a",
            parameterName: "Skill A",
            parameterType: "skill",
            sectionId: null,
            definition: null,
            scores: [
              { callDate: "2026-06-14T00:00:00Z", score: 0.6, confidence: 0.9 },
            ],
          },
        ],
        adaptationEvidence: [],
        moduleProgress: [],
        goals: [],
        memoryCounts: { facts: 0, preferences: 0, events: 0, topics: 0, total: 0 },
        topTopics: [],
      },
    }),
    { status: 200 },
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

describe("SnapshotSkillChartBlock", () => {
  it("renders Skill chart heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithSkills()));
    render(<SnapshotSkillChartBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Skill chart")).toBeTruthy();
    });
  });

  it("shows Radar empty state when fewer than 3 skills are tracked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithSkills()));
    render(<SnapshotSkillChartBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Radar appears once 3\+ skills have scores/),
      ).toBeTruthy();
    });
  });

  it("carries the hf-snapshot-skill-chart data-testid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upliftWithSkills()));
    const { container } = render(<SnapshotSkillChartBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="hf-snapshot-skill-chart"]'),
      ).toBeTruthy();
    });
  });
});
