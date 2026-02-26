import { describe, it, expect } from "vitest";
import {
  distributeModuleTPs,
  computeModuleTPStats,
  formatTPStatsForPrompt,
  type ModuleTPStats,
} from "@/lib/lesson-plan/distribute-tps";

describe("distributeModuleTPs", () => {
  it("returns single session for small modules", () => {
    const stats: ModuleTPStats = {
      moduleId: "MOD-1",
      moduleName: "Basics",
      totalTPs: 6,
      byTeachMethod: { recall_quiz: 3, definition_matching: 3 },
      byLearningOutcome: { LO1: 3, LO2: 3 },
      learningOutcomeRefs: ["LO1", "LO2"],
    };
    const result = distributeModuleTPs(stats, { maxTpsPerSession: 10 });
    expect(result.sessionsNeeded).toBe(1);
    expect(result.sessions[0].suggestedType).toBe("introduce");
    expect(result.sessions[0].tpCount).toBe(6);
    expect(result.sessions[0].learningOutcomeRefs).toEqual(["LO1", "LO2"]);
  });

  it("splits large modules across multiple sessions", () => {
    const stats: ModuleTPStats = {
      moduleId: "MOD-2",
      moduleName: "Temperature Control",
      totalTPs: 22,
      byTeachMethod: { recall_quiz: 8, definition_matching: 6, worked_example: 5, guided_discussion: 3 },
      byLearningOutcome: { LO1: 8, LO2: 6, LO3: 5, LO4: 3 },
      learningOutcomeRefs: ["LO1", "LO2", "LO3", "LO4"],
    };
    const result = distributeModuleTPs(stats, { maxTpsPerSession: 10 });
    expect(result.sessionsNeeded).toBeGreaterThan(1);
    expect(result.sessions[0].suggestedType).toBe("introduce");
    expect(result.sessions[1].suggestedType).toBe("deepen");
    // Total TPs across sessions should equal original
    const totalDistributed = result.sessions.reduce((sum, s) => sum + s.tpCount, 0);
    expect(totalDistributed).toBe(22);
  });

  it("uses default maxTpsPerSession of 10 when not specified", () => {
    const stats: ModuleTPStats = {
      moduleId: "MOD-3",
      moduleName: "Large Module",
      totalTPs: 15,
      byTeachMethod: { recall_quiz: 15 },
      byLearningOutcome: { LO1: 8, LO2: 7 },
      learningOutcomeRefs: ["LO1", "LO2"],
    };
    const result = distributeModuleTPs(stats);
    expect(result.sessionsNeeded).toBeGreaterThan(1);
  });

  it("handles module with no learning outcomes", () => {
    const stats: ModuleTPStats = {
      moduleId: "MOD-4",
      moduleName: "Untagged Module",
      totalTPs: 5,
      byTeachMethod: { recall_quiz: 5 },
      byLearningOutcome: {},
      learningOutcomeRefs: [],
    };
    const result = distributeModuleTPs(stats);
    expect(result.sessionsNeeded).toBe(1);
    expect(result.sessions[0].tpCount).toBe(5);
  });

  it("handles empty module", () => {
    const stats: ModuleTPStats = {
      moduleId: "MOD-5",
      moduleName: "Empty Module",
      totalTPs: 0,
      byTeachMethod: {},
      byLearningOutcome: {},
      learningOutcomeRefs: [],
    };
    const result = distributeModuleTPs(stats);
    expect(result.sessionsNeeded).toBe(1);
    expect(result.sessions[0].tpCount).toBe(0);
  });
});

describe("computeModuleTPStats", () => {
  it("computes stats from module LOs and assertions", () => {
    const modules = [
      { id: "MOD-1", name: "Basics", learningOutcomes: ["LO1: Know terms", "LO2: Apply rules"] },
    ];
    const assertions = [
      { learningOutcomeRef: "LO1", teachMethod: "recall_quiz", category: "fact" },
      { learningOutcomeRef: "LO1", teachMethod: "definition_matching", category: "definition" },
      { learningOutcomeRef: "LO2", teachMethod: "worked_example", category: "process" },
      { learningOutcomeRef: null, teachMethod: null, category: "example" },
    ];
    const stats = computeModuleTPStats(modules, assertions);
    expect(stats).toHaveLength(1);
    expect(stats[0].totalTPs).toBe(3); // Only LO-matched ones
    expect(stats[0].byTeachMethod).toEqual({
      recall_quiz: 1,
      definition_matching: 1,
      worked_example: 1,
    });
    expect(stats[0].byLearningOutcome).toEqual({ LO1: 2, LO2: 1 });
  });

  it("handles AC-prefixed learning outcomes", () => {
    const modules = [
      { id: "MOD-1", name: "Standards", learningOutcomes: ["AC1.1: First standard"] },
    ];
    const assertions = [
      { learningOutcomeRef: "AC1.1", teachMethod: "recall_quiz", category: "rule" },
    ];
    const stats = computeModuleTPStats(modules, assertions);
    expect(stats[0].totalTPs).toBe(1);
    expect(stats[0].byLearningOutcome).toEqual({ "AC1.1": 1 });
  });
});

describe("formatTPStatsForPrompt", () => {
  it("formats distributions as readable prompt text", () => {
    const distributions = [
      {
        moduleId: "MOD-1",
        moduleName: "Basics",
        totalTPs: 6,
        sessionsNeeded: 1,
        sessions: [{
          sessionIndex: 0,
          suggestedType: "introduce" as const,
          tpCount: 6,
          learningOutcomeRefs: ["LO1", "LO2"],
          teachMethodDistribution: { recall_quiz: 3, definition_matching: 3 },
        }],
      },
    ];
    const result = formatTPStatsForPrompt(distributions);
    expect(result).toContain("Basics");
    expect(result).toContain("6 TPs");
    expect(result).toContain("1 session");
  });

  it("returns empty string for empty input", () => {
    expect(formatTPStatsForPrompt([])).toBe("");
  });
});
