/**
 * Overview v2 — smoke + composition tests for the buffed Overview tab.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { AtAGlanceV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/AtAGlanceV2";
import { MockResultV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/MockResultV2";
import { FocusV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/FocusV2";
import { WhoTheyAreV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/WhoTheyAreV2";
import { RecentCallsV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/RecentCallsV2";
import { AchievementsV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/AchievementsV2";
import { TrustFooterV2 } from "@/components/callers/caller-detail/caller-detail-v2/overview/TrustFooterV2";

import type { CallerInsights } from "@/components/callers/caller-detail/hooks/useCallerInsights";

function baseInsights(): CallerInsights {
  return {
    goals: { items: [], overallProgress: 0, count: 3 },
    courses: { modules: [], totalModules: 10, completedModules: 4, overallMastery: 0.62 },
    learnings: { totalLOs: 0, masteredLOs: 0, recentlyMastered: [], inProgress: [] },
    targets: [],
    focusAreas: [],
    achievements: [],
    momentum: "steady",
    callStreak: 4,
    lastCallDaysAgo: 1,
    totalCalls: 14,
    topMemories: [],
    personalityTraits: [],
  };
}

describe("AtAGlanceV2", () => {
  it("renders mastery donut + 4 stat tiles when streak > 0", () => {
    const { container } = render(<AtAGlanceV2 insights={baseInsights()} />);
    expect(container.querySelector(".hf-overview-v2-glance-donut")).not.toBeNull();
    // 4 tiles when callStreak > 0 (Momentum / Last / Total / Streak)
    expect(container.querySelectorAll(".hf-stat-tile").length).toBe(4);
    expect(container.textContent).toContain("62%");
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it("hides streak tile when callStreak === 0", () => {
    const i = baseInsights();
    i.callStreak = 0;
    const { container } = render(<AtAGlanceV2 insights={i} />);
    expect(container.querySelectorAll(".hf-stat-tile").length).toBe(3);
  });
});

describe("MockResultV2", () => {
  it("self-hides when no mock calls", () => {
    const { container } = render(
      <MockResultV2
        calls={[{ id: "c1", source: "live", createdAt: new Date().toISOString() }]}
        scores={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders latest mock + delta when 2+ mocks exist", () => {
    const old = new Date("2026-04-01").toISOString();
    const recent = new Date("2026-05-01").toISOString();
    const { container } = render(
      <MockResultV2
        calls={[
          { id: "c1", source: "mock", createdAt: old },
          { id: "c2", source: "mock", createdAt: recent },
        ]}
        scores={[
          { callId: "c1", parameterId: "skill_a", score: 0.5 },
          { callId: "c2", parameterId: "skill_a", score: 0.7 },
        ]}
      />,
    );
    expect(container.querySelector(".hf-overview-v2-mock")).not.toBeNull();
    expect(container.textContent).toContain("70%");
    expect(container.querySelector(".hf-delta-pill")).not.toBeNull();
  });
});

describe("FocusV2", () => {
  it("splits attention vs advance into separate groups", () => {
    const { container } = render(
      <FocusV2
        focusAreas={[
          {
            type: "needs_attention",
            moduleName: "Part 2",
            mastery: 0.3,
            reason: "low",
            recommendation: "More practice.",
          },
          {
            type: "ready_to_advance",
            moduleName: "Part 1",
            mastery: 0.85,
            reason: "high",
            recommendation: "Move on.",
          },
        ]}
      />,
    );
    expect(container.querySelector(".hf-overview-v2-focus-group--attention")).not.toBeNull();
    expect(container.querySelector(".hf-overview-v2-focus-group--advance")).not.toBeNull();
    expect(container.querySelectorAll(".hf-overview-v2-focus-card").length).toBe(2);
  });

  it("self-hides when no focus areas", () => {
    const { container } = render(<FocusV2 focusAreas={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("WhoTheyAreV2", () => {
  it("renders 3 personality tiles + memory list + link", () => {
    const onView = vi.fn();
    const i = baseInsights();
    i.personalityTraits = [
      { label: "Openness", value: 0.8 },
      { label: "Conscientiousness", value: 0.4 },
      { label: "Extraversion", value: 0.2 },
      { label: "Agreeableness", value: 0.6 }, // exceeds 3 cap
    ];
    i.topMemories = [
      { key: "wants", value: "Band 7" },
      { key: "lives", value: "Manila" },
      { key: "extra", value: "should be hidden" },
    ];
    const { container, getByText } = render(
      <WhoTheyAreV2 insights={i} paramConfig={{ grouped: {}, params: {} } as never} onViewProfile={onView} />,
    );
    expect(container.querySelectorAll(".hf-stat-tile").length).toBe(3);
    expect(container.querySelectorAll(".hf-overview-v2-who-memory").length).toBe(2);
    getByText(/View full profile/i).click();
    expect(onView).toHaveBeenCalled();
  });

  it("self-hides with no traits + no memories", () => {
    const { container } = render(
      <WhoTheyAreV2 insights={baseInsights()} paramConfig={{ grouped: {}, params: {} } as never} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("RecentCallsV2", () => {
  it("renders TimelineRibbon of up to 5 most recent calls", () => {
    const onClick = vi.fn();
    const onAll = vi.fn();
    const calls = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      createdAt: new Date(Date.now() - i * 86400_000).toISOString(),
      source: "live",
    }));
    const { container, getByText } = render(
      <RecentCallsV2 calls={calls} onCallClick={onClick} onViewAll={onAll} />,
    );
    expect(container.querySelectorAll(".hf-timeline-node").length).toBe(5);
    expect(container.querySelectorAll(".hf-timeline-node--current").length).toBe(1);
    getByText(/View all/i).click();
    expect(onAll).toHaveBeenCalled();
  });

  it("self-hides when no calls", () => {
    const { container } = render(<RecentCallsV2 calls={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("AchievementsV2", () => {
  it("renders one card per achievement", () => {
    const { container } = render(
      <AchievementsV2
        achievements={[
          { icon: "🏆", label: "First call", value: "" },
          { icon: "🔥", label: "Hot streak", value: "5 days" },
        ]}
      />,
    );
    expect(container.querySelectorAll(".hf-overview-v2-ach-card").length).toBe(2);
  });

  it("self-hides when no achievements", () => {
    const { container } = render(<AchievementsV2 achievements={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("TrustFooterV2", () => {
  it("self-hides when no scores carry hasLearnerEvidence", () => {
    const { container } = render(
      <TrustFooterV2
        calls={[{ id: "c1", createdAt: new Date().toISOString() }]}
        scores={[{ callId: "c1", score: 0.5 }]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders evidence-backed + dropped counts + sparkline when 2+ calls have data", () => {
    const calls = [
      { id: "c1", createdAt: "2026-05-01T00:00:00Z" },
      { id: "c2", createdAt: "2026-05-02T00:00:00Z" },
    ];
    const { container } = render(
      <TrustFooterV2
        calls={calls}
        scores={[
          { callId: "c1", score: 0.5, hasLearnerEvidence: true },
          { callId: "c1", score: 0.6, hasLearnerEvidence: false },
          { callId: "c2", score: 0.7, hasLearnerEvidence: true },
          { callId: "c2", score: 0.8, hasLearnerEvidence: true },
        ]}
      />,
    );
    expect(container.querySelector(".hf-overview-v2-trust")).not.toBeNull();
    expect(container.querySelector(".hf-sparkline-card")).not.toBeNull();
  });
});
