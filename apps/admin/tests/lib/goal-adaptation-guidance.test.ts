/**
 * Tests for goalAdaptationGuidance() — goal-type-aware session adaptation instructions.
 *
 * Covers:
 * - Empty goals → default message
 * - Caps at 3 goals
 * - All 6 goal types produce type-specific guidance
 * - Progress brackets: low (< 30%), mid (30-70%), high (> 70%)
 * - Assessment target tagging + threshold display
 * - Unknown goal type falls back to LEARN guidance
 */

import { describe, it, expect } from "vitest";
import { goalAdaptationGuidance } from "@/lib/prompt/composition/transforms/instructions";
import type { GoalData } from "@/lib/prompt/composition/types";

function makeGoalData(overrides: Partial<GoalData> = {}): GoalData {
  return {
    id: overrides.id ?? "goal-1",
    type: overrides.type ?? "LEARN",
    name: overrides.name ?? "Test Goal",
    description: overrides.description ?? null,
    status: overrides.status ?? "ACTIVE",
    priority: overrides.priority ?? 5,
    progress: overrides.progress ?? 0,
    playbookId: overrides.playbookId ?? null,
    isAssessmentTarget: overrides.isAssessmentTarget ?? false,
    assessmentConfig: overrides.assessmentConfig ?? null,
    contentSpec: overrides.contentSpec ?? null,
    playbook: overrides.playbook ?? null,
    startedAt: overrides.startedAt ?? null,
  };
}

describe("goalAdaptationGuidance", () => {
  it("returns default message when no goals", () => {
    const result = goalAdaptationGuidance([]);
    expect(result).toContain("No specific session goals set");
  });

  it("caps at 3 goals", () => {
    const goals = Array.from({ length: 5 }, (_, i) =>
      makeGoalData({ id: `g-${i}`, name: `Goal ${i}`, progress: 0.5 })
    );
    const result = goalAdaptationGuidance(goals);
    expect(result).toContain("1.");
    expect(result).toContain("2.");
    expect(result).toContain("3.");
    expect(result).not.toContain("4.");
  });

  it("includes goal type and progress percentage", () => {
    const result = goalAdaptationGuidance([
      makeGoalData({ name: "Master fractions", type: "LEARN", progress: 0.45 }),
    ]);
    expect(result).toContain("LEARN");
    expect(result).toContain("45%");
    expect(result).toContain("Master fractions");
  });

  it("tags assessment targets with threshold", () => {
    const result = goalAdaptationGuidance([
      makeGoalData({
        name: "Pass SATs",
        type: "ACHIEVE",
        progress: 0.62,
        isAssessmentTarget: true,
        assessmentConfig: { threshold: 0.8 },
      }),
    ]);
    expect(result).toContain("assessment target");
    expect(result).toContain("target: 80%");
  });

  describe("progress brackets", () => {
    it("low bracket (< 30%) for LEARN", () => {
      const result = goalAdaptationGuidance([
        makeGoalData({ type: "LEARN", progress: 0.1 }),
      ]);
      expect(result).toContain("Introduce concepts gently");
    });

    it("mid bracket (30-70%) for LEARN", () => {
      const result = goalAdaptationGuidance([
        makeGoalData({ type: "LEARN", progress: 0.5 }),
      ]);
      expect(result).toContain("Build on prior foundations");
    });

    it("high bracket (> 70%) for LEARN", () => {
      const result = goalAdaptationGuidance([
        makeGoalData({ type: "LEARN", progress: 0.85 }),
      ]);
      expect(result).toContain("Challenge with application");
    });
  });

  describe("all 6 goal types produce distinct guidance", () => {
    const typeSnippets: Record<string, string> = {
      LEARN: "Introduce concepts gently",
      ACHIEVE: "Clarify what success looks like",
      CHANGE: "Explore motivation",
      CONNECT: "Build trust",
      SUPPORT: "Listen actively",
      CREATE: "Brainstorm freely",
    };

    for (const [type, snippet] of Object.entries(typeSnippets)) {
      it(`${type} at low progress`, () => {
        const result = goalAdaptationGuidance([
          makeGoalData({ type, progress: 0.1 }),
        ]);
        expect(result).toContain(snippet);
      });
    }
  });

  it("unknown goal type falls back to LEARN guidance", () => {
    const result = goalAdaptationGuidance([
      makeGoalData({ type: "UNKNOWN_TYPE", progress: 0.1 }),
    ]);
    expect(result).toContain("Introduce concepts gently");
  });
});
