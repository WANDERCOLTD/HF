/**
 * #2055 (sub-epic F of #2049) — opening_recap quickstart field tests.
 *
 * Pins the Call 1 framing-recap variant. The opening_recap field
 * surfaces intake answers (PRE_SURVEY scope) so the AI tutor opens
 * with continuity rather than asking the learner to repeat what
 * they already said.
 *
 * Distinct from priorCallFeedback (Call 2+ history recap) — that
 * variant is tested in `prior-call-feedback.test.ts`.
 *
 * Wired into the renderer at `renderPromptSummary.ts` between
 * `[OPENING]` and `[GREETING FLOW]`.
 */

import { describe, it, expect, vi } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CallerAttributeData,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import type { PlaybookConfig } from "@/lib/types/json-fields";

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

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------

function makeAttr(key: string, value: string): CallerAttributeData {
  return {
    key,
    scope: SURVEY_SCOPES.PRE,
    domain: null,
    valueType: "string",
    stringValue: value,
    numberValue: null,
    booleanValue: null,
    jsonValue: null,
    confidence: 1,
    sourceSpecSlug: null,
  };
}

function makeContext(
  overrides: {
    isFirstCall?: boolean;
    callerAttributes?: CallerAttributeData[];
    pbConfig?: Partial<PlaybookConfig>;
  } = {},
): AssembledContext {
  const config = overrides.pbConfig ?? {};
  return {
    loadedData: {
      caller: {
        id: "c1",
        name: "Paul",
        email: null,
        phone: null,
        externalId: null,
        domain: null,
      },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: overrides.callerAttributes ?? [],
      goals: [],
      playbooks: [{ id: "pb1", name: "Test course", config } as any],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      channel: "voice",
      callNumber: 1,
      isFinalSession: false,
      modules: [
        { slug: "m1", name: "Introduction" },
        { slug: "m2", name: "Advanced" },
      ],
      isFirstCall: overrides.isFirstCall ?? true,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: { slug: "m1", name: "Introduction" },
      reviewType: "quick_recall",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
  } as unknown as AssembledContext;
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "quickstart",
    name: "Quick Start",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computeQuickStart",
    outputKey: "_quickStart",
  };
}

function run(ctx: AssembledContext): Record<string, unknown> {
  return getTransform("computeQuickStart")!(null, ctx, makeSectionDef()) as Record<
    string,
    unknown
  >;
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe("opening_recap — flag gating", () => {
  it("flag undefined → opening_recap is null (default off)", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "Pass IELTS 7")],
      pbConfig: {},
    });
    const result = run(ctx);
    expect(result.opening_recap).toBeNull();
  });

  it("flag false → opening_recap is null", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "Pass IELTS 7")],
      pbConfig: { openingRecapEnabled: false },
    });
    const result = run(ctx);
    expect(result.opening_recap).toBeNull();
  });

  it("flag true on Call 1 with intake answers → opening_recap rendered", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [
        makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "Pass IELTS 7"),
        makeAttr(PRE_SURVEY_KEYS.CONFIDENCE, "3"),
      ],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    expect(result.opening_recap).toEqual(expect.any(String));
    expect(result.opening_recap).toContain("Pass IELTS 7");
    expect(result.opening_recap).toContain("3/5");
    // Tutor-facing directive — instructs AI to acknowledge.
    expect(result.opening_recap).toMatch(/acknowledg/i);
  });
});

describe("opening_recap — Call-1 gating", () => {
  it("flag true on Call 2+ → opening_recap is null (priorCallFeedback owns it)", () => {
    const ctx = makeContext({
      isFirstCall: false,
      callerAttributes: [makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "Pass IELTS 7")],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    expect(result.opening_recap).toBeNull();
  });
});

describe("opening_recap — empty intake fallback", () => {
  it("flag true on Call 1 with NO intake answers → opening_recap is null", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    expect(result.opening_recap).toBeNull();
  });

  it("ignores POST-survey rows (only PRE scope counts)", () => {
    const postAttr: CallerAttributeData = {
      ...makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "Wrong scope answer"),
      scope: SURVEY_SCOPES.POST,
    };
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [postAttr],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    expect(result.opening_recap).toBeNull();
  });
});

describe("opening_recap — content variants", () => {
  it("includes concern and motivation when present", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [
        makeAttr(PRE_SURVEY_KEYS.CONCERN_TEXT, "Speaking nerves"),
        makeAttr(PRE_SURVEY_KEYS.MOTIVATION, "University admission"),
      ],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    const text = result.opening_recap as string;
    expect(text).toContain("Speaking nerves");
    expect(text).toContain("University admission");
  });

  it("uses caller name in the framing", () => {
    const ctx = makeContext({
      isFirstCall: true,
      callerAttributes: [makeAttr(PRE_SURVEY_KEYS.GOAL_TEXT, "X")],
      pbConfig: { openingRecapEnabled: true },
    });
    const result = run(ctx);
    expect(result.opening_recap).toContain("Paul");
  });
});
