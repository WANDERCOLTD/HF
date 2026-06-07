import { describe, expect, test } from "vitest";
import {
  FREE_FLOW,
  BALANCED,
  EXAM_PREP,
  getPresetForPlaybook,
} from "@/lib/pipeline/scheduler-presets";

describe("FREE_FLOW preset (#1257) — CONTINUOUS course routing", () => {
  test("CONTINUOUS course (lessonPlanMode='continuous') → FREE_FLOW", () => {
    const preset = getPresetForPlaybook({
      config: { lessonPlanMode: "continuous" },
    });
    expect(preset.name).toBe("FREE_FLOW");
    expect(preset).toBe(FREE_FLOW);
  });

  test("missing lessonPlanMode → FREE_FLOW (default-deny)", () => {
    const preset = getPresetForPlaybook({ config: {} });
    expect(preset.name).toBe("FREE_FLOW");
  });

  test("null playbook → FREE_FLOW (default-deny)", () => {
    expect(getPresetForPlaybook(null).name).toBe("FREE_FLOW");
    expect(getPresetForPlaybook(undefined).name).toBe("FREE_FLOW");
  });

  test("CONTINUOUS course IGNORES schedulerPreset (FREE_FLOW is unconditional)", () => {
    const preset = getPresetForPlaybook({
      config: { lessonPlanMode: "continuous", schedulerPreset: "EXAM_PREP" },
    });
    expect(preset.name).toBe("FREE_FLOW");
  });

  test("CONTINUOUS course IGNORES teachingMode bridge", () => {
    const preset = getPresetForPlaybook({
      config: { lessonPlanMode: "continuous", teachingMode: "syllabus" },
    });
    expect(preset.name).toBe("FREE_FLOW");
  });

  test("STRUCTURED course with no preset/teachingMode → BALANCED fallback", () => {
    const preset = getPresetForPlaybook({
      config: { lessonPlanMode: "structured" },
    });
    expect(preset.name).toBe("BALANCED");
  });

  test("STRUCTURED course with teachingMode bridge fires", () => {
    const preset = getPresetForPlaybook({
      config: { lessonPlanMode: "structured", teachingMode: "syllabus" },
    });
    expect(preset.name).toBe("EXAM_PREP");
  });

  test("STRUCTURED course with explicit schedulerPreset takes priority over teachingMode", () => {
    const preset = getPresetForPlaybook({
      config: {
        lessonPlanMode: "structured",
        schedulerPreset: "REVISION",
        teachingMode: "syllabus",
      },
    });
    expect(preset.name).toBe("REVISION");
  });

  test("FREE_FLOW shape — all weights zero, cadence sentinel, retrieval off", () => {
    expect(FREE_FLOW.masteryGap).toBe(0);
    expect(FREE_FLOW.spacedDue).toBe(0);
    expect(FREE_FLOW.interleave).toBe(0);
    expect(FREE_FLOW.difficultyZpd).toBe(0);
    expect(FREE_FLOW.recentlyUsedPenalty).toBe(0);
    expect(FREE_FLOW.cognitiveLoadPenalty).toBe(0);
    expect(FREE_FLOW.retrievalOpportunity).toBe(0);
    expect(FREE_FLOW.retrievalCadence).toBe(999);
    expect(FREE_FLOW.masteryThresholdOverride).toBeNull();
    expect(FREE_FLOW.retrievalQuestions).toEqual({ teach: 0, assess: 0, review: 0 });
  });
});
