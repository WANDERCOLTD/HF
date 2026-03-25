import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/physical-materials";

// --- helpers ---

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
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
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "physical_materials",
    name: "Physical Materials",
    priority: 12.66,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "null" },
    transform: "formatPhysicalMaterials",
    outputKey: "physicalMaterials",
  };
}

// =====================================================
// formatPhysicalMaterials transform
// =====================================================

describe("formatPhysicalMaterials transform", () => {
  it("is registered", () => {
    expect(getTransform("formatPhysicalMaterials")).toBeDefined();
  });

  it("returns description when Playbook.config.physicalMaterials is set", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { physicalMaterials: "CGP KS2 English, pages 12-45" },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).not.toBeNull();
    expect(result.description).toBe("CGP KS2 English, pages 12-45");
  });

  it("trims whitespace from physicalMaterials value", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { physicalMaterials: "  Edexcel GCSE Maths Revision Guide  " },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).not.toBeNull();
    expect(result.description).toBe("Edexcel GCSE Maths Revision Guide");
  });

  it("returns null when Playbook.config.physicalMaterials is empty string", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { physicalMaterials: "" },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns null when physicalMaterials is whitespace only", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { physicalMaterials: "   " },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns null when Playbook.config has no physicalMaterials field", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { someOtherField: "value" },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns null when playbooks array is empty (no course)", () => {
    const ctx = makeContext();
    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("returns null when playbook config is null", () => {
    const ctx = makeContext({
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
        playbooks: [{ id: "pb1", config: null } as any],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("reads from first playbook only (course-level config)", () => {
    const ctx = makeContext({
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
        playbooks: [
          {
            id: "pb1",
            config: { physicalMaterials: "Course textbook" },
          } as any,
          {
            id: "pb2",
            config: { physicalMaterials: "Domain textbook" },
          } as any,
        ],
        systemSpecs: [],
        onboardingSpec: null,
      },
    });

    const result = getTransform("formatPhysicalMaterials")!(null, ctx, makeSectionDef());
    expect(result).not.toBeNull();
    expect(result.description).toBe("Course textbook");
  });
});

// =====================================================
// section definition in getDefaultSections
// =====================================================

describe("physical_materials section definition", () => {
  it("is present in getDefaultSections with correct outputKey", async () => {
    const { getDefaultSections } = await import("@/lib/prompt/composition");
    const sections = getDefaultSections();
    const physSection = sections.find(s => s.id === "physical_materials");

    expect(physSection).toBeDefined();
    expect(physSection?.outputKey).toBe("physicalMaterials");
    expect(physSection?.transform).toBe("formatPhysicalMaterials");
  });
});
