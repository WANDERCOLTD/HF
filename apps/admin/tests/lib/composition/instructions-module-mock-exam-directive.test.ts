/**
 * #2013 (epic #2009 S4) — `computeInstructions` transform surfaces
 * `module_mock_exam_directive` when the locked module's
 * `mode === "mock-exam"`.
 *
 * Returns null otherwise — byte-identical output for the other 4
 * AuthoredModuleMode values (tutor / mixed / examiner / quiz),
 * for sessions with no locked module, and when the locked module id
 * doesn't match any AuthoredModule.
 *
 * Pins:
 *   - mock-exam mode → { directive } containing "EXAM ASSESSMENT MODE"
 *   - all non-mock-exam modes → null
 *   - no locked module → null
 *   - no matching authored module → null
 *   - directive carries board-chair frame + 4–6 probes + no-MCQ + close shape
 *   - `useFreshMastery: true` appends the prior-mastery-doesn't-carry line
 *   - `useFreshMastery` absent → no such line (existing playbooks unchanged)
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
    callNumber: 1,
    ...overrides,
  };
}

function makeContext(
  args: {
    mode?: AuthoredModuleMode;
    lockedId?: string;
    matchById?: boolean;
    noLockedModule?: boolean;
    useFreshMastery?: boolean;
  } = {},
): AssembledContext {
  const lockedId = args.lockedId ?? "exam_unit1";
  const matchById = args.matchById ?? true;
  const mode = args.mode ?? "mock-exam";
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedId : "other-id",
    label: "Exam Assessment Unit 1",
    learnerSelectable: true,
    mode,
    duration: "40 min",
    scoringFired: "Per-LO per-dimension",
    voiceBandReadout: false,
    sessionTerminal: true,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    settings: {},
  };
  const playbookConfig: PlaybookConfig = {
    modules: [authoredModule],
    ...(args.useFreshMastery !== undefined
      ? ({ useFreshMastery: args.useFreshMastery } as Partial<PlaybookConfig>)
      : {}),
  } as PlaybookConfig;
  return {
    sharedState: makeSharedState({
      lockedModule: args.noLockedModule
        ? null
        : ({
            id: lockedId,
            slug: lockedId,
            name: "Exam Assessment Unit 1",
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
          name: "CIO/CTO Exam Assessment",
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

describe("computeInstructions — module_mock_exam_directive (#2013)", () => {
  it("emits { directive } when locked module mode is 'mock-exam'", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string } | null;
    };
    expect(result.module_mock_exam_directive).not.toBeNull();
    expect(result.module_mock_exam_directive!.directive).toContain(
      "EXAM ASSESSMENT MODE",
    );
    expect(result.module_mock_exam_directive!.directive).toContain(
      "board-chair",
    );
    expect(result.module_mock_exam_directive!.directive).toContain(
      "4–6 scenario probes",
    );
  });

  it("returns null for mode 'tutor'", async () => {
    const ctx = makeContext({ mode: "tutor" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("returns null for mode 'mixed'", async () => {
    const ctx = makeContext({ mode: "mixed" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("returns null for mode 'examiner' (legacy strict-examiner; not board-chair)", async () => {
    const ctx = makeContext({ mode: "examiner" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("returns null for mode 'quiz'", async () => {
    const ctx = makeContext({ mode: "quiz" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("returns null when no lockedModule is set", async () => {
    const ctx = makeContext({ mode: "mock-exam", noLockedModule: true });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("returns null when no matching authored module exists", async () => {
    const ctx = makeContext({ mode: "mock-exam", matchById: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: unknown;
    };
    expect(result.module_mock_exam_directive).toBeNull();
  });

  it("directive forbids MCQs (board-chair, not Pop Quiz)", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).toContain("NO MCQs");
  });

  it("directive forbids mid-session teaching", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).toContain(
      "NO teaching mid-session",
    );
  });

  it("directive specifies per-LO per-dimension close (4-tier breakdown)", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).toContain(
      "Foundation / Developing / Practitioner / Distinction",
    );
    expect(result.module_mock_exam_directive.directive).toContain(
      "Revision Aid",
    );
  });

  it("appends prior-mastery-doesn't-carry line when useFreshMastery is true", async () => {
    const ctx = makeContext({ mode: "mock-exam", useFreshMastery: true });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).toContain(
      "Prior mastery DOES NOT carry in",
    );
    expect(result.module_mock_exam_directive.directive).toContain(
      "this Unit fresh from THIS session",
    );
  });

  it("omits prior-mastery line when useFreshMastery is absent (existing courses unchanged)", async () => {
    const ctx = makeContext({ mode: "mock-exam" });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).not.toContain(
      "Prior mastery DOES NOT carry in",
    );
  });

  it("omits prior-mastery line when useFreshMastery is false explicitly", async () => {
    const ctx = makeContext({ mode: "mock-exam", useFreshMastery: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      module_mock_exam_directive: { directive: string };
    };
    expect(result.module_mock_exam_directive.directive).not.toContain(
      "Prior mastery DOES NOT carry in",
    );
  });
});
