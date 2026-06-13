/**
 * Tests for the Cohort Heatmap cell-drill panel (SP2-D-followon).
 *
 * Renders `<CourseSkillsTab>`, switches to the Cohort Heatmap lens, clicks
 * a cell, and pins:
 *   1. The drill panel mounts beneath the row and fetches
 *      /api/courses/[id]/skills-cohort-cell with the correct query.
 *   2. Each returned learner renders with their last evidence excerpt.
 *   3. The close button dismisses the panel; clicking the same cell
 *      again toggles it off.
 *   4. Empty bucket → friendly "No learners in this tier yet" copy.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";

import { CourseSkillsTab } from "@/app/x/courses/[courseId]/CourseSkillsTab";

const COURSE_ID = "course-cc";

function makeFrameworkResponse() {
  return {
    courseId: COURSE_ID,
    playbookStatus: "ACTIVE",
    empty: false,
    skills: [
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        parameterName: "Speaking",
        description: null,
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
        tiers: {},
        bandThresholds: null,
      },
    ],
  };
}

function makeHeatmapResponse() {
  return {
    courseId: COURSE_ID,
    totalLearners: 5,
    empty: false,
    rows: [
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        parameterName: "Speaking",
        tierScheme: ["emerging", "developing", "secure"],
        targetTier: "secure",
        targetValue: 0.7,
        buckets: {
          awaiting_evidence: 1,
          emerging: 0,
          developing: 3,
          secure: 1,
          above_target: 0,
        },
      },
    ],
  };
}

function makeCellResponse(opts: { empty?: boolean } = {}) {
  if (opts.empty) {
    return {
      courseId: COURSE_ID,
      skillRef: "SKILL-01",
      parameterId: "p1",
      parameterName: "Speaking",
      tier: "secure",
      tierScheme: ["emerging", "developing", "secure"],
      learners: [],
      empty: true,
    };
  }
  return {
    courseId: COURSE_ID,
    skillRef: "SKILL-01",
    parameterId: "p1",
    parameterName: "Speaking",
    tier: "developing",
    tierScheme: ["emerging", "developing", "secure"],
    learners: [
      {
        callerId: "c1",
        callerName: "Alice",
        currentScore: 0.6,
        lastMeasurement: {
          callId: "call-1",
          measuredAt: "2026-06-13T00:00:00Z",
          score: 0.6,
          confidence: 0.85,
          excerpts: ["Connected speech with occasional hesitations"],
        },
      },
      {
        callerId: "c2",
        callerName: "Bob",
        currentScore: 0.55,
        lastMeasurement: null,
      },
    ],
    empty: false,
  };
}

describe("<CourseSkillsTab> cohort cell drill", () => {
  let originalFetch: typeof fetch;
  let cellRequestUrls: string[];

  beforeEach(() => {
    originalFetch = global.fetch;
    cellRequestUrls = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("skills-framework")) {
        return new Response(JSON.stringify(makeFrameworkResponse()), {
          status: 200,
        });
      }
      if (u.includes("skills-cohort-heatmap")) {
        return new Response(JSON.stringify(makeHeatmapResponse()), {
          status: 200,
        });
      }
      if (u.includes("skills-cohort-cell")) {
        cellRequestUrls.push(u);
        const isSecure = u.includes("tier=secure");
        return new Response(
          JSON.stringify(makeCellResponse({ empty: isSecure })),
          { status: 200 },
        );
      }
      throw new Error(`Unmocked fetch: ${u}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  async function openHeatmap() {
    render(<CourseSkillsTab courseId={COURSE_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Framework Map/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Cohort Heatmap/i }));
    await waitFor(() => {
      expect(screen.getByText(/Click any cell to drill in/i)).toBeDefined();
    });
  }

  it("clicking a developing cell opens the drill panel with learners + evidence", async () => {
    await openHeatmap();

    // Cell wrapper carries `data-cell="SKILL-01-developing"`
    const cell = document.querySelector(
      '[data-cell="SKILL-01-developing"] button',
    );
    expect(cell).toBeTruthy();
    fireEvent.click(cell as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText(/2 learners/i)).toBeDefined();
    });

    // Both learners shown
    expect(screen.getByText(/Alice/i)).toBeDefined();
    expect(screen.getByText(/Bob/i)).toBeDefined();

    // Alice's evidence excerpt surfaced (verbatim)
    expect(
      screen.getByText(/Connected speech with occasional hesitations/i),
    ).toBeDefined();

    // Bob has no MEASURE row yet → friendly fallback
    expect(screen.getByText(/No transcript evidence captured yet/i)).toBeDefined();

    // Confirm the right query was sent
    expect(
      cellRequestUrls.some(
        (u) => u.includes("skillRef=SKILL-01") && u.includes("tier=developing"),
      ),
    ).toBe(true);
  });

  it("empty bucket shows the 'No learners in this tier yet' copy", async () => {
    await openHeatmap();

    const cell = document.querySelector(
      '[data-cell="SKILL-01-secure"] button',
    );
    fireEvent.click(cell as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByText(/No learners in/i),
      ).toBeDefined();
    });
  });

  it("close button dismisses the panel", async () => {
    await openHeatmap();
    fireEvent.click(
      document.querySelector(
        '[data-cell="SKILL-01-developing"] button',
      ) as HTMLElement,
    );
    await waitFor(() => expect(screen.getByText(/Alice/i)).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /Close drill panel/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Alice/i)).toBeNull();
    });
  });

  it("clicking the same cell twice toggles the panel off", async () => {
    await openHeatmap();
    const cell = document.querySelector(
      '[data-cell="SKILL-01-developing"] button',
    ) as HTMLElement;

    fireEvent.click(cell);
    await waitFor(() => expect(screen.getByText(/Alice/i)).toBeDefined());

    fireEvent.click(cell);
    await waitFor(() => {
      expect(screen.queryByText(/Alice/i)).toBeNull();
    });
  });
});
