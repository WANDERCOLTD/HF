/**
 * AssessmentPlanBadge — exercise all 4 resolution states.
 *
 * Story: #2176 S13. Pins the runtime educator-visible classification
 * matches the shared classifier's verdict, with role="status"
 * accessibility + the expected hf-banner-* class for each state.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssessmentPlanBadge } from "@/components/overview-tab/AssessmentPlanBadge";
import type {
  AssessmentMoment,
  PlaybookConfig,
} from "@/lib/types/json-fields";

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

function makeMoment(overrides: Partial<AssessmentMoment> = {}): AssessmentMoment {
  return {
    kind: "upfront-baseline",
    moduleSlug: "baseline",
    samplingPolicy: {
      scope: "cross-curriculum",
      count: { min: 4, target: 8, max: 12 },
      contentKind: "topic-prompt",
    },
    shellKind: "exam",
    scoringSpec: "IELTS-MEASURE-001-ielts-speaking-criteria",
    ...overrides,
  };
}

function baseConfig(overrides: Partial<PlaybookConfig> = {}): PlaybookConfig {
  return {
    modules: [
      {
        id: "baseline",
        label: "Baseline",
        learnerSelectable: true,
        mode: "examiner",
        duration: "10 min",
        scoringFired: "All four",
        voiceBandReadout: false,
        sessionTerminal: true,
        frequency: "first-call-only",
        outcomesPrimary: [],
      },
      {
        id: "part-1",
        label: "Part 1",
        learnerSelectable: true,
        mode: "tutor",
        duration: "15 min",
        scoringFired: "None",
        voiceBandReadout: false,
        sessionTerminal: false,
        frequency: "every-call",
        outcomesPrimary: [],
      },
    ],
    firstCallMode: "baseline_assessment",
    ...overrides,
  } as PlaybookConfig;
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("AssessmentPlanBadge", () => {
  it("renders the resolved state when the plan is clean", () => {
    const config = baseConfig({
      assessmentPlan: { upfront: makeMoment() },
    });
    render(<AssessmentPlanBadge config={config} />);
    const badge = screen.getByTestId("assessment-plan-badge-resolved");
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/hf-banner-success/);
    expect(screen.getByText(/Assessment plan resolved/)).toBeTruthy();
  });

  it("renders the missing state when no plan is declared", () => {
    const config = baseConfig();
    // assessmentPlan deliberately omitted
    render(<AssessmentPlanBadge config={config} />);
    const badge = screen.getByTestId("assessment-plan-badge-missing");
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/hf-banner-warning/);
    expect(screen.getByText(/Assessment plan not declared/)).toBeTruthy();
  });

  it("renders the no-plan state when noAssessmentPlan: true", () => {
    const config = baseConfig({
      assessmentPlan: { noAssessmentPlan: true },
      firstCallMode: "teach_immediately",
    });
    render(<AssessmentPlanBadge config={config} />);
    const badge = screen.getByTestId("assessment-plan-badge-no-plan");
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/hf-banner-info/);
    expect(screen.getByText(/No assessment plan/)).toBeTruthy();
  });

  it("renders the partial state with a reason list when the plan declares a missing module", () => {
    const config = baseConfig({
      assessmentPlan: {
        upfront: makeMoment({ moduleSlug: "no-such-module" }),
      },
    });
    render(<AssessmentPlanBadge config={config} />);
    const badge = screen.getByTestId("assessment-plan-badge-partial");
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/hf-banner-warning/);
    expect(screen.getByText(/Assessment plan partial/)).toBeTruthy();
    // The reason text from the classifier surfaces in the bullet list.
    expect(screen.getByText(/no-such-module/)).toBeTruthy();
  });
});
