/**
 * computeRelevanceState — Phase 0 of the Journey-Design tab refactor.
 *
 * Pins the priority order:
 *   out-of-shape > gated-off > auto-derived > inherited > active
 *
 * Fixtures cover each state plus priority interactions (out-of-shape
 * shadowing gated-off, gated-off shadowing inherited, etc.).
 */

import { describe, it, expect } from "vitest";

import type {
  JourneySettingContract,
  StoragePath,
} from "@/lib/journey/setting-contracts";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import {
  computeRelevanceState,
  type ComputeRelevanceStateArgs,
} from "@/lib/journey/compute-relevance-state";

function makeContract(overrides: Partial<JourneySettingContract> & {
  id: string;
  educatorLabel: string;
  storagePath: StoragePath;
}): JourneySettingContract {
  return {
    group: "G4",
    control: "toggle",
    cascadeSources: [],
    composeImpact: { sections: [], kinds: [], requiresReprompt: false },
    previewLocators: [],
    ...overrides,
  };
}

const baseConfig = {} as PlaybookConfig;

describe("computeRelevanceState", () => {
  it("returns 'active' for a vanilla course-layer setting with no gates", () => {
    const setting = makeContract({
      id: "noGates",
      educatorLabel: "Vanilla",
      storagePath: "config.noGates",
    });
    const args: ComputeRelevanceStateArgs = {
      setting,
      playbookConfig: baseConfig,
      courseShape: "structured",
      effectiveValue: { layer: "course", value: true },
      registry: [setting],
    };
    expect(computeRelevanceState(args)).toEqual({ state: "active" });
  });

  it("returns 'inherited' when effective value comes from Domain", () => {
    const setting = makeContract({
      id: "domainInherited",
      educatorLabel: "Domain-inherited",
      storagePath: "config.domainInherited",
    });
    const args: ComputeRelevanceStateArgs = {
      setting,
      playbookConfig: baseConfig,
      courseShape: "structured",
      effectiveValue: { layer: "domain", value: true },
      registry: [setting],
    };
    expect(computeRelevanceState(args)).toEqual({
      state: "inherited",
      layerOrigin: "Domain",
    });
  });

  it("returns 'inherited' from System default with the System label", () => {
    const setting = makeContract({
      id: "sys",
      educatorLabel: "System",
      storagePath: "config.sys",
    });
    const args: ComputeRelevanceStateArgs = {
      setting,
      playbookConfig: baseConfig,
      courseShape: "structured",
      effectiveValue: { layer: "system", value: true },
      registry: [setting],
    };
    expect(computeRelevanceState(args)).toEqual({
      state: "inherited",
      layerOrigin: "System",
    });
  });

  it("returns 'gated-off' when an explicit gatedBy parent is in inactiveValues", () => {
    const parent = makeContract({
      id: "parentToggle",
      educatorLabel: "Parent",
      storagePath: "config.parentToggle",
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Child",
      storagePath: "config.child",
      gatedBy: { parentId: "parentToggle", inactiveValues: [false] },
    });
    const config = { parentToggle: false } as unknown as PlaybookConfig;
    const args: ComputeRelevanceStateArgs = {
      setting: child,
      playbookConfig: config,
      courseShape: "structured",
      effectiveValue: { layer: "course", value: true },
      registry: [parent, child],
    };
    expect(computeRelevanceState(args)).toEqual({
      state: "gated-off",
      parentId: "parentToggle",
      parentLabel: "Parent",
    });
  });

  it("returns 'auto-derived' when a peer's autoEnableLink actively forces this setting", () => {
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent (Baseline)",
      storagePath: "config.parent",
      autoEnableLinks: [
        {
          targetId: "child",
          whenValue: "baseline_assessment",
          enforce: true,
          decoupleAllowed: true,
          reason: "Baseline mode auto-enables the pre-test stop.",
        },
      ],
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Pre-test stop",
      storagePath: "config.child",
    });
    const config = {
      parent: "baseline_assessment",
      child: true,
    } as unknown as PlaybookConfig;
    const args: ComputeRelevanceStateArgs = {
      setting: child,
      playbookConfig: config,
      courseShape: "structured",
      effectiveValue: { layer: "course", value: true },
      registry: [parent, child],
    };
    expect(computeRelevanceState(args)).toEqual({
      state: "auto-derived",
      parentId: "parent",
      parentLabel: "Parent (Baseline)",
      reason: "Baseline mode auto-enables the pre-test stop.",
    });
  });

  it("returns 'out-of-shape' when current shape isn't in appliesTo (priority over gated-off)", () => {
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent",
      storagePath: "config.parent",
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Module thing",
      storagePath: "config.child",
      appliesTo: ["structured"],
      gatedBy: { parentId: "parent", inactiveValues: [false] },
    });
    // Even though the parent toggle IS off (would otherwise be
    // gated-off), the course is continuous → out-of-shape wins.
    const config = { parent: false } as unknown as PlaybookConfig;
    const args: ComputeRelevanceStateArgs = {
      setting: child,
      playbookConfig: config,
      courseShape: "continuous",
      effectiveValue: { layer: "course", value: true },
      registry: [parent, child],
    };
    const result = computeRelevanceState(args);
    expect(result.state).toBe("out-of-shape");
    expect(result.reason).toMatch(/Continuous courses don't use modules/);
  });

  it("out-of-shape returns a friendly reason for exam vs structured mismatch", () => {
    const setting = makeContract({
      id: "examOnly",
      educatorLabel: "Exam-only setting",
      storagePath: "config.examOnly",
      appliesTo: ["exam"],
    });
    const args: ComputeRelevanceStateArgs = {
      setting,
      playbookConfig: baseConfig,
      courseShape: "structured",
      effectiveValue: { layer: "course", value: true },
      registry: [setting],
    };
    const result = computeRelevanceState(args);
    expect(result.state).toBe("out-of-shape");
    expect(result.reason).toMatch(/Structured courses use a different setting/);
  });

  it("gated-off shadows inherited (Domain default doesn't matter when parent gates)", () => {
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent toggle",
      storagePath: "config.parent",
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Child",
      storagePath: "config.child",
      gatedBy: { parentId: "parent", inactiveValues: [false] },
    });
    const config = { parent: false } as unknown as PlaybookConfig;
    const args: ComputeRelevanceStateArgs = {
      setting: child,
      playbookConfig: config,
      courseShape: "structured",
      effectiveValue: { layer: "domain", value: true },
      registry: [parent, child],
    };
    expect(computeRelevanceState(args).state).toBe("gated-off");
  });

  it("auto-derived shadows inherited (a Domain default doesn't matter when actively forced)", () => {
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent",
      storagePath: "config.parent",
      autoEnableLinks: [
        {
          targetId: "child",
          whenValue: "force",
          enforce: "forced-value",
          decoupleAllowed: true,
          reason: "Coupled.",
        },
      ],
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Child",
      storagePath: "config.child",
    });
    const config = { parent: "force" } as unknown as PlaybookConfig;
    const args: ComputeRelevanceStateArgs = {
      setting: child,
      playbookConfig: config,
      courseShape: "structured",
      effectiveValue: { layer: "domain", value: "irrelevant" },
      registry: [parent, child],
    };
    expect(computeRelevanceState(args).state).toBe("auto-derived");
  });

  it("active for course-shape exam course with appliesTo including exam", () => {
    const setting = makeContract({
      id: "examOk",
      educatorLabel: "Exam OK",
      storagePath: "config.examOk",
      appliesTo: ["exam", "structured"],
    });
    const args: ComputeRelevanceStateArgs = {
      setting,
      playbookConfig: baseConfig,
      courseShape: "exam",
      effectiveValue: { layer: "course", value: 1 },
      registry: [setting],
    };
    expect(computeRelevanceState(args).state).toBe("active");
  });
});
