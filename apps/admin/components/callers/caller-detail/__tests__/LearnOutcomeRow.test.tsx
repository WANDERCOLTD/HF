/**
 * Tests for LearnOutcomeRow (#438 Story B)
 *
 * Covers three states:
 *   - scored:    loIndex has the ref, touchedModules > 0 → shows coverage
 *   - unscored:  loIndex has the ref but touchedModules === 0 → empty state
 *   - loading:   loIndex is null → no coverage / no empty state yet
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LearnOutcomeRow } from "../ProgressTab";
import type { Goal } from "../types";

function goalOf(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g-1",
    type: "LEARN",
    name: "Fallback name (used when LO description absent)",
    description: null,
    status: "ACTIVE",
    priority: 5,
    progress: 0.42,
    ref: "OUT-01",
    progressMetrics: null,
    startedAt: null,
    completedAt: null,
    targetDate: null,
    isAssessmentTarget: false,
    assessmentConfig: null,
    playbook: null,
    contentSpec: null,
    ...overrides,
  };
}

describe("LearnOutcomeRow (#438)", () => {
  it("scored: renders LO description + 'across N/M modules' coverage", () => {
    render(
      <LearnOutcomeRow
        goal={goalOf()}
        loIndex={{
          "OUT-01": {
            description: "Use a range of grammatical structures accurately",
            touchedModules: 2,
            totalModulesWithRef: 4,
          },
        }}
        typeColor="var(--accent-primary)"
        typeIcon="📘"
        typeLabel="LEARN"
      />,
    );

    expect(
      screen.getByText("Use a range of grammatical structures accurately"),
    ).toBeInTheDocument();
    expect(screen.getByText("across 2/4 modules")).toBeInTheDocument();
    expect(screen.queryByText(/Not yet observed/)).not.toBeInTheDocument();
  });

  it("unscored: shows empty-state 'Not yet observed in calls'", () => {
    render(
      <LearnOutcomeRow
        goal={goalOf({ progress: 0 })}
        loIndex={{
          "OUT-01": {
            description: "Use a range of grammatical structures accurately",
            touchedModules: 0,
            totalModulesWithRef: 4,
          },
        }}
        typeColor="var(--accent-primary)"
        typeIcon="📘"
        typeLabel="LEARN"
      />,
    );

    expect(screen.getByText("Not yet observed in calls")).toBeInTheDocument();
    expect(screen.queryByText(/across .*\/.* modules/)).not.toBeInTheDocument();
  });

  it("partial coverage (loIndex returns nothing for ref): empty state", () => {
    render(
      <LearnOutcomeRow
        goal={goalOf({ ref: "OUT-99" })}
        loIndex={{
          "OUT-01": {
            description: "x",
            touchedModules: 1,
            totalModulesWithRef: 2,
          },
        }}
        typeColor="var(--accent-primary)"
        typeIcon="📘"
        typeLabel="LEARN"
      />,
    );

    // Falls back to the goal.name because no LO description was found.
    expect(
      screen.getByText("Fallback name (used when LO description absent)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not yet observed in calls")).toBeInTheDocument();
  });

  it("loading (loIndex is null): no coverage line and no empty state — just the goal name", () => {
    render(
      <LearnOutcomeRow
        goal={goalOf()}
        loIndex={null}
        typeColor="var(--accent-primary)"
        typeIcon="📘"
        typeLabel="LEARN"
      />,
    );

    expect(
      screen.getByText("Fallback name (used when LO description absent)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/across .*\/.* modules/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not yet observed/)).not.toBeInTheDocument();
  });

  it("renders the outcome ref label", () => {
    render(
      <LearnOutcomeRow
        goal={goalOf({ ref: "OUT-03" })}
        loIndex={{}}
        typeColor="var(--accent-primary)"
        typeIcon="📘"
        typeLabel="LEARN"
      />,
    );
    expect(screen.getByText("OUT-03")).toBeInTheDocument();
  });
});
