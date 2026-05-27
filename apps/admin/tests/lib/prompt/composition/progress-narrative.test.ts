/**
 * progressNarrative transform — gating logic
 *
 * Covers Playbook.config.progressNarrative gates:
 *   - enabled (default true)
 *   - skipFirstCall (default true)
 *   - cadence: 'every_call' vs 'on_threshold_crossing'
 *   - minScoreDelta (default 0.1)
 *
 * Behavioural assertions about the emitted strict-rule guidance live in the
 * promptfoo eval at evals/felt-progress/progress-narrative-gates.yaml.
 */

import { describe, it, expect } from "vitest";

import "@/lib/prompt/composition/transforms/progress-narrative";
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
    callNumber: 2,
    // #928 — every CallerAttribute lo_mastery row carries a curriculum-spec
    // prefix; the reader scopes by sharedState.curriculumSpecSlug. Default
    // to the slug used by the `attr` helper below so the existing tests
    // (which exercise gating logic, not scoping) keep passing.
    curriculumSpecSlug: "IELTS-SPEAKING",
    ...overrides,
  };
}

interface AttrLike {
  key: string;
  scope: string;
  numberValue: number | null;
}

function makeContext(opts: {
  callNumber?: number;
  attributes?: AttrLike[];
  config?: PlaybookConfig["progressNarrative"];
  curriculumSpecSlug?: string | undefined;
}): AssembledContext {
  const sharedOverrides: Partial<SharedComputedState> = { callNumber: opts.callNumber ?? 2 };
  if (Object.prototype.hasOwnProperty.call(opts, "curriculumSpecSlug")) {
    sharedOverrides.curriculumSpecSlug = opts.curriculumSpecSlug;
  }
  return {
    sharedState: makeSharedState(sharedOverrides),
    sections: {},
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      // Cast — test stub only carries the fields the transform reads.
      callerAttributes: (opts.attributes ?? []) as unknown as AssembledContext["loadedData"]["callerAttributes"],
      goals: [],
      playbooks: opts.config
        ? ([{ config: { progressNarrative: opts.config } }] as unknown as AssembledContext["loadedData"]["playbooks"])
        : ([{ config: {} }] as unknown as AssembledContext["loadedData"]["playbooks"]),
      systemSpecs: [],
      onboardingSpec: null,
    },
    resolvedSpecs: {} as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "progress_narrative",
  name: "Progress Narrative",
  priority: 7.9,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computeProgressNarrative",
  outputKey: "progressNarrative",
  dependsOn: ["curriculum"],
};

const attr = (key: string, value: number): AttrLike => ({
  key: `curriculum:IELTS-SPEAKING:lo_mastery:${key}`,
  scope: "CURRICULUM",
  numberValue: value,
});

describe("computeProgressNarrative", () => {
  const transform = getTransform("computeProgressNarrative");

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
  });

  it("returns null when enabled=false", () => {
    const ctx = makeContext({
      attributes: [attr("part1:OUT-01", 0.7)],
      config: { enabled: false },
    });
    expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
  });

  it("returns null on call 1 when skipFirstCall defaults true", () => {
    const ctx = makeContext({
      callNumber: 1,
      attributes: [attr("part1:OUT-01", 0.7)],
    });
    expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
  });

  it("fires on call 1 when skipFirstCall=false and evidence is present", () => {
    const ctx = makeContext({
      callNumber: 1,
      attributes: [attr("part1:OUT-01", 0.7)],
      config: { skipFirstCall: false, cadence: "every_call" },
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      observations: Array<{ loRef: string; score: number }>;
    } | null;
    expect(result).not.toBeNull();
    expect(result!.observations).toHaveLength(1);
    expect(result!.observations[0].loRef).toBe("OUT-01");
  });

  it("returns null when no callerAttributes match the :lo_mastery: pattern", () => {
    const ctx = makeContext({ attributes: [] });
    expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
  });

  it("default cadence ('on_threshold_crossing') filters out scores below minScoreDelta", () => {
    const ctx = makeContext({
      attributes: [
        attr("part1:OUT-01", 0.05), // below default 0.1
        attr("part1:OUT-02", 0.08), // below default 0.1
      ],
    });
    expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
  });

  it("default cadence emits observations for scores at/above minScoreDelta", () => {
    const ctx = makeContext({
      attributes: [
        attr("part1:OUT-01", 0.72),
        attr("part1:OUT-02", 0.05), // filtered out
        attr("part1:OUT-03", 0.55),
      ],
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      observations: Array<{ loRef: string; score: number }>;
      guidance: string[];
    };
    expect(result).not.toBeNull();
    expect(result.observations).toHaveLength(2);
    // Sorted highest-first.
    expect(result.observations[0].loRef).toBe("OUT-01");
    expect(result.observations[1].loRef).toBe("OUT-03");
  });

  it("'every_call' cadence emits anything > 0 (ignores minScoreDelta)", () => {
    const ctx = makeContext({
      attributes: [attr("part1:OUT-01", 0.05), attr("part1:OUT-02", 0.0)],
      config: { cadence: "every_call" },
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      observations: Array<{ loRef: string }>;
    };
    expect(result).not.toBeNull();
    expect(result.observations.map((o) => o.loRef)).toEqual(["OUT-01"]);
  });

  it("respects custom minScoreDelta", () => {
    const ctx = makeContext({
      attributes: [attr("part1:OUT-01", 0.45), attr("part1:OUT-02", 0.6)],
      config: { minScoreDelta: 0.5 },
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      observations: Array<{ loRef: string }>;
    };
    expect(result).not.toBeNull();
    expect(result.observations.map((o) => o.loRef)).toEqual(["OUT-02"]);
  });

  it("caps observations at 3 to keep the prompt lean", () => {
    const ctx = makeContext({
      attributes: [
        attr("m:OUT-01", 0.9),
        attr("m:OUT-02", 0.8),
        attr("m:OUT-03", 0.7),
        attr("m:OUT-04", 0.6),
        attr("m:OUT-05", 0.5),
      ],
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      observations: Array<{ loRef: string }>;
    };
    expect(result.observations).toHaveLength(3);
    expect(result.observations.map((o) => o.loRef)).toEqual([
      "OUT-01",
      "OUT-02",
      "OUT-03",
    ]);
  });

  it("strict-rule guidance contains the never-invent + cite-only-listed + at-most-one rules", () => {
    const ctx = makeContext({
      attributes: [attr("part1:OUT-01", 0.7)],
    });
    const result = transform!(null, ctx, STUB_SECTION) as {
      guidance: string[];
    };
    const guidanceText = result.guidance.join("\n");
    expect(guidanceText).toMatch(/never invent progress/i);
    expect(guidanceText).toMatch(/cite only the learning objectives listed/i);
    expect(guidanceText).toMatch(/at most one improvement per call/i);
    expect(guidanceText).toMatch(/do not recite the mastery percentage/i);
  });

  it("ignores callerAttributes outside the CURRICULUM scope", () => {
    const ctx = makeContext({
      attributes: [
        { key: "curriculum:IELTS:lo_mastery:m:OUT-01", scope: "OTHER", numberValue: 0.9 },
      ],
    });
    expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
  });

  describe("#928 — cross-course scoping by curriculumSpecSlug", () => {
    it("ignores lo_mastery rows whose key prefix names a different curriculum spec", () => {
      // Caller is enrolled in both spec-A (IELTS-SPEAKING — current) and
      // spec-B (WNF). Rows tagged with spec-B must not pollute the prompt
      // composed for spec-A.
      const ctx = makeContext({
        // currentSpec defaults to IELTS-SPEAKING via makeSharedState
        attributes: [
          // Sibling course — must be filtered out
          {
            key: "curriculum:WNF:lo_mastery:part1:OUT-01",
            scope: "CURRICULUM",
            numberValue: 0.95,
          },
          // Current course — must surface
          attr("part1:OUT-02", 0.6),
        ],
      });
      const result = transform!(null, ctx, STUB_SECTION) as {
        observations: Array<{ loRef: string; score: number }>;
      } | null;
      expect(result).not.toBeNull();
      // Only the current-curriculum row survives. The sibling-course row's
      // score (0.95) would have outranked the local 0.6 if it bled through.
      expect(result!.observations).toHaveLength(1);
      expect(result!.observations[0].loRef).toBe("OUT-02");
      expect(result!.observations[0].score).toBeCloseTo(0.6);
    });

    it("returns null when curriculumSpecSlug is undefined (graceful degrade, no throw)", () => {
      const ctx = makeContext({
        curriculumSpecSlug: undefined,
        attributes: [attr("part1:OUT-01", 0.9)],
      });
      // No throw, no observations — same shape as a caller with zero mastery.
      expect(transform!(null, ctx, STUB_SECTION)).toBeNull();
    });
  });
});
