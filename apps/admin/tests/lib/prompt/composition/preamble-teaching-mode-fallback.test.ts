/**
 * preamble transform — defensive fallback when `Playbook.config.teachingMode`
 * holds a value outside the `TeachingMode` union.
 *
 * Live incident on hf_sandbox 2026-06-18: the IELTS Speaking Practice
 * playbook had `Playbook.config.teachingMode = "directive"`. That's a
 * value from the `interactionPattern` union, cross-wired into the wrong
 * field by a wizard or seed path. The TypeScript cast in the previous
 * `readPlaybookTeachingMode` lied at runtime; the unknown key indexed
 * `RETURNING_CALLER_BY_MODE` to `undefined`; that `undefined` landed at
 * `criticalRules[3]`; Prisma rejected the array with "Can not use
 * undefined value within array". Every compose for every learner on
 * that playbook crashed silently — the test-learner button worked but
 * the next sim turn failed at ComposedPrompt.create.
 *
 * These tests pin the defensive contract: an unknown teachingMode MUST
 * be treated as "not set" (falls through to recall) and MUST NOT leak
 * an undefined into the criticalRules array. Same guard applies to
 * non-string DB values (legacy seed could plausibly land null / number /
 * object given the JSON column accepts anything).
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

function makeSharedState(): SharedComputedState {
  return {
    channel: "text",
    modules: [
      { id: "m1", name: "Module 1", description: "test" } as unknown as SharedComputedState["modules"][number],
    ],
    // isFirstCall=false so we hit the RETURNING_CALLER branch, not the
    // first-call short-circuit. That's where the `criticalRules[3]`
    // undefined would have landed.
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
  };
}

function makeContext(teachingMode: unknown): AssembledContext {
  const playbookConfig: Record<string, unknown> = {};
  if (teachingMode !== undefined) playbookConfig.teachingMode = teachingMode;

  return {
    sharedState: makeSharedState(),
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
          name: "Test Playbook",
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

describe("computePreamble — defensive fallback for unknown teachingMode", () => {
  it("'directive' (the live 2026-06-18 IELTS bad value) → no undefined, falls to recall", async () => {
    const ctx = makeContext("directive");
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;

    // The exact crash shape: any undefined inside criticalRules would
    // have failed `composedPrompt.create()` at Prisma's array validation.
    expect(out.criticalRules.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    expect(out.criticalRules).not.toContain(undefined);

    // Falls through to recall (matches "no teachingMode at all" branch).
    const text = out.criticalRules.join("\n");
    expect(text).toMatch(/ALWAYS review before new material/);
  });

  it.each([
    ["null", null],
    ["number", 42],
    ["object", { foo: "bar" }],
    ["boolean", true],
    ["empty string", ""],
    ["arbitrary string", "totally-made-up-mode"],
  ] as const)(
    "non-union value (%s) → no undefined, falls to recall",
    async (_label, value) => {
      const ctx = makeContext(value);
      const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;

      expect(out.criticalRules.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
      expect(out.criticalRules).not.toContain(undefined);
      expect(out.criticalRules.join("\n")).toMatch(/ALWAYS review before new material/);
    },
  );

  it("absent teachingMode (the pre-existing 'not set' branch) → falls to recall", async () => {
    const ctx = makeContext(undefined);
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;

    expect(out.criticalRules.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    expect(out.criticalRules.join("\n")).toMatch(/ALWAYS review before new material/);
  });

  it("valid mode still works (regression on the happy path)", async () => {
    const ctx = makeContext("practice");
    const out = (await transform(null, ctx, STUB_SECTION)) as PreambleOutput;

    expect(out.criticalRules.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    // 'practice' archetype: warm-up attempt instead of review.
    expect(out.criticalRules.join("\n")).toMatch(/warm-up attempt/);
  });
});
