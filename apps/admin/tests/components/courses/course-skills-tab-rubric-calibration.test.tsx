/**
 * Tests for the Rubric Calibration lens inside `<CourseSkillsTab>` (SP3-A).
 *
 * Renders the tab, switches to the rubric-calibration lens, and pins:
 *   1. Both mastery-policy cascade chips render (skillTierMapping +
 *      skillScoringEmaHalfLifeDays).
 *   2. All three variant-preset pills render (fresh / cap / mode).
 *   3. The per-skill MEASURE block surfaces the literal given/when/then text.
 *   4. measureSpecSlug is surfaced in the section blurb.
 *   5. Skills with no matching trigger render the "Re-project the
 *      course-ref" fallback copy.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
  cleanup,
} from "@testing-library/react";

import { CourseSkillsTab } from "@/app/x/courses/[courseId]/CourseSkillsTab";

const COURSE_ID = "course-cccc";

// Two routes are fetched by this tab: the framework-map default loader
// and the rubric-calibration loader once we switch lens.
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

function makeRubricResponse(opts: { withTrigger?: boolean } = {}) {
  return {
    courseId: COURSE_ID,
    playbookStatus: "ACTIVE",
    measureSpecSlug: "skill-measure-course-c",
    empty: false,
    skills: [
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        parameterName: "Speaking",
        description: "Spoken fluency",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
        tiers: {
          emerging: "Halting",
          developing: "Connected",
          secure: "Fluent",
        },
        bandThresholds: null,
        measure: opts.withTrigger
          ? {
              triggerName: "Speaking",
              given: "Learner is speaking on a topic",
              when: "They form sentences",
              then: "Score against the speaking rubric",
              actions: [
                { description: "Connected speech", parameterId: "p1", weight: 1.0 },
              ],
            }
          : null,
      },
    ],
    masteryPolicyChips: [
      {
        knobKey: "skillTierMapping",
        envelope: {
          value: null,
          source: "SYSTEM",
          layers: [],
          isInherited: false,
          recommendedLayerForEdit: "PLAYBOOK",
        },
      },
      {
        knobKey: "skillScoringEmaHalfLifeDays",
        envelope: {
          value: 14,
          source: "PLAYBOOK",
          layers: [
            {
              layer: "PLAYBOOK",
              scopeId: COURSE_ID,
              scopeLabel: "Course",
              value: 14,
              setAt: null,
              setBy: null,
            },
          ],
          isInherited: false,
          recommendedLayerForEdit: "PLAYBOOK",
        },
      },
    ],
    variantPreset: {
      useFreshMastery: false,
      maxMasteryTier: null,
      scoringMode: null,
    },
    // #2158 — route now surfaces aiMeasurement.isIeltsShaped + the
    // LLM-IELTS scoring kill-switch state. Stub as null isIeltsShaped
    // + switch off so the component renders the "not IELTS" branch.
    aiMeasurement: {
      isIeltsShaped: false,
      disableLlmIeltsScoring: false,
    },
  };
}

describe("<CourseSkillsTab> rubric-calibration lens", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("skills-framework")) {
        return new Response(JSON.stringify(makeFrameworkResponse()), {
          status: 200,
        });
      }
      if (u.includes("skills-rubric-calibration")) {
        return new Response(JSON.stringify(makeRubricResponse({ withTrigger: true })), {
          status: 200,
        });
      }
      if (u.includes("skills-cohort-heatmap")) {
        return new Response(
          JSON.stringify({
            courseId: COURSE_ID,
            totalLearners: 0,
            rows: [],
            empty: true,
          }),
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

  it("switches to rubric-calibration lens and shows the MEASURE block", async () => {
    render(<CourseSkillsTab courseId={COURSE_ID} />);
    // Default lens loads first
    await waitFor(() => {
      expect(screen.getByText(/Framework Map/i)).toBeDefined();
    });

    // Click the rubric-calibration tab
    fireEvent.click(screen.getByRole("tab", { name: /Rubric Calibration/i }));

    // Wait for the rubric route to land
    await waitFor(() => {
      expect(screen.getByText(/Mastery policy/i)).toBeDefined();
    });

    // Both cascade chips rendered (label text shown by the chip composer)
    expect(screen.getByText(/Tier mapping/i)).toBeDefined();
    expect(screen.getByText(/EMA half-life/i)).toBeDefined();

    // All 3 variant-preset pills present
    expect(screen.getByText(/Fresh mastery/i)).toBeDefined();
    expect(screen.getByText(/Mastery cap/i)).toBeDefined();
    expect(screen.getByText(/Scoring mode/i)).toBeDefined();

    // MEASURE spec slug surfaced
    expect(screen.getByText(/skill-measure-course-c/i)).toBeDefined();

    // Find the rubric-calibration skill row via data attribute (scoped to
    // the lens body — avoids false positives from the framework-map row).
    const skillRow = document.querySelector(
      '.hf-rubric-skill[data-skill-ref="SKILL-01"]',
    );
    expect(skillRow).toBeTruthy();
    const skillRowEl = skillRow as HTMLElement;
    const headerButton = within(skillRowEl).getByRole("button");
    fireEvent.click(headerButton);

    await waitFor(() => {
      expect(
        within(skillRowEl).getByText(/What the AI tutor reads/i),
      ).toBeDefined();
    });
    expect(
      within(skillRowEl).getByText(/Learner is speaking on a topic/i),
    ).toBeDefined();
    expect(
      within(skillRowEl).getByText(/They form sentences/i),
    ).toBeDefined();
    expect(
      within(skillRowEl).getByText(/Score against the speaking rubric/i),
    ).toBeDefined();
  });

  it("falls back to re-project copy when no MEASURE trigger exists for a skill", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("skills-framework")) {
        return new Response(JSON.stringify(makeFrameworkResponse()), {
          status: 200,
        });
      }
      if (u.includes("skills-rubric-calibration")) {
        return new Response(JSON.stringify(makeRubricResponse({ withTrigger: false })), {
          status: 200,
        });
      }
      throw new Error(`Unmocked fetch: ${u}`);
    }) as unknown as typeof fetch;

    render(<CourseSkillsTab courseId={COURSE_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Framework Map/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Rubric Calibration/i }));
    await waitFor(() => {
      expect(screen.getByText(/Mastery policy/i)).toBeDefined();
    });

    const skillRow = document.querySelector(
      '.hf-rubric-skill[data-skill-ref="SKILL-01"]',
    );
    expect(skillRow).toBeTruthy();
    const skillRowEl = skillRow as HTMLElement;
    fireEvent.click(within(skillRowEl).getByRole("button"));
    await waitFor(() => {
      expect(
        within(skillRowEl).getByText(/No MEASURE trigger matched this skill/i),
      ).toBeDefined();
    });
  });
});
