/**
 * #2011 (epic #2009 S2) — `computeInstructions` transform surfaces
 * `module_quiz_directive` when the locked module's `mode === "quiz"`.
 *
 * Returns null otherwise — byte-identical output for the other 4
 * AuthoredModuleMode values (tutor / mixed / examiner / mock-exam),
 * for sessions with no locked module, and for sessions where the
 * locked module id doesn't match any AuthoredModule.
 *
 * Pins:
 *   - quiz mode → { directive } containing "QUIZ MODE" sentinel
 *   - all non-quiz modes → null
 *   - no locked module → null
 *   - no matching authored module → null
 *   - directive carries the canonical 8–12 + MCQ-shape contract
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/instructions";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type {
  AuthoredModule,
  AuthoredModuleMode,
  PlaybookConfig,
} from "@/lib/types/json-fields";

function makeSharedState(
  overrides: Partial<SharedComputedState> = {},
): SharedComputedState {
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
    callNumber: 3,
    ...overrides,
  };
}

function makeContext(
  args: {
    mode?: AuthoredModuleMode;
    lockedId?: string;
    matchById?: boolean;
    noLockedModule?: boolean;
  } = {},
): AssembledContext {
  const lockedId = args.lockedId ?? "popquiz_u1";
  const matchById = args.matchById ?? true;
  const mode = args.mode ?? "quiz";
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedId : "other-id",
    label: "Pop Quiz Unit 1",
    learnerSelectable: true,
    mode,
    duration: "10 min",
    scoringFired: "MCQ pool",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    settings: {},
  };
  const playbookConfig: PlaybookConfig = { modules: [authoredModule] };
  return {
    sharedState: makeSharedState({
      lockedModule: args.noLockedModule
        ? null
        : ({
            id: lockedId,
            slug: lockedId,
            name: "Pop Quiz Unit 1",
          } as unknown as SharedComputedState["lockedModule"]),
    }),
    sections: {},
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [
        {
          id: "p1",
          name: "CIO/CTO Pop Quiz",
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
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "instructions",
  name: "Instructions",
  priority: 9,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computeInstructions",
  outputKey: "instructions",
};

const transform = getTransform("computeInstructions")!;

describe("computeInstructions — module_quiz_directive (#2011)", () => {
  it("emits { directive } when locked module mode is 'quiz'", async () => {
    const ctx = makeContext({ mode: "quiz" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: { directive: string } | null;
    };
    expect(result.module_quiz_directive).not.toBeNull();
    expect(result.module_quiz_directive!.directive).toContain("QUIZ MODE");
    expect(result.module_quiz_directive!.directive).toContain("MCQ drill");
    expect(result.module_quiz_directive!.directive).toContain("8–12 questions");
  });

  it("returns null for mode 'tutor' (default conversational)", async () => {
    const ctx = makeContext({ mode: "tutor" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("returns null for mode 'mixed'", async () => {
    const ctx = makeContext({ mode: "mixed" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("returns null for mode 'examiner'", async () => {
    const ctx = makeContext({ mode: "examiner" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("returns null for mode 'mock-exam'", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("returns null when no lockedModule is set", async () => {
    const ctx = makeContext({ mode: "quiz", noLockedModule: true });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("returns null when no matching authored module exists", async () => {
    const ctx = makeContext({ mode: "quiz", matchById: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: unknown;
    };
    expect(result.module_quiz_directive).toBeNull();
  });

  it("directive instructs conversational-tone (NOT A/B/C/D)", async () => {
    const ctx = makeContext({ mode: "quiz" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: { directive: string };
    };
    expect(result.module_quiz_directive.directive).toContain("conversational tone");
    expect(result.module_quiz_directive.directive).toContain(
      'NOT "A: / B: / C: / D:"',
    );
  });

  it("directive instructs exactly TWO sentences of feedback per question", async () => {
    const ctx = makeContext({ mode: "quiz" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: { directive: string };
    };
    expect(result.module_quiz_directive.directive).toContain("TWO sentences");
    expect(result.module_quiz_directive.directive).toContain("underlying principle");
  });

  it("directive instructs close-sequence (score + weakest LO + Revision Aid pointer)", async () => {
    const ctx = makeContext({ mode: "quiz" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_quiz_directive: { directive: string };
    };
    expect(result.module_quiz_directive.directive).toContain("state the score");
    expect(result.module_quiz_directive.directive).toContain("weakest LO");
    expect(result.module_quiz_directive.directive).toContain("Revision Aid");
  });
});
