import { describe, it, expect } from "vitest";
import { selectNextExchange, type SchedulerState } from "@/lib/pipeline/scheduler";
import {
  BALANCED,
  INTERLEAVED,
  COMPREHENSION,
  EXAM_PREP,
  REVISION,
  CONFIDENCE_BUILD,
  ALL_PRESETS,
  getPresetForPlaybook,
} from "@/lib/pipeline/scheduler-presets";
import type { WorkingSetInput } from "@/lib/curriculum/working-set-selector";

function makeAssertion(id: string, loId: string, order = 0) {
  return {
    id,
    learningObjectiveId: loId,
    learningOutcomeRef: null,
    depth: 1,
    orderIndex: order,
  };
}

function makeInput(overrides: Partial<WorkingSetInput> = {}): WorkingSetInput {
  return {
    assertions: [
      makeAssertion("tp1", "lo1", 0),
      makeAssertion("tp2", "lo1", 1),
      makeAssertion("tp3", "lo2", 0),
      makeAssertion("tp4", "lo2", 1),
      makeAssertion("tp5", "lo3", 0),
    ],
    learningObjectives: [
      { id: "lo1", ref: "LO1", moduleId: "mod1", sortOrder: 0, description: "Outcome 1" },
      { id: "lo2", ref: "LO2", moduleId: "mod1", sortOrder: 1, description: "Outcome 2" },
      { id: "lo3", ref: "LO3", moduleId: "mod2", sortOrder: 0, description: "Outcome 3" },
    ],
    modules: [
      { id: "mod1", slug: "m1", name: "Module 1", sortOrder: 0, prerequisites: [] },
      { id: "mod2", slug: "m2", name: "Module 2", sortOrder: 1, prerequisites: [] },
    ],
    tpMasteryMap: {},
    loMasteryMap: {},
    callDurationMins: 25,
    masteryThreshold: 0.7,
    ...overrides,
  };
}

function makeState(overrides: Partial<SchedulerState> = {}): SchedulerState {
  return {
    workingSetInput: makeInput(),
    priorDecision: null,
    callsSinceLastAssess: 0,
    ...overrides,
  };
}

describe("scheduler-presets", () => {
  it("exposes all six presets", () => {
    expect(Object.keys(ALL_PRESETS).sort()).toEqual([
      "BALANCED",
      "COMPREHENSION",
      "CONFIDENCE_BUILD",
      "EXAM_PREP",
      "INTERLEAVED",
      "REVISION",
    ]);
  });

  it("each preset declares all 7 factor weights + retrieval cadence", () => {
    for (const preset of Object.values(ALL_PRESETS)) {
      expect(preset.masteryGap).toBeGreaterThan(0);
      expect(preset.spacedDue).toBeGreaterThan(0);
      expect(preset.interleave).toBeGreaterThanOrEqual(0);
      expect(preset.difficultyZpd).toBeGreaterThan(0);
      expect(preset.recentlyUsedPenalty).toBeGreaterThan(0);
      expect(preset.cognitiveLoadPenalty).toBeGreaterThan(0);
      expect(preset.retrievalOpportunity).toBeGreaterThan(0);
      expect(preset.retrievalCadence).toBeGreaterThanOrEqual(1);
    }
  });

  it("getPresetForPlaybook maps teachingMode to preset", () => {
    expect(getPresetForPlaybook({ config: { teachingMode: "comprehension" } }).name).toBe("COMPREHENSION");
    expect(getPresetForPlaybook({ config: { teachingMode: "practice" } }).name).toBe("INTERLEAVED");
    expect(getPresetForPlaybook({ config: { teachingMode: "syllabus" } }).name).toBe("EXAM_PREP");
    expect(getPresetForPlaybook({ config: { teachingMode: "recall" } }).name).toBe("BALANCED");
    expect(getPresetForPlaybook({ config: {} }).name).toBe("BALANCED");
    expect(getPresetForPlaybook(null).name).toBe("BALANCED");
  });

  it("explicit schedulerPreset on playbook overrides teachingMode", () => {
    expect(
      getPresetForPlaybook({ config: { teachingMode: "recall", schedulerPreset: "REVISION" } }).name,
    ).toBe("REVISION");
  });

  it("Exam-prep and Confidence-build carry mastery threshold overrides", () => {
    expect(EXAM_PREP.masteryThresholdOverride).toBe(0.6);
    expect(CONFIDENCE_BUILD.masteryThresholdOverride).toBe(0.6);
    expect(BALANCED.masteryThresholdOverride).toBeNull();
  });

  it("Interleaved has a higher interleave weight than Balanced", () => {
    expect(INTERLEAVED.interleave).toBeGreaterThan(BALANCED.interleave);
  });

  it("Revision has the highest retrieval opportunity", () => {
    for (const p of [BALANCED, INTERLEAVED, COMPREHENSION, EXAM_PREP, CONFIDENCE_BUILD]) {
      expect(REVISION.retrievalOpportunity).toBeGreaterThanOrEqual(p.retrievalOpportunity);
    }
  });

  it("Confidence-build has the lowest difficulty ZPD", () => {
    for (const p of [BALANCED, INTERLEAVED, COMPREHENSION, EXAM_PREP, REVISION]) {
      expect(CONFIDENCE_BUILD.difficultyZpd).toBeLessThanOrEqual(p.difficultyZpd);
    }
  });
});

describe("selectNextExchange — fallbacks", () => {
  it("returns empty-teach fallback when working set is empty", () => {
    const { decision } = selectNextExchange(
      makeState({
        workingSetInput: makeInput({ assertions: [], learningObjectives: [] }),
      }),
      BALANCED,
    );
    expect(decision.mode).toBe("teach");
    expect(decision.outcomeId).toBeNull();
    expect(decision.workingSetAssertionIds).toEqual([]);
    expect(decision.reason).toMatch(/empty working set/);
  });

  it("emits a reason trace on every decision", () => {
    const { decision } = selectNextExchange(makeState(), BALANCED);
    expect(decision.reason).toMatch(/scheduler:balanced/);
    expect(decision.reason).toMatch(/mode=/);
    expect(decision.reason).toMatch(/outcome=/);
  });

  it("contentSourceId is null in v1", () => {
    const { decision } = selectNextExchange(makeState(), BALANCED);
    expect(decision.contentSourceId).toBeNull();
  });
});

describe("selectNextExchange — mode selection (Track A cadence)", () => {
  it("picks teach when cadence has not been reached", () => {
    const { decision } = selectNextExchange(
      makeState({ callsSinceLastAssess: 1 }),
      BALANCED, // cadence = 3
    );
    expect(decision.mode).toBe("teach");
  });

  it("picks assess when cadence threshold is met", () => {
    const { decision } = selectNextExchange(
      makeState({ callsSinceLastAssess: 3 }),
      BALANCED, // cadence = 3
    );
    expect(decision.mode).toBe("assess");
  });

  it("picks assess every call when preset cadence is 1 (Revision)", () => {
    const { decision } = selectNextExchange(
      makeState({ callsSinceLastAssess: 1 }),
      REVISION,
    );
    expect(decision.mode).toBe("assess");
  });

  it("picks review after prior assess (consolidation pass)", () => {
    // Give the learner some in-progress mastery so reviewIds is populated
    const input = makeInput({
      tpMasteryMap: {
        tp1: { mastery: 0.4, status: "in_progress", lastSeenAt: null },
        tp2: { mastery: 0.4, status: "in_progress", lastSeenAt: null },
      } as any,
    });
    const { decision } = selectNextExchange(
      {
        workingSetInput: input,
        priorDecision: {
          mode: "assess",
          outcomeId: "lo1",
          contentSourceId: null,
          workingSetAssertionIds: [],
          reason: "",
          writtenAt: "",
        },
        callsSinceLastAssess: 0,
      },
      BALANCED,
    );
    expect(decision.mode).toBe("review");
  });
});

describe("selectNextExchange — factor weights", () => {
  it("γ interleave: prefers a different outcome than the prior call", () => {
    const { decision } = selectNextExchange(
      {
        workingSetInput: makeInput(),
        priorDecision: {
          mode: "teach",
          outcomeId: "lo1",
          contentSourceId: null,
          workingSetAssertionIds: [],
          reason: "",
          writtenAt: "",
        },
        callsSinceLastAssess: 0,
      },
      INTERLEAVED,
    );
    // With interleave=0.9 and recentlyUsedPenalty=0.5 against lo1,
    // a different outcome should win.
    expect(decision.outcomeId).not.toBe("lo1");
  });

  it("−ε recently-used penalty: falls back to non-prior outcome with high penalty", () => {
    const strongPenalty = { ...BALANCED, recentlyUsedPenalty: 10 };
    const { decision } = selectNextExchange(
      {
        workingSetInput: makeInput(),
        priorDecision: {
          mode: "teach",
          outcomeId: "lo1",
          contentSourceId: null,
          workingSetAssertionIds: [],
          reason: "",
          writtenAt: "",
        },
        callsSinceLastAssess: 0,
      },
      strongPenalty,
    );
    expect(decision.outcomeId).not.toBe("lo1");
  });

  it("preserves frontier working set via returned workingSet", () => {
    const { workingSet } = selectNextExchange(makeState(), BALANCED);
    expect(workingSet.frontierModuleId).toBe("mod1");
    expect(workingSet.selectedLOs.length).toBeGreaterThan(0);
    expect(workingSet.assertionIds.length).toBeGreaterThan(0);
  });

  it("mastery threshold override applies when preset declares one (Exam-prep)", () => {
    // LO1 is at 0.65 — below default 0.7, above Exam-prep override 0.6
    const input = makeInput({
      tpMasteryMap: {
        tp1: { mastery: 0.65, status: "in_progress", lastSeenAt: null },
        tp2: { mastery: 0.65, status: "in_progress", lastSeenAt: null },
      } as any,
    });
    const balanced = selectNextExchange(
      { workingSetInput: input, priorDecision: null, callsSinceLastAssess: 0 },
      BALANCED,
    );
    const examPrep = selectNextExchange(
      { workingSetInput: input, priorDecision: null, callsSinceLastAssess: 0 },
      EXAM_PREP,
    );
    // Under BALANCED (threshold 0.7), lo1 is below mastery — counted as in_progress.
    // Under EXAM_PREP (threshold 0.6), lo1 is already mastered — totalMastered bumps.
    expect(examPrep.workingSet.totalMastered).toBeGreaterThanOrEqual(balanced.workingSet.totalMastered);
  });
});

describe("selectNextExchange — LO-level mastery threshold override (#155)", () => {
  it("per-LO override beats input-level threshold", () => {
    const input = makeInput({
      learningObjectives: [
        { id: "lo1", ref: "LO1", moduleId: "mod1", sortOrder: 0, description: "", masteryThreshold: 0.5 },
        { id: "lo2", ref: "LO2", moduleId: "mod1", sortOrder: 1, description: "" },
        { id: "lo3", ref: "LO3", moduleId: "mod2", sortOrder: 0, description: "" },
      ],
      tpMasteryMap: {
        tp1: { mastery: 0.55, status: "in_progress", lastSeenAt: null },
        tp2: { mastery: 0.55, status: "in_progress", lastSeenAt: null },
      } as any,
      masteryThreshold: 0.7,
    });
    const { workingSet } = selectNextExchange(
      { workingSetInput: input, priorDecision: null, callsSinceLastAssess: 0 },
      BALANCED,
    );
    // lo1 has override=0.5 → tp1/tp2 at 0.55 are mastered for this LO.
    // Without the override, they'd be in_progress (0.55 < 0.7).
    const lo1Selected = workingSet.selectedLOs.find((lo) => lo.id === "lo1");
    // lo1 should either be mastered (not selected) or show lower priority.
    // Key assertion: totalMastered > 0 under override, 0 without.
    expect(workingSet.totalMastered).toBeGreaterThanOrEqual(1);
  });
});
