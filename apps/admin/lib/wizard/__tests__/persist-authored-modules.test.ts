import { describe, it, expect } from "vitest";
import {
  applyAuthoredModules,
  hasBlockingErrors,
} from "../persist-authored-modules";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import type { DetectedAuthoredModules } from "../detect-authored-modules";

const baseConfig: PlaybookConfig = {
  lessonPlanMode: "continuous",
};

const sampleModule = {
  id: "part1",
  label: "Part 1",
  learnerSelectable: true,
  mode: "tutor" as const,
  duration: "Student-led",
  scoringFired: "LR + GRA only",
  voiceBandReadout: false,
  sessionTerminal: false,
  frequency: "repeatable" as const,
  outcomesPrimary: ["OUT-01"],
  prerequisites: [],
};

describe("applyAuthoredModules", () => {
  it("returns no-op (changed=false) when modulesAuthored is null", () => {
    const detected: DetectedAuthoredModules = {
      modulesAuthored: null,
      modules: [],
      moduleDefaults: {},
      outcomes: {},
      validationWarnings: [],
      detectedFrom: [],
    };
    const result = applyAuthoredModules(baseConfig, detected);
    expect(result.changed).toBe(false);
    expect(result.config).toEqual(baseConfig);
  });

  it("records explicit No and clears authored fields", () => {
    const prior: PlaybookConfig = {
      ...baseConfig,
      modulesAuthored: true,
      moduleSource: "authored",
      modules: [sampleModule],
      moduleDefaults: { mode: "tutor" } as PlaybookConfig["moduleDefaults"],
    };
    const detected: DetectedAuthoredModules = {
      modulesAuthored: false,
      modules: [],
      moduleDefaults: {},
      outcomes: {},
      validationWarnings: [],
      detectedFrom: ['header: "Modules authored: No"'],
    };
    const result = applyAuthoredModules(prior, detected);
    expect(result.changed).toBe(true);
    expect(result.config.modulesAuthored).toBe(false);
    expect(result.config.moduleSource).toBe("derived");
    expect(result.config.modules).toBeUndefined();
    expect(result.config.moduleDefaults).toBeUndefined();
    // Untouched fields preserved
    expect(result.config.lessonPlanMode).toBe("continuous");
  });

  it("persists modules and sets moduleSource=authored when modulesAuthored=true", () => {
    const detected: DetectedAuthoredModules = {
      modulesAuthored: true,
      modules: [sampleModule],
      moduleDefaults: { mode: "tutor", correctionStyle: "single_issue_loop" },
      outcomes: {},
      validationWarnings: [],
      detectedFrom: ["parsed 1 module(s) from catalogue"],
    };
    const result = applyAuthoredModules(baseConfig, detected);
    expect(result.changed).toBe(true);
    expect(result.config.modulesAuthored).toBe(true);
    expect(result.config.moduleSource).toBe("authored");
    expect(result.config.modules).toEqual([sampleModule]);
    expect(result.config.moduleDefaults).toEqual({
      mode: "tutor",
      correctionStyle: "single_issue_loop",
    });
  });

  it("records moduleSourceRef when sourceRef provided", () => {
    const detected: DetectedAuthoredModules = {
      modulesAuthored: true,
      modules: [sampleModule],
      moduleDefaults: {},
      outcomes: {},
      validationWarnings: [],
      detectedFrom: [],
    };
    const result = applyAuthoredModules(baseConfig, detected, {
      sourceRef: { docId: "doc-123", version: "2.2" },
    });
    expect(result.config.moduleSourceRef).toEqual({ docId: "doc-123", version: "2.2" });
  });

  it("merges moduleDefaults onto existing defaults rather than replacing", () => {
    const prior: PlaybookConfig = {
      ...baseConfig,
      moduleDefaults: { mode: "examiner", intake: "skippable" } as PlaybookConfig["moduleDefaults"],
    };
    const detected: DetectedAuthoredModules = {
      modulesAuthored: true,
      modules: [sampleModule],
      moduleDefaults: { mode: "tutor", correctionStyle: "single_issue_loop" },
      outcomes: {},
      validationWarnings: [],
      detectedFrom: [],
    };
    const result = applyAuthoredModules(prior, detected);
    expect(result.config.moduleDefaults).toEqual({
      mode: "tutor", // overridden
      intake: "skippable", // preserved
      correctionStyle: "single_issue_loop", // added
    });
  });

  it("preserves existing unrelated config fields", () => {
    const prior: PlaybookConfig = {
      ...baseConfig,
      audience: "Adults preparing for IELTS",
      shareMaterials: false,
    };
    const detected: DetectedAuthoredModules = {
      modulesAuthored: true,
      modules: [sampleModule],
      moduleDefaults: {},
      outcomes: {},
      validationWarnings: [],
      detectedFrom: [],
    };
    const result = applyAuthoredModules(prior, detected);
    expect(result.config.audience).toBe("Adults preparing for IELTS");
    expect(result.config.shareMaterials).toBe(false);
  });

  it("persists validationWarnings alongside modules", () => {
    const detected: DetectedAuthoredModules = {
      modulesAuthored: true,
      modules: [sampleModule],
      moduleDefaults: {},
      outcomes: {},
      validationWarnings: [
        {
          code: "MODULE_FIELD_DEFAULTED",
          message: "Module 'part1' defaulted mode to 'tutor'.",
          path: "modules.part1.mode",
          severity: "warning",
        },
      ],
      detectedFrom: [],
    };
    const result = applyAuthoredModules(baseConfig, detected);
    expect(result.config.validationWarnings).toHaveLength(1);
    expect(result.config.validationWarnings![0].code).toBe("MODULE_FIELD_DEFAULTED");
  });
});

describe("hasBlockingErrors", () => {
  it("returns false when no warnings", () => {
    expect(
      hasBlockingErrors({
        modulesAuthored: true,
        modules: [],
        moduleDefaults: {},
        outcomes: {},
        validationWarnings: [],
        detectedFrom: [],
      }),
    ).toBe(false);
  });

  it("returns false when only warning-severity entries present", () => {
    expect(
      hasBlockingErrors({
        modulesAuthored: true,
        modules: [],
        moduleDefaults: {},
        outcomes: {},
        validationWarnings: [
          { code: "X", message: "x", severity: "warning" },
        ],
        detectedFrom: [],
      }),
    ).toBe(false);
  });

  it("returns true when at least one error-severity entry present", () => {
    expect(
      hasBlockingErrors({
        modulesAuthored: true,
        modules: [],
        moduleDefaults: {},
        outcomes: {},
        validationWarnings: [
          { code: "X", message: "x", severity: "warning" },
          { code: "Y", message: "y", severity: "error" },
        ],
        detectedFrom: [],
      }),
    ).toBe(true);
  });
});
