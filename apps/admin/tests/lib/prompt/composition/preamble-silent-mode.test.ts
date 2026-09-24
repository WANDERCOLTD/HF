/**
 * preamble transform — #1956 (Boaz/Eldar gap analysis Unit 1.3)
 * silentMode suppression of baseline-assessment announcement framing.
 *
 * The module-scoped `silentMode` toggle on `AuthoredModuleSettings`,
 * when true, replaces the announced `BASELINE_ASSESSMENT_RULE` with
 * a silent variant that preserves diagnostic-only behaviour but
 * drops the "this is a test" / phase-break framing.
 *
 * Six pins:
 *   - silentMode true + matching lockedModule → silent variant injected
 *     (no "BASELINE_ASSESSMENT:" announcement, no "first call captures"
 *     phrasing); diagnostic envelope preserved
 *   - silentMode false → original announced rule (regression)
 *   - silentMode absent → original announced rule (regression)
 *   - silentMode true but no lockedModule → original announced rule
 *     (the module gate fails, the playbook-level firstCallMode still
 *     drives the announced default)
 *   - silentMode true but locked module slug doesn't match any
 *     AuthoredModule → announced (no module match → silentMode read
 *     resolves to false)
 *   - silentMode true AND firstCallMode = "baseline_assessment":
 *     contract test — the diagnostic structural directives ARE present
 *     (no teaching / no review / no corrections), and the test-
 *     announcement language is NOT (orthogonal-knobs invariant)
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prompts/spec-prompts", () => ({
  getPromptSpec: vi.fn(async () => "stubbed system instruction"),
}));

import "@/lib/prompt/composition/transforms/preamble";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  SharedComputedState,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

function makeSharedState(
  overrides: Partial<SharedComputedState> = {},
): SharedComputedState {
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

function makeContext(args: {
  silentMode?: boolean;
  withLockedModule?: boolean;
  lockedSlug?: string;
  matchById?: boolean;
} = {}): AssembledContext {
  const lockedSlug = args.lockedSlug ?? "baseline";
  const matchById = args.matchById ?? true;
  const authoredModule: AuthoredModule = {
    id: matchById ? lockedSlug : "other-module",
    label: "Baseline Assessment",
    learnerSelectable: true,
    mode: "examiner",
    duration: "20 min",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: true,
    frequency: "once",
    outcomesPrimary: [],
    prerequisites: [],
    settings:
      args.silentMode !== undefined ? { silentMode: args.silentMode } : {},
  };
  const playbookConfig: PlaybookConfig = {
    firstCallMode: "baseline_assessment",
    modules: [authoredModule],
  };
  return {
    sharedState: makeSharedState({
      lockedModule: args.withLockedModule === false
        ? null
        : ({
            id: lockedSlug,
            slug: lockedSlug,
            name: "Baseline Assessment",
          } as unknown as SharedComputedState["lockedModule"]),
    }),
    sections: {
      teachingContent: { hasTeachingContent: true },
    },
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
    resolvedSpecs: {
      voiceSpec: null,
    } as unknown as AssembledContext["resolvedSpecs"],
    specConfig: {},
  };
}

const STUB_SECTION: CompositionSectionDef = {
  id: "_preamble",
  name: "Preamble",
  priority: 1.0,
  dataSource: "_assembled",
  activateWhen: { condition: "always" },
  fallback: { action: "null" },
  transform: "computePreamble",
  outputKey: "_preamble",
};

interface PreambleOutput {
  criticalRules: string[];
}

const transform = getTransform("computePreamble")!;

describe("computePreamble — #1956 silentMode suppression", () => {
  it("silentMode true + matching lockedModule → silent variant (no announcement)", async () => {
    const ctx = makeContext({ silentMode: true });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    // Announced phrasing absent.
    expect(rulesText).not.toMatch(/BASELINE_ASSESSMENT:/);
    expect(rulesText).not.toMatch(/first call captures diagnostic evidence/i);
    // Silent variant explicitly tells the tutor NOT to announce.
    expect(rulesText).toMatch(/Do NOT announce that this is a test/i);
    expect(rulesText).toMatch(/Do NOT signal phase boundaries/i);
  });

  it("silentMode false → original announced BASELINE_ASSESSMENT_RULE (regression)", async () => {
    const ctx = makeContext({ silentMode: false });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).toMatch(/BASELINE_ASSESSMENT:/);
    expect(rulesText).toMatch(/first call captures diagnostic evidence/i);
  });

  it("silentMode absent → original announced rule (regression — existing playbooks unchanged)", async () => {
    const ctx = makeContext({});
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).toMatch(/BASELINE_ASSESSMENT:/);
  });

  it("silentMode true but no lockedModule → original announced rule (module gate fails)", async () => {
    const ctx = makeContext({ silentMode: true, withLockedModule: false });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).toMatch(/BASELINE_ASSESSMENT:/);
  });

  it("silentMode true but no matching AuthoredModule → original announced rule", async () => {
    const ctx = makeContext({ silentMode: true, matchById: false });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    expect(rulesText).toMatch(/BASELINE_ASSESSMENT:/);
  });

  it("orthogonal-knobs invariant — diagnostic envelope preserved when silentMode active", async () => {
    const ctx = makeContext({ silentMode: true });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    // Diagnostic-only structural directives MUST still be present
    // (the silent variant changes wording, not behavioural envelope).
    expect(rulesText).toMatch(/no teaching/i);
    expect(rulesText).toMatch(/no review/i);
    expect(rulesText).toMatch(/no remediation/i);
    expect(rulesText).toMatch(/no corrections/i);
    expect(rulesText).toMatch(/never lead the learner to a correct answer/i);
  });

  it("silentMode + firstCallMode coexist — pedagogy rules still injected", async () => {
    const ctx = makeContext({ silentMode: true });
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;
    const rulesText = out.criticalRules.join("\n");
    // Universal pedagogy rules apply to both variants.
    expect(rulesText).toMatch(/Before referencing any rubric level/);
    expect(rulesText).toMatch(/Never describe your own context/);
  });
});
