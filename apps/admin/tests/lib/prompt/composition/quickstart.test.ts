/**
 * #1403 — Greeting lens cascade tests for the `computeQuickStart` transform.
 *
 * Pins:
 *
 *   (a) `welcomeMessage` fires at branch 1.5 — wins over phase-derived
 *       (#1195) when isFirstCall AND welcomeMessage is set.
 *   (b) Token substitution: `{firstName}` + `{courseName}` resolved
 *       server-side before reaching the AI.
 *   (c) `firstCallWaitForAck` produces the `greeting_ack_gate` output
 *       key with the matching instruction; `"none"` → null.
 *   (d) `firstCallCourseIntro` produces `greeting_course_intro` with
 *       tokens substituted; null when unset.
 *   (e) Returning-user phrasing guard fires at the new 1.5 position
 *       (matches #1195 behaviour but at the new branch order).
 *   (f) calls 2+ do NOT emit ack-gate / course-intro (first-call only).
 */

import { describe, it, expect } from "vitest";

import "@/lib/prompt/composition/transforms/quickstart";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function makeSharedState(overrides: Partial<SharedComputedState> = {}): SharedComputedState {
  return {
    channel: "text",
    modules: [],
    isFirstCall: true,
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

function makeContext(opts: {
  playbookConfig?: PlaybookConfig;
  callerName?: string | null;
  playbookName?: string;
  isFirstCall?: boolean;
  callNumber?: number;
  onboardingPhases?: Array<{ phase: string; goals?: string[] }>;
} = {}): AssembledContext {
  const playbookConfig: PlaybookConfig = {
    ...(opts.playbookConfig ?? {}),
  };
  // Stitch phase-derived goals onto playbook config so #1195 cascade fires
  // when welcomeMessage is null.
  if (opts.onboardingPhases) {
    playbookConfig.onboardingFlowPhases = {
      phases: opts.onboardingPhases.map((p) => ({
        phase: p.phase,
        duration: "1m",
        goals: p.goals ?? [],
      })),
    };
  }

  return {
    sharedState: makeSharedState({
      isFirstCall: opts.isFirstCall ?? true,
      callNumber: opts.callNumber ?? 1,
    }),
    sections: {
      behaviorTargets: { _merged: [], all: [] },
      memories: { _deduplicated: [], all: [] },
    },
    loadedData: {
      caller: opts.callerName !== undefined ? { id: "c1", name: opts.callerName } : { id: "c1", name: "Beckett" },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: opts.callNumber ?? 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [
        {
          id: "p1",
          name: opts.playbookName ?? "OCEAN Personality Model",
          status: "PUBLISHED",
          config: playbookConfig,
          domain: null,
          items: [],
        },
      ] as unknown as AssembledContext["loadedData"]["playbooks"],
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
    specConfig: {},
  } as unknown as AssembledContext;
}

const STUB_SECTION: CompositionSectionDef = {
  id: "_quickStart",
  loaderName: "noop",
  transformName: "computeQuickStart",
  contextKey: "_quickStart",
} as unknown as CompositionSectionDef;

function runQuickStart(ctx: AssembledContext): any {
  const transform = getTransform("computeQuickStart");
  if (!transform) throw new Error("computeQuickStart transform not registered");
  return transform({}, ctx, STUB_SECTION);
}

describe("quickstart · first_line cascade — welcomeMessage at branch 1.5", () => {
  it("welcomeMessage wins over phase-derived (#1195) on first call", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Hi {firstName}, welcome to your AI Tutoring Experience.",
        },
        // Phase-derived would normally fire here (set-expectations intent):
        onboardingPhases: [
          { phase: "intro", goals: ["set expectations for the session"] },
        ],
      }),
    );
    expect(result.first_line).toContain("welcome to your AI Tutoring Experience");
    // Phase-derived would have produced "set the frame" wording:
    expect(result.first_line).not.toContain("set the frame");
  });

  it("substitutes {firstName} server-side using caller.name", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Hi {firstName}, ready?",
        },
        callerName: "Beckett",
      }),
    );
    expect(result.first_line).toBe("Hi Beckett, ready?");
  });

  it("substitutes {courseName} using playbook.name", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Welcome to {courseName}.",
        },
        playbookName: "OCEAN Personality Model",
      }),
    );
    expect(result.first_line).toBe("Welcome to OCEAN Personality Model.");
  });

  it("falls through to phase-derived when welcomeMessage is null", () => {
    const result = runQuickStart(
      makeContext({
        onboardingPhases: [
          { phase: "intro", goals: ["set expectations for the session"] },
        ],
      }),
    );
    // Phase-derived "set-expectations" intent should fire.
    expect(result.first_line).toContain("set the frame");
  });

  it("returning-user phrasing guard fires at branch 1.5 on first call", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          // Educator left "Welcome back" in the welcomeMessage — guard rewrites.
          welcomeMessage: "Welcome back! Let's pick up where we left off.",
        },
      }),
    );
    expect(result.first_line).not.toContain("Welcome back");
    expect(result.first_line.toLowerCase()).toContain("hi");
  });
});

describe("quickstart · greeting_ack_gate (#1403)", () => {
  it("emits greeting_words instruction by default on first call", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: { welcomeMessage: "Hi there." },
      }),
    );
    expect(result.greeting_ack_gate).toContain("hello, hi, yes, yeah");
  });

  it("emits any_response instruction when configured", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Hi there.",
          firstCallWaitForAck: "any_response",
        },
      }),
    );
    expect(result.greeting_ack_gate).toContain("any response");
  });

  it("returns null when firstCallWaitForAck is 'none'", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Hi there.",
          firstCallWaitForAck: "none",
        },
      }),
    );
    expect(result.greeting_ack_gate).toBeNull();
  });

  it("returns null on calls 2+ regardless of mode", () => {
    const result = runQuickStart(
      makeContext({
        isFirstCall: false,
        callNumber: 2,
        playbookConfig: {
          welcomeMessage: "Hi there.",
          firstCallWaitForAck: "greeting_words",
        },
      }),
    );
    expect(result.greeting_ack_gate).toBeNull();
  });
});

describe("quickstart · greeting_course_intro (#1403)", () => {
  it("substitutes {courseName} into the course-intro text", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: {
          welcomeMessage: "Hi.",
          firstCallCourseIntro: "Today we're learning about {courseName}. Ready?",
        },
        playbookName: "OCEAN",
      }),
    );
    expect(result.greeting_course_intro).toBe(
      "Today we're learning about OCEAN. Ready?",
    );
  });

  it("returns null when firstCallCourseIntro is unset", () => {
    const result = runQuickStart(
      makeContext({
        playbookConfig: { welcomeMessage: "Hi." },
      }),
    );
    expect(result.greeting_course_intro).toBeNull();
  });

  it("returns null on calls 2+ even when configured", () => {
    const result = runQuickStart(
      makeContext({
        isFirstCall: false,
        callNumber: 2,
        playbookConfig: {
          firstCallCourseIntro: "Today about {courseName}.",
        },
        playbookName: "OCEAN",
      }),
    );
    expect(result.greeting_course_intro).toBeNull();
  });
});
