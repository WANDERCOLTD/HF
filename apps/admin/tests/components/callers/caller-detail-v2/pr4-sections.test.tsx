/**
 * PR 4 — SkillChartSection (radar gate) + TopicsSection + Engagement
 * calendar-streak append, all driven by the widened /uplift response.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

// #1664 — PersonalityRadar now calls useSession to gate interpretation
// tooltips. Default to a STUDENT session (no interpretation text) so
// these radar smoke tests don't depend on operator UI surface.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "STUDENT" } } }),
}));

import { SkillChartSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/SkillChartSection";
import { TopicsSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/TopicsSection";
import { EngagementSection } from "@/components/callers/caller-detail/caller-detail-v2/sections/EngagementSection";
import {
  UPLIFT_SECTIONS,
} from "@/components/callers/caller-detail/caller-detail-v2/sections/registry";

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
    callDates: [],
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

describe("SkillChartSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the radar empty hint when <3 skill_* parameters have scores", async () => {
    mockFetch({
      scoreTrends: [
        {
          parameterId: "skill_pronounce",
          parameterName: "Pronunciation",
          scores: [
            { callDate: "2026-05-20", score: 0.6, confidence: 1 },
            { callDate: "2026-05-21", score: 0.7, confidence: 1 },
          ],
        },
        {
          parameterId: "non_skill_thing",
          parameterName: "Other",
          scores: [{ callDate: "2026-05-20", score: 0.5, confidence: 1 }],
        },
      ],
    });
    const { container } = render(
      <SkillChartSection callerId="c1" scores={[]} callerTargets={[]} />,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Skill chart");
    });
    expect(container.textContent).toContain("Radar appears once 3+");
  });

  it("renders the radar when ≥3 skills have averaged scores", async () => {
    mockFetch({
      scoreTrends: [
        {
          parameterId: "skill_pronounce",
          parameterName: "Pronunciation",
          scores: [{ callDate: "2026-05-20", score: 0.6, confidence: 1 }],
        },
        {
          parameterId: "skill_grammar",
          parameterName: "Grammar",
          scores: [{ callDate: "2026-05-20", score: 0.7, confidence: 1 }],
        },
        {
          parameterId: "skill_vocab",
          parameterName: "Vocabulary",
          scores: [{ callDate: "2026-05-20", score: 0.5, confidence: 1 }],
        },
      ],
    });
    const { container } = render(
      <SkillChartSection callerId="c1" scores={[]} callerTargets={[]} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".hf-uplift-v2-skill-chart-radar svg"),
      ).not.toBeNull();
    });
  });
});

describe("TopicsSection", () => {
  it("renders one chip per top topic + last-mentioned tooltip body", () => {
    const { container } = render(
      <TopicsSection
        memorySummary={{
          topTopics: [
            { topic: "Travel", lastMentioned: new Date().toISOString() },
            {
              topic: "Family",
              lastMentioned: new Date(Date.now() - 8 * 86400_000).toISOString(),
            },
          ],
          topicCount: 2,
        }}
      />,
    );
    const chips = container.querySelectorAll(".hf-topic-chip");
    expect(chips.length).toBe(2);
    expect(container.textContent).toContain("Travel");
    expect(container.textContent).toContain("Family");
  });

  it("renders empty cloud when no topics passed in", () => {
    const { container } = render(<TopicsSection memorySummary={null} />);
    expect(container.querySelector(".hf-topic-cloud-empty")).not.toBeNull();
  });
});

describe("EngagementSection — calendar streak", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders 14 dots; active ones reflect callDates", async () => {
    const today = new Date().toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    mockFetch({ callDates: [twoDaysAgo, today] });
    const { container } = render(<EngagementSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".hf-calendar-dot").length).toBe(14);
    });
    // Exactly 2 of those dots should be active (today + 2 days ago).
    expect(container.querySelectorAll(".hf-calendar-dot--active").length).toBe(2);
  });

  it("renders 14 empty dots when callDates absent", async () => {
    mockFetch({ callDates: [] });
    const { container } = render(<EngagementSection callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".hf-calendar-dot").length).toBe(14);
    });
    expect(container.querySelectorAll(".hf-calendar-dot--active").length).toBe(0);
  });
});

describe("UPLIFT_SECTIONS (after PR 4)", () => {
  it("registers skill-chart + topics alongside the prior sections", () => {
    expect(UPLIFT_SECTIONS["skill-chart"]).toBeDefined();
    expect(UPLIFT_SECTIONS.topics).toBeDefined();
    // Sanity: all 8 sections wired
    const ids = Object.keys(UPLIFT_SECTIONS);
    expect(ids).toContain("hero");
    expect(ids).toContain("skill-chart");
    expect(ids).toContain("modules");
    expect(ids).toContain("goals");
    expect(ids).toContain("score-trends");
    expect(ids).toContain("adaptation");
    expect(ids).toContain("topics");
    expect(ids).toContain("engagement");
  });
});
