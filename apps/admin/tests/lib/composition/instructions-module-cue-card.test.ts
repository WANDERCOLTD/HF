/**
 * #1733 (epic #1730 G8 consumer B) — `computeInstructions` surfaces
 * `module_cue_card` directive when:
 *
 *   1. `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   2. `sharedState.lockedModule` set
 *   3. `Playbook.config.modules[]` has a matching `AuthoredModule` with
 *      a non-empty `settings.cueCardPool`
 *   4. The picked card has both a `topic` (non-empty string) and a
 *      non-empty `bullets[]`
 *
 * Pins:
 *   - flag-off → null
 *   - flag-on + valid pool + lockedModule → directive
 *   - deterministic pick by `callNumber % pool.length` (same call sees
 *     same card)
 *   - null on empty / missing pool / missing topic / empty bullets
 *   - no matching authored module → null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "@/lib/prompt/composition/transforms/instructions";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

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

function makeContext(opts: {
  cueCardPool?: Array<{ topic: string; bullets: string[] }>;
  callNumber?: number;
  lockedId?: string;
  matchById?: boolean;
  noLockedModule?: boolean;
} = {}): AssembledContext {
  const lockedId = opts.lockedId ?? "part2";
  const matchById = opts.matchById ?? true;
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedId : "other-id",
    label: "Part 2: Cue Card",
    learnerSelectable: true,
    mode: "tutor",
    duration: "4 min",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    settings: opts.cueCardPool !== undefined ? { cueCardPool: opts.cueCardPool } : {},
  };
  const playbookConfig: PlaybookConfig = { modules: [authoredModule] };
  return {
    sharedState: makeSharedState({
      callNumber: opts.callNumber ?? 1,
      lockedModule: opts.noLockedModule
        ? null
        : ({
            id: lockedId,
            slug: lockedId,
            name: "Part 2",
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
          name: "IELTS",
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

const POOL_FIXTURE = [
  { topic: "Describe a meal you enjoyed.", bullets: ["When", "Where", "Why memorable"] },
  { topic: "Describe a time you were nervous.", bullets: ["Situation", "Reason", "Outcome"] },
  { topic: "Describe a useful skill.", bullets: ["Skill", "How learned", "Why useful"] },
];

describe("computeInstructions — module_cue_card (#1733)", () => {
  describe("HF_FLAG_IELTS_MODULE_SETTINGS gating", () => {
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when the flag is off (default)", async () => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("emits picked card when flag on + valid pool", async () => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 1 });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_cue_card: { kind: string; topic: string; bullets: string[]; directive: string } | null;
      };
      expect(result.module_cue_card).not.toBeNull();
      expect(result.module_cue_card!.kind).toBe("cueCard");
      expect(result.module_cue_card!.topic).toBe(POOL_FIXTURE[0].topic);
      expect(result.module_cue_card!.bullets).toEqual(POOL_FIXTURE[0].bullets);
      expect(result.module_cue_card!.directive).toContain(POOL_FIXTURE[0].topic);
    });
  });

  describe("deterministic round-robin by callNumber", () => {
    beforeEach(() => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    });
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("call 1 picks index 0", async () => {
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 1 });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_cue_card: { topic: string };
      };
      expect(result.module_cue_card.topic).toBe(POOL_FIXTURE[0].topic);
    });

    it("call 2 picks index 1", async () => {
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 2 });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_cue_card: { topic: string };
      };
      expect(result.module_cue_card.topic).toBe(POOL_FIXTURE[1].topic);
    });

    it("call 4 wraps round to index 0 (4 % 3 = 1, callIndex 3 → 3 mod 3 = 0)", async () => {
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 4 });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_cue_card: { topic: string };
      };
      // callNumber=4 → callIndex=3 → 3 mod 3 = 0
      expect(result.module_cue_card.topic).toBe(POOL_FIXTURE[0].topic);
    });

    it("same call → same card across re-renders (idempotent)", async () => {
      const ctx1 = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 7 });
      const r1 = (await transform(null, ctx1, STUB_SECTION)) as { module_cue_card: { topic: string } };
      const ctx2 = makeContext({ cueCardPool: POOL_FIXTURE, callNumber: 7 });
      const r2 = (await transform(null, ctx2, STUB_SECTION)) as { module_cue_card: { topic: string } };
      expect(r1.module_cue_card.topic).toBe(r2.module_cue_card.topic);
    });
  });

  describe("resolution edge cases", () => {
    beforeEach(() => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    });
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when no lockedModule", async () => {
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, noLockedModule: true });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("returns null when no matching authored module", async () => {
      const ctx = makeContext({ cueCardPool: POOL_FIXTURE, matchById: false });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("returns null when pool is empty", async () => {
      const ctx = makeContext({ cueCardPool: [] });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("returns null when pool is missing", async () => {
      const ctx = makeContext({});
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("returns null when picked card has empty topic", async () => {
      const ctx = makeContext({
        cueCardPool: [{ topic: "   ", bullets: ["a", "b"] }],
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });

    it("returns null when picked card has no usable bullets", async () => {
      const ctx = makeContext({
        cueCardPool: [{ topic: "topic", bullets: [""] }],
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as { module_cue_card: unknown };
      expect(result.module_cue_card).toBeNull();
    });
  });
});
