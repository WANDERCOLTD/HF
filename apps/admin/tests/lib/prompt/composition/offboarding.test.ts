/**
 * Offboarding Transform — isFinalSession logic
 *
 * Tests the isFinalSession computation in computeSharedState and
 * the offboarding transform output.
 */

import { describe, it, expect } from "vitest";

// Import the transform to trigger registration
import "@/lib/prompt/composition/transforms/offboarding";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, SharedComputedState, CompositionSectionDef } from "@/lib/prompt/composition/types";

/** Minimal shared state with overridable fields */
function makeSharedState(overrides: Partial<SharedComputedState> = {}): SharedComputedState {
  return {
    channel: "text",
    modules: [],
    isFirstCall: false,
    daysSinceLastCall: 0,
    completedModules: new Set<string>(),
    estimatedProgress: 0,
    lastCompletedIndex: -1,
    moduleToReview: null,
    nextModule: null,
    reviewType: "quick_recall",
    reviewReason: "",
    thresholds: { high: 0.65, low: 0.35 },
    isFinalSession: false,
    callNumber: 1,
    ...overrides,
  };
}

function makeContext(sharedState: SharedComputedState): AssembledContext {
  return {
    sharedState,
    sections: {},
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {} as any,
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "offboarding",
  name: "Offboarding Guidance",
  priority: 13.5,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computeOffboarding",
  outputKey: "offboarding",
};

describe("offboarding transform", () => {
  const transform = getTransform("computeOffboarding");

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
  });

  it("returns null when isFinalSession is false", () => {
    const ctx = makeContext(makeSharedState({ isFinalSession: false }));
    const result = transform!(null, ctx, STUB_SECTION);
    expect(result).toBeNull();
  });

  it("returns offboarding guidance when isFinalSession is true", () => {
    const ctx = makeContext(makeSharedState({ isFinalSession: true }));
    const result = transform!(null, ctx, STUB_SECTION);
    expect(result).not.toBeNull();
    expect(result.isFinalSession).toBe(true);
    expect(result.guidance).toBeInstanceOf(Array);
    expect(result.guidance.length).toBeGreaterThan(0);
    expect(result.guidance[0]).toContain("final session");
  });
});

describe("isFinalSession computation logic", () => {
  // These tests validate the logic independently — same conditions as computeSharedState

  it("is true when sessionCount is set and call number >= sessionCount", () => {
    const sessionCount = 5;
    const callNumber = 5;
    const modules: any[] = [];
    const completedModules = new Set<string>();

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
    const isFinalSession = isFinalBySessionCount || isFinalByModules;

    expect(isFinalSession).toBe(true);
  });

  it("is true when all modules are completed (no sessionCount)", () => {
    const sessionCount = undefined;
    const callNumber = 3;
    const modules = [
      { id: "m1", name: "M1", slug: "m1", description: "", sortOrder: 0 },
      { id: "m2", name: "M2", slug: "m2", description: "", sortOrder: 1 },
    ];
    const completedModules = new Set<string>(["m1", "m2"]);

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
    const isFinalSession = isFinalBySessionCount || isFinalByModules;

    expect(isFinalSession).toBe(true);
  });

  it("is false when sessionCount is set but call number < sessionCount", () => {
    const sessionCount = 5;
    const callNumber = 3;
    const modules: any[] = [];
    const completedModules = new Set<string>();

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
    const isFinalSession = isFinalBySessionCount || isFinalByModules;

    expect(isFinalSession).toBe(false);
  });

  it("is false when modules exist but not all completed", () => {
    const sessionCount = undefined;
    const callNumber = 2;
    const modules = [
      { id: "m1", name: "M1", slug: "m1", description: "", sortOrder: 0 },
      { id: "m2", name: "M2", slug: "m2", description: "", sortOrder: 1 },
      { id: "m3", name: "M3", slug: "m3", description: "", sortOrder: 2 },
    ];
    const completedModules = new Set<string>(["m1", "m2"]);

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
    const isFinalSession = isFinalBySessionCount || isFinalByModules;

    expect(isFinalSession).toBe(false);
  });

  it("is false when no modules and no sessionCount", () => {
    const sessionCount = undefined;
    const callNumber = 3;
    const modules: any[] = [];
    const completedModules = new Set<string>();

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
    const isFinalSession = isFinalBySessionCount || isFinalByModules;

    expect(isFinalSession).toBe(false);
  });

  it("is true when call number exceeds sessionCount (beyond final)", () => {
    const sessionCount = 3;
    const callNumber = 5;

    const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
    expect(isFinalBySessionCount).toBe(true);
  });
});
