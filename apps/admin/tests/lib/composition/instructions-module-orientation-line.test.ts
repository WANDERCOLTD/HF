/**
 * #1735 (epic #1730 G8 consumer D) — `computeInstructions` surfaces
 * `module_orientation_line` when the learner has never seen this
 * module's orientation yet.
 *
 * Pins:
 *   - flag-off → null
 *   - flag-on + matching settings + orientationShown=false → directive
 *   - orientationShown=true → null (gate hit)
 *   - no lockedModule → null
 *   - no matching authored module → null
 *   - missing / empty firstTimeOrientationLine → null
 *   - missing CallerModuleProgress row (no `orientationShown` to read) →
 *     treats as not-shown (first attempt — show the line)
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
  orientationLine?: string;
  orientationShown?: boolean | null;
  lockedId?: string;
  matchById?: boolean;
  noLockedModule?: boolean;
  noProgressRow?: boolean;
} = {}): AssembledContext {
  const lockedId = opts.lockedId ?? "part2";
  const matchById = opts.matchById ?? true;
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedId : "other-id",
    label: "Part 2",
    learnerSelectable: true,
    mode: "tutor",
    duration: "4 min",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    settings:
      opts.orientationLine !== undefined
        ? { firstTimeOrientationLine: opts.orientationLine }
        : {},
  };
  const playbookConfig: PlaybookConfig = { modules: [authoredModule] };

  const callerModuleProgress = opts.noProgressRow
    ? []
    : [{ moduleId: lockedId, orientationShown: opts.orientationShown ?? false }];

  return {
    sharedState: makeSharedState({
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
      ...({ callerModuleProgress } as Record<string, unknown>),
    } as AssembledContext["loadedData"],
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
const LINE = 'In Part 2 you will speak for 2 minutes about a familiar topic.';

describe("computeInstructions — module_orientation_line (#1735)", () => {
  describe("HF_FLAG_IELTS_MODULE_SETTINGS gating", () => {
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when the flag is off (default)", async () => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
      const ctx = makeContext({ orientationLine: LINE, orientationShown: false });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });

    it("emits directive when flag on + first attempt (orientationShown=false)", async () => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
      const ctx = makeContext({ orientationLine: LINE, orientationShown: false });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: { line: string; directive: string } | null;
      };
      expect(result.module_orientation_line).not.toBeNull();
      expect(result.module_orientation_line!.line).toBe(LINE);
      expect(result.module_orientation_line!.directive).toContain(LINE);
      expect(result.module_orientation_line!.directive).toContain(
        "FIRST-TIME ORIENTATION",
      );
    });
  });

  describe("orientationShown gate", () => {
    beforeEach(() => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    });
    afterEach(() => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    });

    it("returns null when orientationShown=true (already shown)", async () => {
      const ctx = makeContext({ orientationLine: LINE, orientationShown: true });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });

    it("emits when no CallerModuleProgress row exists (first attempt)", async () => {
      const ctx = makeContext({ orientationLine: LINE, noProgressRow: true });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: { line: string } | null;
      };
      expect(result.module_orientation_line).not.toBeNull();
      expect(result.module_orientation_line!.line).toBe(LINE);
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
      const ctx = makeContext({
        orientationLine: LINE,
        orientationShown: false,
        noLockedModule: true,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });

    it("returns null when no matching authored module", async () => {
      const ctx = makeContext({
        orientationLine: LINE,
        orientationShown: false,
        matchById: false,
      });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });

    it("returns null when firstTimeOrientationLine is missing", async () => {
      const ctx = makeContext({ orientationShown: false });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });

    it("returns null when firstTimeOrientationLine is whitespace-only", async () => {
      const ctx = makeContext({ orientationLine: "   ", orientationShown: false });
      const result = (await transform(null, ctx, STUB_SECTION)) as {
        module_orientation_line: unknown;
      };
      expect(result.module_orientation_line).toBeNull();
    });
  });
});
