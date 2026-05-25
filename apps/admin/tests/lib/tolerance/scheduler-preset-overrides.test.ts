/**
 * #598 Slice 1 — `getPresetForPlaybook` honours
 * `Playbook.config.tolerances.retrievalCadenceOverride` as a shallow merge.
 */

import { describe, it, expect } from "vitest";
import {
  BALANCED,
  EXAM_PREP,
  getPresetForPlaybook,
} from "@/lib/pipeline/scheduler-presets";

describe("getPresetForPlaybook + retrievalCadenceOverride", () => {
  it("absent override → preset cadence unchanged", () => {
    const preset = getPresetForPlaybook({ config: { teachingMode: "syllabus" } });
    expect(preset.retrievalCadence).toBe(EXAM_PREP.retrievalCadence);
    expect(preset.name).toBe(EXAM_PREP.name);
  });

  it("override applies as shallow merge — preset name stays the same", () => {
    const preset = getPresetForPlaybook({
      config: {
        teachingMode: "syllabus",
        tolerances: { retrievalCadenceOverride: 5 },
      },
    });
    expect(preset.retrievalCadence).toBe(5);
    expect(preset.name).toBe(EXAM_PREP.name);
    // Other preset fields untouched.
    expect(preset.masteryGap).toBe(EXAM_PREP.masteryGap);
  });

  it("non-positive override is ignored", () => {
    const preset = getPresetForPlaybook({
      config: { tolerances: { retrievalCadenceOverride: 0 } },
    });
    expect(preset.retrievalCadence).toBe(BALANCED.retrievalCadence);
  });

  it("non-numeric override is ignored", () => {
    const preset = getPresetForPlaybook({
      config: { tolerances: { retrievalCadenceOverride: "fast" as unknown as number } },
    });
    expect(preset.retrievalCadence).toBe(BALANCED.retrievalCadence);
  });

  it("override fractional value is floored to a positive integer", () => {
    const preset = getPresetForPlaybook({
      config: { tolerances: { retrievalCadenceOverride: 3.7 } },
    });
    expect(preset.retrievalCadence).toBe(3);
  });
});
