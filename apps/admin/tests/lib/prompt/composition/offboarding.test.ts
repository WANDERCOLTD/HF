/**
 * Offboarding Transform — isFinalSession + Felt Progress S2 gating
 *
 * Covers:
 *   - Base cadence='final_only' (default) gating on `sharedState.isFinalSession`
 *   - cadence='every_session_with_data' firing on post-call-1 with data
 *   - `enabled: false` returns null
 *   - Per-field includes (includeModuleMastery / includeGoalProgress /
 *     includeSkillCurrentScore)
 *   - Null guard when every dimension is empty → generic guidance only
 *
 * CallerModuleProgress queries are stubbed via vi.mock so the transform stays
 * unit-testable without a DB.
 *
 * Behavioural assertions about the emitted "cite verbatim" guidance live in
 * the promptfoo eval at evals/felt-progress/offboarding-summary.yaml.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerModuleProgress: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import "@/lib/prompt/composition/transforms/offboarding";
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

interface MakeCtxOpts {
  shared?: Partial<SharedComputedState>;
  config?: PlaybookConfig["offboardingSummary"];
  goals?: Array<{
    id: string;
    type: string;
    name: string;
    progress: number;
    status: string;
    priority: number;
    description: string | null;
    isAssessmentTarget: boolean;
    assessmentConfig: null;
    playbookId: string | null;
    contentSpec: null;
    playbook: null;
    startedAt: null;
  }>;
  callerTargets?: Array<{
    parameterId: string;
    targetValue: number;
    currentScore: number | null;
    confidence: number;
    parameter: { name: string; parameterId: string; interpretationLow: null; interpretationHigh: null; domainGroup: null };
  }>;
  callerId?: string;
}

function makeContext(opts: MakeCtxOpts = {}): AssembledContext {
  const playbookConfig: PlaybookConfig = opts.config ? { offboardingSummary: opts.config } : {};
  return {
    sharedState: makeSharedState(opts.shared),
    sections: {},
    loadedData: {
      caller: opts.callerId
        ? ({ id: opts.callerId, name: null, email: null, phone: null, externalId: null, domain: null } as AssembledContext["loadedData"]["caller"])
        : null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: (opts.callerTargets ?? []) as unknown as AssembledContext["loadedData"]["callerTargets"],
      callerAttributes: [],
      goals: (opts.goals ?? []) as unknown as AssembledContext["loadedData"]["goals"],
      playbooks: [
        { id: "p1", name: "Test Playbook", status: "PUBLISHED", config: playbookConfig, domain: null, items: [] },
      ] as unknown as AssembledContext["loadedData"]["playbooks"],
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
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

const mockedFindMany = vi.mocked(prisma.callerModuleProgress.findMany);

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedFindMany.mockResolvedValue([]);
});

const transform = getTransform("computeOffboarding")!;

describe("offboarding transform — base gating", () => {
  it("is registered", () => {
    expect(transform).toBeDefined();
  });

  it("returns null on a non-final mid-course call (default cadence='final_only')", async () => {
    const ctx = makeContext({ shared: { isFinalSession: false, callNumber: 3 } });
    const result = await transform(null, ctx, STUB_SECTION);
    expect(result).toBeNull();
  });

  it("returns generic guidance on final session with no data (null guard)", async () => {
    const ctx = makeContext({ shared: { isFinalSession: true } });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      isFinalSession: boolean;
      progressSummary: unknown;
      guidance: string[];
    };
    expect(result).not.toBeNull();
    expect(result.isFinalSession).toBe(true);
    expect(result.progressSummary).toBeNull();
    expect(result.guidance.join("\n")).toMatch(/final session/i);
  });

  it("returns null when enabled=false even on final session", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: true },
      config: { enabled: false },
    });
    expect(await transform(null, ctx, STUB_SECTION)).toBeNull();
  });
});

describe("offboarding transform — cadence='every_session_with_data'", () => {
  it("returns null on call 1 even with data", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: false, callNumber: 1 },
      config: { cadence: "every_session_with_data" },
      goals: [
        {
          id: "g1",
          type: "LEARN",
          name: "Master Part 2",
          progress: 0.5,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
      ],
    });
    expect(await transform(null, ctx, STUB_SECTION)).toBeNull();
  });

  it("fires on call 2+ with goal data", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: false, callNumber: 3 },
      config: { cadence: "every_session_with_data" },
      goals: [
        {
          id: "g1",
          type: "LEARN",
          name: "Master Part 2",
          progress: 0.5,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
      ],
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      cadenceFired: string;
      progressSummary: { goals?: Array<{ name: string }> };
    };
    expect(result).not.toBeNull();
    expect(result.cadenceFired).toBe("every_session_with_data");
    expect(result.progressSummary.goals).toEqual([
      expect.objectContaining({ name: "Master Part 2", progress: 0.5 }),
    ]);
  });

  it("null-guards on call 2+ with zero data — generic guidance, no summary", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: false, callNumber: 4 },
      config: { cadence: "every_session_with_data" },
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: unknown;
      guidance: string[];
    };
    expect(result).not.toBeNull();
    expect(result.progressSummary).toBeNull();
    expect(result.guidance.join("\n")).toMatch(/wind down|progress acknowledgement/i);
  });
});

describe("offboarding transform — progressSummary content", () => {
  it("emits module mastery rows when CallerModuleProgress query returns rows", async () => {
    mockedFindMany.mockResolvedValue([
      { mastery: 0.78, callCount: 4, module: { slug: "part-2", title: "Part 2: Long Turn" } },
      { mastery: 0.55, callCount: 2, module: { slug: "part-3", title: "Part 3: Discussion" } },
    ] as unknown as never);

    const ctx = makeContext({
      shared: { isFinalSession: true },
      callerId: "caller-1",
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: { modules?: Array<{ slug: string; mastery: number }> };
    };
    expect(result.progressSummary.modules).toEqual([
      expect.objectContaining({ slug: "part-2", mastery: 0.78, callCount: 4 }),
      expect.objectContaining({ slug: "part-3", mastery: 0.55, callCount: 2 }),
    ]);
  });

  it("emits skill currentScore rows when callerTargets has skill_ parameters", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: true },
      callerTargets: [
        {
          parameterId: "skill_fluency",
          targetValue: 7,
          currentScore: 5.1,
          confidence: 0.8,
          parameter: {
            name: "Fluency",
            parameterId: "skill_fluency",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: null,
          },
        },
        {
          parameterId: "non_skill",
          targetValue: 0.5,
          currentScore: 0.4,
          confidence: 0.5,
          parameter: {
            name: "Engagement",
            parameterId: "non_skill",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: null,
          },
        },
      ],
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: { skills?: Array<{ name: string }> };
    };
    expect(result.progressSummary.skills).toEqual([
      expect.objectContaining({ name: "Fluency", currentScore: 5.1 }),
    ]);
  });

  it("filters goals with progress 0", async () => {
    const ctx = makeContext({
      shared: { isFinalSession: true },
      goals: [
        {
          id: "g1",
          type: "LEARN",
          name: "Started Goal",
          progress: 0.3,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
        {
          id: "g2",
          type: "LEARN",
          name: "Not Started",
          progress: 0,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
      ],
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: { goals?: Array<{ name: string }> };
    };
    expect(result.progressSummary.goals).toEqual([
      expect.objectContaining({ name: "Started Goal" }),
    ]);
  });
});

describe("offboarding transform — per-field includes", () => {
  beforeEach(() => {
    mockedFindMany.mockResolvedValue([
      { mastery: 0.7, callCount: 3, module: { slug: "m1", title: "Module 1" } },
    ] as unknown as never);
  });

  function ctxWithAllDims(config: PlaybookConfig["offboardingSummary"]): AssembledContext {
    return makeContext({
      shared: { isFinalSession: true },
      callerId: "caller-1",
      config,
      goals: [
        {
          id: "g1",
          type: "LEARN",
          name: "G1",
          progress: 0.5,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
      ],
      callerTargets: [
        {
          parameterId: "skill_fluency",
          targetValue: 7,
          currentScore: 5,
          confidence: 0.8,
          parameter: {
            name: "Fluency",
            parameterId: "skill_fluency",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: null,
          },
        },
      ],
    });
  }

  it("includeModuleMastery=false omits modules from summary", async () => {
    const ctx = ctxWithAllDims({ includeModuleMastery: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: ProgressSummary;
    };
    expect(result.progressSummary.modules).toBeUndefined();
    expect(result.progressSummary.goals).toBeDefined();
    expect(result.progressSummary.skills).toBeDefined();
  });

  it("includeGoalProgress=false omits goals from summary", async () => {
    const ctx = ctxWithAllDims({ includeGoalProgress: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: ProgressSummary;
    };
    expect(result.progressSummary.goals).toBeUndefined();
    expect(result.progressSummary.modules).toBeDefined();
    expect(result.progressSummary.skills).toBeDefined();
  });

  it("includeSkillCurrentScore=false omits skills from summary", async () => {
    const ctx = ctxWithAllDims({ includeSkillCurrentScore: false });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: ProgressSummary;
    };
    expect(result.progressSummary.skills).toBeUndefined();
    expect(result.progressSummary.modules).toBeDefined();
    expect(result.progressSummary.goals).toBeDefined();
  });
});

describe("offboarding transform — strict-rule guidance", () => {
  it("includes 'cite ONLY' and 'never invent' instructions when summary present", async () => {
    mockedFindMany.mockResolvedValue([
      { mastery: 0.8, callCount: 3, module: { slug: "m1", title: "Module 1" } },
    ] as unknown as never);

    const ctx = makeContext({
      shared: { isFinalSession: true },
      callerId: "caller-1",
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as { guidance: string[] };
    const guidanceText = result.guidance.join("\n");
    expect(guidanceText).toMatch(/cite ONLY/i);
    expect(guidanceText).toMatch(/never invent/i);
    expect(guidanceText).toMatch(/at most two dimensions/i);
  });

  it("CallerModuleProgress query failure leaves modules undefined but does not crash", async () => {
    mockedFindMany.mockRejectedValue(new Error("db down"));
    const ctx = makeContext({
      shared: { isFinalSession: true },
      callerId: "caller-1",
      goals: [
        {
          id: "g1",
          type: "LEARN",
          name: "G1",
          progress: 0.5,
          status: "ACTIVE",
          priority: 1,
          description: null,
          isAssessmentTarget: false,
          assessmentConfig: null,
          playbookId: null,
          contentSpec: null,
          playbook: null,
          startedAt: null,
        },
      ],
    });
    const result = (await transform(null, ctx, STUB_SECTION)) as {
      progressSummary: ProgressSummary;
    };
    expect(result.progressSummary.modules).toBeUndefined();
    // Goals still surfaced — failure of one dimension does not zero the rest.
    expect(result.progressSummary.goals).toBeDefined();
  });
});

// Local re-import for the type used in the test file (matches transform's export).
interface ProgressSummary {
  modules?: Array<{ slug: string; title: string; mastery: number; callCount: number }>;
  goals?: Array<{ name: string; progress: number; type: string }>;
  skills?: Array<{ name: string; currentScore: number }>;
}
