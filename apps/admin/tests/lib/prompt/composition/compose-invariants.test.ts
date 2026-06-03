/**
 * #1008 / closes #1006 — COMPOSE → LLM output invariants.
 *
 * Maya-shape fixture replaying the hallucination on caller
 * `e1df05fa-9c85-4972-9bbe-b13e52784841` (Maya, IELTS Prep Lab).
 *
 * ComposedPrompt `cd8e2995-5eca-45c2-9b96-64f5b9a48bc0` was used in her
 * call #3 and produced the opener "Hi Maya! Great to see you back. I know
 * you've been working on Part 2 and making good progress — from that one
 * minute panic to getting past 90 seconds." The bolded specifics were
 * fabricated: Maya has zero `CallerMemory` rows and her single
 * `CallerModuleProgress` row covers Part 2 only (mastery 0.59, COMPLETED).
 *
 * The prompt simultaneously: locked focus to Part 2, told the AI to
 * spaced-retrieve Part 1, asked it to "reference last session
 * specifically", and supplied `key_memories: null`. With no factual
 * anchor, the model invented coherent-sounding Part 2 history.
 *
 * Each `it()` below is **expected to fail on `main` HEAD** — they pin the
 * five invariants in `docs/CHAIN-CONTRACTS.md` Link 3 sub-contract
 * "COMPOSE → LLM (output invariants)":
 *
 *   I-C1  Module-lock honoured
 *   I-C2  Call-counter coherence
 *   I-C3  No memory-less reminisce
 *   I-C4  No generic-noun fallback in instructions
 *   I-C5  estimatedProgress heuristic is debug-only
 *
 * Tests-first per TL pushback on #1008 plan: write the reproducer, watch
 * it fail, then make each commit turn a red test green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeSharedState } from "@/lib/prompt/composition/transforms/modules";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  LoadedDataContext,
  ResolvedSpecs,
} from "@/lib/prompt/composition/types";

// Trigger transform registration.
import "@/lib/prompt/composition/transforms/modules";
import "@/lib/prompt/composition/transforms/pedagogy";
import "@/lib/prompt/composition/transforms/quickstart";

// =====================================================
// Maya fixture
// =====================================================

const MAYA_CALLER_ID = "e1df05fa-9c85-4972-9bbe-b13e52784841";
const MAYA_PLAYBOOK_ID = "eb6bc79e-3168-49e5-90a0-d732a37fe294";
const MAYA_DOMAIN_ID = "a3375abd-5e39-4c45-8ba2-0a069b2f6a0d";
const MAYA_CURRICULUM_ID = "2c13fb9a-bc5d-4e66-864f-821d73074117";

/** The four IELTS modules in Maya's curriculum. */
const IELTS_MODULES = [
  { id: "part1", title: "Part 1: Familiar Topics", description: "Familiar Topics", sortOrder: 0, learningOutcomes: ["OUT-01"] },
  { id: "part2", title: "Part 2: Long Turn (Cue Card)", description: "Long Turn", sortOrder: 1, learningOutcomes: ["OUT-03", "OUT-04", "OUT-05"] },
  { id: "part3", title: "Part 3: Abstract Discussion", description: "Abstract Discussion", sortOrder: 2, learningOutcomes: ["OUT-07"] },
  { id: "mock", title: "Full Mock Exam", description: "Full Mock", sortOrder: 3, learningOutcomes: ["OUT-09"] },
];

const mayaSubjectSources = {
  subjects: [
    {
      id: "subj-ielts",
      slug: "ielts-prep-lab",
      name: "IELTS Prep Lab",
      defaultTrustLevel: "ACCREDITED_MATERIAL",
      qualificationRef: null,
      sources: [],
      curriculum: {
        id: MAYA_CURRICULUM_ID,
        slug: "authored-modules",
        name: "Authored modules",
        description: null,
        notableInfo: { modules: IELTS_MODULES },
        deliveryConfig: null,
        trustLevel: "ACCREDITED_MATERIAL",
        qualificationBody: null,
        qualificationNumber: null,
        qualificationLevel: null,
      },
    },
  ],
};

/**
 * LoadedDataContext mirroring the DB state at the time ComposedPrompt
 * cd8e2995 was generated:
 *   - 2 prior ended calls (callCount=2)
 *   - 0 CallerMemory rows
 *   - 0 personality observations would not affect these invariants
 *   - subjectSources carrying the 4 IELTS modules
 */
function makeMayaLoadedData(
  overrides: Partial<LoadedDataContext> = {},
): LoadedDataContext {
  return {
    caller: {
      id: MAYA_CALLER_ID,
      name: "Maya 02062026 1700",
      email: null,
      phone: null,
      externalId: "playground-1780416353930",
      domain: {
        id: MAYA_DOMAIN_ID,
        slug: "ielts-prep-lab",
        name: "IELTS Prep Lab",
        description: "IELTS Speaking preparation — Parts 1, 2, 3 and full mock exam.",
        onboardingWelcome: null,
        onboardingFlowPhases: null,
        onboardingDefaultTargets: null,
        onboardingIdentitySpecId: null,
        config: null,
      } as any,
    } as any,
    memories: [],
    personality: null,
    learnerProfile: null,
    recentCalls: [
      { id: "call-1", endedAt: new Date("2026-06-02T16:30:00Z") } as any,
      { id: "call-2", endedAt: new Date("2026-06-02T16:53:09Z") } as any,
    ],
    callCount: 2,
    behaviorTargets: [],
    callerTargets: [],
    callerAttributes: [],
    goals: [],
    playbooks: [
      {
        id: MAYA_PLAYBOOK_ID,
        name: "IELTS Speaking Practice V1.0",
        isActive: true,
        isLatest: true,
        config: { modulesAuthored: false } as any,
      } as any,
    ],
    systemSpecs: [],
    onboardingSpec: null,
    subjectSources: mayaSubjectSources as any,
    onboardingSession: null,
    ...overrides,
  };
}

function makeResolvedSpecs(overrides: Partial<ResolvedSpecs> = {}): ResolvedSpecs {
  return { identitySpec: null, voiceSpec: null, ...overrides };
}

function makeSectionDef(id: string, transform: string): CompositionSectionDef {
  return {
    id,
    name: id,
    priority: 1,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform,
    outputKey: id,
  };
}

/**
 * Build an AssembledContext from Maya's loaded data + a pre-computed
 * sharedState. The sharedState reflects "what computeSharedState SHOULD
 * produce when locked to part2" — once the I-C1/I-C5 fixes land, this is
 * exactly what the upstream computeSharedState will hand the pedagogy /
 * quickstart transforms.
 */
async function makeMayaAssembledContext(): Promise<AssembledContext> {
  const loadedData = makeMayaLoadedData();
  const resolvedSpecs = makeResolvedSpecs();
  const sharedState = await computeSharedState(
    loadedData,
    resolvedSpecs,
    {},
    undefined,
    "part2", // requestedModuleIdArg — Maya's Call.requestedModuleId on call #3
  );
  return {
    loadedData,
    sections: {},
    resolvedSpecs,
    sharedState,
    specConfig: {},
  } as AssembledContext;
}

// =====================================================
// Test suite
// =====================================================

describe("Compose invariants — Maya IELTS hallucination fixture (#1006 / #1008)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ---------------------------------------------------
  // I-C1 Module-lock honoured
  // ---------------------------------------------------
  describe("I-C1 Module-lock honoured", () => {
    it("locks to part2 (Maya's requestedModuleId) — lockedModule is part2", async () => {
      const data = makeMayaLoadedData();
      const result = await computeSharedState(data, makeResolvedSpecs(), {}, undefined, "part2");
      expect(result.lockedModule).not.toBeNull();
      expect(result.lockedModule?.slug ?? result.lockedModule?.id).toBe("part2");
    });

    it("moduleToReview MUST equal the locked module — never catalogue index 0 (Part 1)", async () => {
      // The #1006 bug: when no completedModules pass the mastery gate,
      // moduleToReview falls back to modules[lastCompletedIndex] where
      // lastCompletedIndex was derived from the estimatedProgress
      // heuristic — catalogue index 0 = Part 1. Even though the learner
      // explicitly locked focus on Part 2.
      const data = makeMayaLoadedData();
      const result = await computeSharedState(data, makeResolvedSpecs(), {}, undefined, "part2");
      const reviewKey = result.moduleToReview?.slug ?? result.moduleToReview?.id;
      expect(reviewKey).toBe("part2");
      expect(reviewKey).not.toBe("part1");
    });

    it("Curriculum 'Current' must equal the locked module (downstream of moduleToReview)", async () => {
      const ctx = await makeMayaAssembledContext();
      // computeQuickStart writes this_session referencing the current module.
      const qs = getTransform("computeQuickStart")!(null, ctx, makeSectionDef("quickstart", "computeQuickStart")) as Record<string, unknown>;
      const thisSession = String(qs.this_session ?? "");
      expect(thisSession).toContain("Part 2");
      expect(thisSession).not.toContain("Part 1");
    });
  });

  // ---------------------------------------------------
  // I-C2 Call-counter coherence
  // ---------------------------------------------------
  describe("I-C2 Call-counter coherence", () => {
    it("quickstart.this_caller call# equals sharedState.callNumber", async () => {
      const ctx = await makeMayaAssembledContext();
      const qs = getTransform("computeQuickStart")!(null, ctx, makeSectionDef("quickstart", "computeQuickStart")) as Record<string, unknown>;
      const thisCaller = String(qs.this_caller ?? "");
      // The prompt-used-in-call-3 should label this as call #3, not call #2.
      // sharedState.callNumber is callCount + 1 = 3.
      const match = thisCaller.match(/call\s*#\s*(\d+)/i);
      expect(match).not.toBeNull();
      const callNumberInQuickstart = Number(match![1]);
      expect(callNumberInQuickstart).toBe(ctx.sharedState.callNumber);
    });

    it("does not collapse callCount === 0 into '(call #1)' via || 1 fallback", async () => {
      // The current implementation uses `loadedData.callCount || 1` which
      // is indistinguishable from a genuine first call. Maya's case has
      // callCount=2 so the bug is hidden here, but the empty-state path
      // must use `?? 1` semantics. This pin uses callCount=0.
      const loadedData = makeMayaLoadedData({ callCount: 0, recentCalls: [] });
      const sharedState = await computeSharedState(loadedData, makeResolvedSpecs(), {}, undefined, "part2");
      const ctx: AssembledContext = {
        loadedData,
        sections: {},
        resolvedSpecs: makeResolvedSpecs(),
        sharedState,
        specConfig: {},
      } as AssembledContext;
      const qs = getTransform("computeQuickStart")!(null, ctx, makeSectionDef("quickstart", "computeQuickStart")) as Record<string, unknown>;
      const thisCaller = String(qs.this_caller ?? "");
      const match = thisCaller.match(/call\s*#\s*(\d+)/i);
      expect(match).not.toBeNull();
      // For a genuine first call, callNumber = callCount + 1 = 1.
      // The bug-fix must emit '(call #1)' via callNumber, not via the ambiguous || 1 fallback.
      expect(Number(match![1])).toBe(sharedState.callNumber);
    });
  });

  // ---------------------------------------------------
  // I-C3 No memory-less reminisce
  // ---------------------------------------------------
  describe("I-C3 No memory-less reminisce (Maya has zero CallerMemory rows)", () => {
    const FORBIDDEN_PHRASES = [
      /reference last session/i,
      /as we covered/i,
      /pick up where we left off/i,
      /remember from before/i,
      /reference the learning journey so far/i,
    ];

    it("pedagogy.flow contains no 'reference last session' when memories=[] AND no priorCallFeedback", async () => {
      const ctx = await makeMayaAssembledContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef("pedagogy", "computeSessionPedagogy")) as Record<string, unknown>;
      const flowText = Array.isArray(result.flow) ? (result.flow as string[]).join(" \n") : "";
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(flowText).not.toMatch(phrase);
      }
    });

    it("pedagogy.reviewFirst.technique does not invite invented recall when no memories exist", async () => {
      const ctx = await makeMayaAssembledContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef("pedagogy", "computeSessionPedagogy")) as Record<string, unknown>;
      const reviewFirst = (result.reviewFirst ?? {}) as Record<string, unknown>;
      const technique = String(reviewFirst.technique ?? "");
      // The technique should not name a Part 1 recall question when
      // Maya has no Part 1 history.
      expect(technique).not.toMatch(/part\s*1/i);
    });
  });

  // ---------------------------------------------------
  // I-C4 No generic-noun fallback in instructions
  // ---------------------------------------------------
  describe("I-C4 No generic-noun fallback in instructions", () => {
    const FORBIDDEN_FALLBACKS = [
      "previous concept",
      "next concept",
      "first concept",
      "new material",
    ];

    it("computeSessionPedagogy emits no generic-noun fallback strings", async () => {
      const ctx = await makeMayaAssembledContext();
      const result = getTransform("computeSessionPedagogy")!(null, ctx, makeSectionDef("pedagogy", "computeSessionPedagogy")) as Record<string, unknown>;
      const dump = JSON.stringify(result).toLowerCase();
      for (const phrase of FORBIDDEN_FALLBACKS) {
        expect(dump).not.toContain(phrase);
      }
    });

    it("computeQuickStart emits no generic-noun fallback strings", async () => {
      const ctx = await makeMayaAssembledContext();
      const result = getTransform("computeQuickStart")!(null, ctx, makeSectionDef("quickstart", "computeQuickStart")) as Record<string, unknown>;
      const dump = JSON.stringify(result).toLowerCase();
      for (const phrase of FORBIDDEN_FALLBACKS) {
        expect(dump).not.toContain(phrase);
      }
    });
  });

  // ---------------------------------------------------
  // I-C5 estimatedProgress heuristic is debug-only
  // ---------------------------------------------------
  describe("I-C5 estimatedProgress heuristic is debug-only", () => {
    it("when requestedModuleId is set, moduleToReview ignores recentCalls-based heuristic", async () => {
      // Inflate recentCalls so the heuristic (recentCalls.length / 2)
      // would pick a high catalogue index. The lock must win.
      const data = makeMayaLoadedData({
        callCount: 8,
        recentCalls: [
          { id: "c-a", endedAt: new Date() } as any,
          { id: "c-b", endedAt: new Date() } as any,
          { id: "c-c", endedAt: new Date() } as any,
          { id: "c-d", endedAt: new Date() } as any,
          { id: "c-e", endedAt: new Date() } as any,
          { id: "c-f", endedAt: new Date() } as any,
          { id: "c-g", endedAt: new Date() } as any,
          { id: "c-h", endedAt: new Date() } as any,
        ],
      });
      const result = await computeSharedState(data, makeResolvedSpecs(), {}, undefined, "part2");
      const reviewKey = result.moduleToReview?.slug ?? result.moduleToReview?.id;
      expect(reviewKey).toBe("part2");
    });

    it("pbConfig.modulesAuthored=false does NOT silently downgrade to heuristic when curriculumId is present", async () => {
      // Maya's playbook has modulesAuthored=false (per her real DB state).
      // The fix removes the gate — CallerModuleProgress (when present) is
      // read regardless. With requestedModuleId locked to part2, the lock
      // anchors moduleToReview here even though modulesAuthored is false.
      const data = makeMayaLoadedData({
        playbooks: [
          {
            id: MAYA_PLAYBOOK_ID,
            name: "IELTS Speaking Practice V1.0",
            isActive: true,
            isLatest: true,
            config: { modulesAuthored: false } as any,
          } as any,
        ],
      });
      const result = await computeSharedState(data, makeResolvedSpecs(), {}, undefined, "part2");
      const reviewKey = result.moduleToReview?.slug ?? result.moduleToReview?.id;
      expect(reviewKey).toBe("part2");
    });
  });
});
