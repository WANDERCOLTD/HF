/**
 * Byte-equal regression test for SESSION_FLOW_RESOLVER_ENABLED.
 *
 * The S2 safety mechanism (epic #221) requires that transform output is
 * byte-equal whether the resolver is on or off, for every realistic course
 * configuration. This test runs computeQuickStart and computeSessionPedagogy
 * with the same fixture course under both flag states and asserts equality.
 *
 * If this fails, the resolver has drifted from the legacy cascade and the
 * flag is no longer safe to flip.
 *
 * Coverage:
 *   - Welcome toggles (all-on / all-off / partial)
 *   - Greeting cascade (playbook > domain > generic)
 *   - Onboarding phases cascade (playbook > domain > INIT-001)
 *
 * Note: pre-welcome-config legacy courses (no `welcome` field at all) are
 * intentionally excluded — flag-on uses canonical defaults (knowledgeCheck=false)
 * while flag-off uses the transform's hardcoded `?? true`. Real courses
 * created via the wizard always have welcome set, so this difference is
 * not user-visible. See comment in quickstart.ts discovery_guidance.
 *
 * @see lib/session-flow/resolver.ts
 * @see GitHub issue #217
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

vi.mock("@/lib/registry", () => ({
  PARAMS: {
    BEH_WARMTH: "BEH-WARMTH",
    BEH_QUESTION_RATE: "BEH-QUESTION-RATE",
    BEH_RESPONSE_LEN: "BEH-RESPONSE-LEN",
    BEH_TURN_LENGTH: "BEH-TURN-LENGTH",
    BEH_PAUSE_TOLERANCE: "BEH-PAUSE-TOLERANCE",
  },
}));

// Trigger transform registration
import "@/lib/prompt/composition/transforms/quickstart";
import "@/lib/prompt/composition/transforms/pedagogy";

// --- helpers ---

function makeFirstCallContext(playbookConfig: Record<string, unknown>, domain: Record<string, unknown> | null = null): AssembledContext {
  return {
    loadedData: {
      caller: { id: "c1", name: "Sarah", email: null, phone: null, externalId: null, domain },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [{ id: "p1", name: "Test Course", config: playbookConfig }],
      systemSpecs: [],
      onboardingSpec: { config: { firstCallFlow: { phases: [{ phase: "init-welcome", duration: "1 min", goals: ["g"] }] } } },
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      channel: 'voice',
      callNumber: 1,
      isFinalSession: false,
      modules: [],
      isFirstCall: true,
      isFirstCallInDomain: true,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: undefined,
      nextModule: undefined,
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
  } as unknown as AssembledContext;
}

function quickStartSection(): CompositionSectionDef {
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

function pedagogySection(): CompositionSectionDef {
  return {
    id: "pedagogy",
    name: "Pedagogy",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeSessionPedagogy",
    outputKey: "_pedagogy",
  } as CompositionSectionDef;
}

function runQuickStart(ctx: AssembledContext) {
  const transform = getTransform("computeQuickStart");
  if (!transform) throw new Error("computeQuickStart transform not registered");
  return transform({}, ctx, quickStartSection());
}

function runPedagogy(ctx: AssembledContext) {
  const transform = getTransform("computeSessionPedagogy");
  if (!transform) throw new Error("computeSessionPedagogy transform not registered");
  return transform({}, ctx, pedagogySection());
}

function runBoth(ctx: AssembledContext) {
  return { quickStart: runQuickStart(ctx), pedagogy: runPedagogy(ctx) };
}

// --- fixtures ---

const PB_FULL = {
  welcome: {
    goals: { enabled: true },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: true },
    aiIntroCall: { enabled: false },
  },
  welcomeMessage: "Welcome to the course, {subject}",
  onboardingFlowPhases: { phases: [{ phase: "pb-welcome", duration: "2 min", goals: ["pb-goal"] }] },
};

const PB_OPT_OUT = {
  welcome: {
    goals: { enabled: false },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: false },
    aiIntroCall: { enabled: false },
  },
};

const DOMAIN_WITH_FALLBACK = {
  slug: "test-domain",
  onboardingFlowPhases: { phases: [{ phase: "domain-welcome", duration: "3 min", goals: ["d-goal"] }] },
  onboardingWelcome: "Domain hello",
};

// --- tests ---

describe("byte-equal regression — SESSION_FLOW_RESOLVER_ENABLED", () => {
  beforeEach(() => {
    // Default to flag OFF for clean state
    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("welcome toggles all-on, playbook welcome msg, playbook onboarding phases", () => {
    const ctx = makeFirstCallContext(PB_FULL, DOMAIN_WITH_FALLBACK);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runBoth(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runBoth(ctx);

    expect(on.quickStart.discovery_guidance).toEqual(off.quickStart.discovery_guidance);
    expect(on.quickStart.first_line).toEqual(off.quickStart.first_line);
    expect(on.pedagogy.firstCallPhases).toEqual(off.pedagogy.firstCallPhases);
  });

  it("welcome toggles opt-out (all off)", () => {
    const ctx = makeFirstCallContext(PB_OPT_OUT, DOMAIN_WITH_FALLBACK);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runBoth(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runBoth(ctx);

    expect(on.quickStart.discovery_guidance).toEqual(off.quickStart.discovery_guidance);
    expect(on.quickStart.first_line).toEqual(off.quickStart.first_line);
  });

  it("greeting cascade — domain wins when playbook welcomeMessage absent", () => {
    const pb = { welcome: PB_FULL.welcome }; // no welcomeMessage
    const ctx = makeFirstCallContext(pb, DOMAIN_WITH_FALLBACK);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runBoth(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runBoth(ctx);

    expect(on.quickStart.first_line).toEqual(off.quickStart.first_line);
  });

  it("greeting cascade — generic fallback when nothing configured", () => {
    const pb = { welcome: PB_FULL.welcome }; // no welcomeMessage
    const ctx = makeFirstCallContext(pb, null); // no domain welcome

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runBoth(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runBoth(ctx);

    expect(on.quickStart.first_line).toEqual(off.quickStart.first_line);
  });

  it("onboarding phases cascade — domain wins when playbook absent", () => {
    const pb = { welcome: PB_FULL.welcome }; // no onboardingFlowPhases
    const ctx = makeFirstCallContext(pb, DOMAIN_WITH_FALLBACK);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runPedagogy(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runPedagogy(ctx);

    expect(on.firstCallPhases).toEqual(off.firstCallPhases);
  });

  it("onboarding phases cascade — INIT-001 fallback when nothing configured", () => {
    const pb = { welcome: PB_FULL.welcome };
    const ctx = makeFirstCallContext(pb, null);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "false");
    const off = runPedagogy(ctx);

    vi.stubEnv("SESSION_FLOW_RESOLVER_ENABLED", "true");
    const on = runPedagogy(ctx);

    expect(on.firstCallPhases).toEqual(off.firstCallPhases);
  });
});
