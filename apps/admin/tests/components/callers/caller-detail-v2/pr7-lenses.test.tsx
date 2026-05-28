/**
 * PR 7 — Goals / Topics / Exam lenses.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { GoalsLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/GoalsLens";
import { TopicsLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/TopicsLens";
import { ExamLens } from "@/components/callers/caller-detail/caller-detail-v2/lenses/ExamLens";
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

describe("GoalsLens (wrapper)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the Uplift v2 Goals section", async () => {
    mockFetch({});
    const { container } = render(<GoalsLens callerId="c1" />);
    await waitFor(() => {
      expect(container.querySelector(".hf-uplift-v2-goals")).not.toBeNull();
    });
  });
});

describe("TopicsLens (wrapper)", () => {
  it("renders chips from memorySummary", () => {
    const { container } = render(
      <TopicsLens
        memorySummary={{
          topTopics: [
            { topic: "Travel", lastMentioned: new Date().toISOString() },
            { topic: "Family", lastMentioned: new Date().toISOString() },
          ],
        }}
      />,
    );
    expect(container.querySelectorAll(".hf-topic-chip").length).toBe(2);
  });

  it("renders empty cloud when memorySummary is null", () => {
    const { container } = render(<TopicsLens memorySummary={null} />);
    expect(container.querySelector(".hf-topic-cloud-empty")).not.toBeNull();
  });
});

describe("ExamLens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders BUILDING label below threshold + heatmap of all modules", async () => {
    mockFetch({
      overallMastery: 0.5,
      moduleProgress: [
        { moduleId: "m1", slug: "p1", title: "Part 1", sortOrder: 1, mastery: 0.4, status: "ACTIVE", callCount: 2 },
        { moduleId: "m2", slug: "p2", title: "Part 2", sortOrder: 2, mastery: 0.5, status: "ACTIVE", callCount: 4 },
        { moduleId: "m3", slug: "p3", title: "Part 3", sortOrder: 3, mastery: 0.6, status: "ACTIVE", callCount: 3 },
      ],
    });
    const { container } = render(<ExamLens callerId="c1" />);
    await waitFor(() => {
      expect(container.textContent).toContain("BUILDING");
    });
    expect(container.querySelectorAll(".hf-heatmap-cell").length).toBe(3);
  });

  it("renders READY label when overall mastery ≥ threshold", async () => {
    mockFetch({
      overallMastery: 0.85,
      moduleProgress: [
        { moduleId: "m1", slug: "p1", title: "Part 1", sortOrder: 1, mastery: 0.9, status: "COMPLETED", callCount: 5 },
        { moduleId: "m2", slug: "p2", title: "Part 2", sortOrder: 2, mastery: 0.85, status: "COMPLETED", callCount: 4 },
      ],
    });
    const { container } = render(<ExamLens callerId="c1" />);
    await waitFor(() => {
      expect(container.textContent).toContain("READY");
    });
    // No weak modules → radar empty hint instead
    expect(container.querySelector(".hf-progress-v2-exam-radar-empty")).not.toBeNull();
  });
});

describe("LENSES registry (after PR 7)", () => {
  it("Goals + Topics + Exam are wired", () => {
    expect(LENSES.goals.Component).toBeDefined();
    expect(LENSES.topics.Component).toBeDefined();
    expect(LENSES.exam.Component).toBeDefined();
  });
});
