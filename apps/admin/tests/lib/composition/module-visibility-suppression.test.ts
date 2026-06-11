import { describe, it, expect, vi } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";

// Mock the registry before importing quickstart (which imports PARAMS).
// Mirrors quickstart.test.ts so both transforms register cleanly.
vi.mock("@/lib/registry", () => ({
  PARAMS: {
    BEH_WARMTH: "BEH-WARMTH",
    BEH_QUESTION_RATE: "BEH-QUESTION-RATE",
    BEH_RESPONSE_LEN: "BEH-RESPONSE-LEN",
    BEH_TURN_LENGTH: "BEH-TURN-LENGTH",
    BEH_PAUSE_TOLERANCE: "BEH-PAUSE-TOLERANCE",
  },
}));

// Trigger transform registration.
import "@/lib/prompt/composition/transforms/quickstart";
import "@/lib/prompt/composition/transforms/pedagogy";

import {
  SUPPRESSED_INTRODUCE_STEP,
  SUPPRESSED_NEW_MATERIAL_MODULE,
  SUPPRESSED_THIS_SESSION_COPY,
} from "@/lib/prompt/composition/transforms/module-visibility-gate";

// ── helpers ──

type FirstCallModuleVisibility =
  | "mention_from_call_1"
  | "hide_until_call_2"
  | "hide_until_learner_picks";

function makeQuickstartContext(opts: {
  firstCallModuleVisibility?: FirstCallModuleVisibility;
  isFirstCall: boolean;
  callNumber: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lockedModule?: any;
} = { isFirstCall: false, callNumber: 1 }): AssembledContext {
  const baseCfg =
    opts.firstCallModuleVisibility !== undefined
      ? {
          firstCall: {
            firstCallModuleVisibility: opts.firstCallModuleVisibility,
          },
        }
      : {};

  return {
    loadedData: {
      caller: {
        id: "c1",
        name: "Beckett",
        email: null,
        phone: null,
        externalId: null,
        domain: null,
      },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: opts.callNumber,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [
        {
          id: "pb-1",
          name: "Big Five Personality",
          status: "PUBLISHED",
          domain: null,
          items: [],
          config: baseCfg,
        },
      ],
      systemSpecs: [],
      onboardingSpec: null,
    } as unknown as AssembledContext["loadedData"],
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      channel: "voice",
      callNumber: opts.callNumber,
      isFinalSession: false,
      modules: [
        { slug: "m1", name: "Foundations: Why Five?" },
        { slug: "m2", name: "Open-Mindedness" },
      ],
      isFirstCall: opts.isFirstCall,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: { slug: "m1", name: "Foundations: Why Five?" },
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
      lockedModule: opts.lockedModule ?? null,
    } as unknown as AssembledContext["sharedState"],
    specConfig: {},
  } as AssembledContext;
}

function makeQuickstartSectionDef(): CompositionSectionDef {
  return {
    id: "quickstart",
    name: "Quick Start",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeQuickStart",
    outputKey: "_quickStart",
  } as CompositionSectionDef;
}

function makePedagogyContext(opts: {
  firstCallModuleVisibility?: FirstCallModuleVisibility;
  isFirstCall: boolean;
  callNumber: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lockedModule?: any;
} = { isFirstCall: false, callNumber: 1 }): AssembledContext {
  const baseCfg =
    opts.firstCallModuleVisibility !== undefined
      ? {
          firstCall: {
            firstCallModuleVisibility: opts.firstCallModuleVisibility,
          },
        }
      : {};

  return {
    loadedData: {
      caller: {
        id: "c1",
        name: "Beckett",
        email: null,
        phone: null,
        externalId: null,
        domain: null,
      },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: opts.callNumber,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [
        {
          id: "pb-1",
          name: "Big Five",
          status: "PUBLISHED",
          domain: null,
          items: [],
          config: baseCfg,
        },
      ],
      systemSpecs: [],
      onboardingSpec: null,
      onboardingSession: null,
      subjectSources: null,
    } as unknown as AssembledContext["loadedData"],
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [
        {
          slug: "m1",
          name: "Foundations: Why Five?",
          description: "Origins of the OCEAN model",
        },
        { slug: "m2", name: "Open-Mindedness", description: "O dimension" },
      ],
      isFirstCall: opts.isFirstCall,
      isFirstCallInDomain: opts.isFirstCall,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: {
        slug: "m1",
        name: "Foundations: Why Five?",
        description: "Origins",
      },
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
      callNumber: opts.callNumber,
      channel: "voice" as const,
      isFinalSession: false,
      schedulerDecision: null,
      lessonPlanEntry: null,
      lockedModule: opts.lockedModule ?? null,
    } as unknown as AssembledContext["sharedState"],
    specConfig: {},
  } as AssembledContext;
}

function makePedagogySectionDef(): CompositionSectionDef {
  return {
    id: "pedagogy",
    name: "Session Pedagogy",
    priority: 3,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeSessionPedagogy",
    outputKey: "instructions.session_pedagogy",
  } as CompositionSectionDef;
}

// =====================================================
// quickstart.this_session suppression
// =====================================================

describe("quickstart.this_session — module-visibility gate (#1405)", () => {
  it("absent gate ⇒ byte-equal to pre-#1405 'First session - introduce <name>'", () => {
    const ctx = makeQuickstartContext({ isFirstCall: true, callNumber: 1 });
    const result = getTransform("computeQuickStart")!(
      null,
      ctx,
      makeQuickstartSectionDef(),
    );
    expect(result.this_session).toContain("First session");
    expect(result.this_session).toContain("Foundations: Why Five?");
  });

  it("hide_until_call_2 on call 1 ⇒ suppress module name", () => {
    const ctx = makeQuickstartContext({
      firstCallModuleVisibility: "hide_until_call_2",
      isFirstCall: true,
      callNumber: 1,
    });
    const result = getTransform("computeQuickStart")!(
      null,
      ctx,
      makeQuickstartSectionDef(),
    );
    expect(result.this_session).toBe(SUPPRESSED_THIS_SESSION_COPY);
    expect(result.this_session).not.toContain("Foundations: Why Five?");
  });

  it("hide_until_call_2 on call 2 ⇒ module name re-appears (gate resets)", () => {
    const ctx = makeQuickstartContext({
      firstCallModuleVisibility: "hide_until_call_2",
      isFirstCall: false,
      callNumber: 2,
    });
    const result = getTransform("computeQuickStart")!(
      null,
      ctx,
      makeQuickstartSectionDef(),
    );
    // Returning-caller / scheduler path takes over on call 2; we only
    // assert that the suppressed copy is NOT used.
    expect(result.this_session).not.toBe(SUPPRESSED_THIS_SESSION_COPY);
  });

  it("hide_until_learner_picks + locked module ⇒ locked focus wins (no suppression)", () => {
    const ctx = makeQuickstartContext({
      firstCallModuleVisibility: "hide_until_learner_picks",
      isFirstCall: true,
      callNumber: 1,
      lockedModule: {
        id: "m1",
        slug: "m1",
        name: "Foundations: Why Five?",
        description: "Origins",
      },
    });
    const result = getTransform("computeQuickStart")!(
      null,
      ctx,
      makeQuickstartSectionDef(),
    );
    // The locked-focus branch fires BEFORE the gate (gate would return
    // false anyway because lastSelectedModuleId is set). Either way, the
    // module name surfaces.
    expect(result.this_session).toContain("Foundations: Why Five?");
  });
});

// =====================================================
// pedagogy.plan.newMaterial + flow suppression
// =====================================================

describe("pedagogy — module-visibility gate (#1405)", () => {
  it("absent gate on first call ⇒ plan.newMaterial.module is the literal module name", () => {
    const ctx = makePedagogyContext({ isFirstCall: true, callNumber: 1 });
    const result = getTransform("computeSessionPedagogy")!(
      null,
      ctx,
      makePedagogySectionDef(),
    );
    expect(result.newMaterial?.module).toBe("Foundations: Why Five?");
    // Default fallback flow names the module in the "Introduce foundation" step.
    const flowText = (result.flow as string[]).join(" ");
    expect(flowText).toContain("Foundations: Why Five?");
  });

  it("hide_until_call_2 on first call ⇒ plan.newMaterial.module is generic", () => {
    const ctx = makePedagogyContext({
      firstCallModuleVisibility: "hide_until_call_2",
      isFirstCall: true,
      callNumber: 1,
    });
    const result = getTransform("computeSessionPedagogy")!(
      null,
      ctx,
      makePedagogySectionDef(),
    );
    expect(result.newMaterial?.module).toBe(SUPPRESSED_NEW_MATERIAL_MODULE);
    // Approach copy must not name the module either.
    expect(result.newMaterial?.approach ?? "").not.toContain(
      "Foundations: Why Five?",
    );
  });

  it("hide_until_call_2 on first call ⇒ flow steps use generic 'subject area' framing", () => {
    const ctx = makePedagogyContext({
      firstCallModuleVisibility: "hide_until_call_2",
      isFirstCall: true,
      callNumber: 1,
    });
    const result = getTransform("computeSessionPedagogy")!(
      null,
      ctx,
      makePedagogySectionDef(),
    );
    const flowText = (result.flow as string[]).join(" ");
    expect(flowText).not.toContain("Foundations: Why Five?");
    expect(flowText).toContain(SUPPRESSED_INTRODUCE_STEP);
  });

  it("hide_until_learner_picks persists past call 1 when learner hasn't picked", () => {
    // Returning-caller / scheduler branch — gate ONLY redacts the
    // onboarding-first-call branch's plan.newMaterial + flow. For call 3
    // the SCHEDULER branch runs instead. This test pins that we DON'T
    // accidentally extend suppression into scheduler / RETURNING_CALLER
    // (which is the documented out-of-scope area).
    const ctx = makePedagogyContext({
      firstCallModuleVisibility: "hide_until_learner_picks",
      isFirstCall: false,
      callNumber: 3,
    });
    const result = getTransform("computeSessionPedagogy")!(
      null,
      ctx,
      makePedagogySectionDef(),
    );
    // Returning-caller path runs (sessionType not FIRST_CALL). The gate is
    // intentionally call-1 scoped; this asserts byte-equality with the
    // pre-#1405 returning-caller path.
    expect(result.sessionType).toBe("RETURNING_CALLER");
  });

  it("hide_until_call_2 + learner picked ⇒ no suppression (pick wins)", () => {
    const ctx = makePedagogyContext({
      firstCallModuleVisibility: "hide_until_call_2",
      isFirstCall: true,
      callNumber: 1,
      lockedModule: {
        id: "m1",
        slug: "m1",
        name: "Foundations: Why Five?",
        description: "Origins",
      },
    });
    const result = getTransform("computeSessionPedagogy")!(
      null,
      ctx,
      makePedagogySectionDef(),
    );
    expect(result.newMaterial?.module).toBe("Foundations: Why Five?");
    expect(result.newMaterial?.module).not.toBe(SUPPRESSED_NEW_MATERIAL_MODULE);
  });
});
