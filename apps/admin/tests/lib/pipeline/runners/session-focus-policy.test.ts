/**
 * Behavioural tests for `lib/pipeline/runners/session-focus-policy.ts`
 * (#2145 Phase A — Generic SessionFocus 4th-layer substrate, S3).
 *
 * Pins:
 *   - Pure function `pickWeakestAndMap` correctly picks the lowest
 *     `currentScore` among the spec's inputSkills.
 *   - Returns null when ALL inputSkills have null currentScore
 *     (HONEST EMPTY STATE — no hardcoded fallback).
 *   - Returns null when the picked weakest parameter has no matching
 *     `whenWeakest` rule.
 *   - `moduleSlugMatchesScope` enforces the optional gate.
 *   - `isSessionFocusPolicyConfig` correctly type-guards.
 *   - End-to-end `runSessionFocusPolicy`:
 *     - writes via prisma.callerAttribute.upsert when conditions met
 *     - skips with operator-traceable status code on each empty path
 *     - never writes when no scored input rows exist
 *     - writes the LEARNER-facing label (not the internal parameter id)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallerAttributeUpsert = vi.fn();
const mockCallerTargetFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerAttribute: { upsert: (...args: unknown[]) => mockCallerAttributeUpsert(...args) },
    callerTarget: { findMany: (...args: unknown[]) => mockCallerTargetFindMany(...args) },
  },
}));

import {
  pickWeakestAndMap,
  moduleSlugMatchesScope,
  isSessionFocusPolicyConfig,
  runSessionFocusPolicy,
  type SessionFocusPolicyConfig,
} from "@/lib/pipeline/runners/session-focus-policy";

const FC = "skill_fluency_and_coherence_fc";
const LR = "skill_lexical_resource_lr";
const GRA = "skill_grammatical_range_and_accuracy_gra";
const P = "skill_pronunciation_p";

const IELTS_P3_CONFIG: SessionFocusPolicyConfig = {
  category: "session-focus-policy",
  inputSkills: [FC, LR, GRA, P],
  outputUnion: "Part3TechniqueFocus",
  selectionRules: [
    { whenWeakest: FC, thenLabel: "structuring an argument" },
    { whenWeakest: LR, thenLabel: "expanding an answer" },
    { whenWeakest: GRA, thenLabel: "giving reasons" },
    { whenWeakest: P, thenLabel: "handling a challenge" },
  ],
  writeKey: "session_focus:next_part3",
  moduleScope: { slugPattern: "part3" },
};

beforeEach(() => {
  mockCallerAttributeUpsert.mockReset();
  mockCallerTargetFindMany.mockReset();
  mockCallerAttributeUpsert.mockResolvedValue({});
});

describe("pickWeakestAndMap (pure)", () => {
  it("picks the parameter with the lowest currentScore", () => {
    const picked = pickWeakestAndMap(
      [
        { parameterId: FC, currentScore: 0.7 },
        { parameterId: LR, currentScore: 0.3 },
        { parameterId: GRA, currentScore: 0.55 },
        { parameterId: P, currentScore: 0.62 },
      ],
      IELTS_P3_CONFIG,
    );
    expect(picked).toEqual({
      weakestParameterId: LR,
      label: "expanding an answer",
    });
  });

  it("skips rows where currentScore is null", () => {
    const picked = pickWeakestAndMap(
      [
        { parameterId: FC, currentScore: null },
        { parameterId: LR, currentScore: null },
        { parameterId: GRA, currentScore: 0.55 },
        { parameterId: P, currentScore: 0.8 },
      ],
      IELTS_P3_CONFIG,
    );
    expect(picked).toEqual({
      weakestParameterId: GRA,
      label: "giving reasons",
    });
  });

  it("returns null when NO inputSkills have a finite currentScore (honest empty state)", () => {
    const picked = pickWeakestAndMap(
      [
        { parameterId: FC, currentScore: null },
        { parameterId: LR, currentScore: null },
      ],
      IELTS_P3_CONFIG,
    );
    expect(picked).toBeNull();
  });

  it("returns null when the picked parameter has no matching selectionRule", () => {
    const partialConfig: SessionFocusPolicyConfig = {
      ...IELTS_P3_CONFIG,
      selectionRules: [
        { whenWeakest: FC, thenLabel: "structuring an argument" },
        // LR / GRA / P unmapped
      ],
    };
    const picked = pickWeakestAndMap(
      [{ parameterId: LR, currentScore: 0.4 }],
      partialConfig,
    );
    expect(picked).toBeNull();
  });

  it("ignores parameters NOT in inputSkills (defensive)", () => {
    const picked = pickWeakestAndMap(
      [
        { parameterId: "skill_some_other", currentScore: 0.05 }, // not in inputSkills
        { parameterId: LR, currentScore: 0.4 },
        { parameterId: GRA, currentScore: 0.6 },
      ],
      IELTS_P3_CONFIG,
    );
    expect(picked).toEqual({
      weakestParameterId: LR,
      label: "expanding an answer",
    });
  });

  it("deterministic on ties — picks the FIRST encountered with the min score", () => {
    const picked = pickWeakestAndMap(
      [
        { parameterId: LR, currentScore: 0.4 },
        { parameterId: GRA, currentScore: 0.4 },
      ],
      IELTS_P3_CONFIG,
    );
    expect(picked!.weakestParameterId).toBe(LR);
  });
});

describe("moduleSlugMatchesScope (pure)", () => {
  it("returns true when no pattern declared (no gate)", () => {
    const noScope: SessionFocusPolicyConfig = {
      ...IELTS_P3_CONFIG,
      moduleScope: undefined,
    };
    expect(moduleSlugMatchesScope("anything", noScope)).toBe(true);
  });

  it("matches substring case-insensitively", () => {
    expect(moduleSlugMatchesScope("ielts-part3", IELTS_P3_CONFIG)).toBe(true);
    expect(moduleSlugMatchesScope("Part3-Discussion", IELTS_P3_CONFIG)).toBe(true);
    expect(moduleSlugMatchesScope("part1", IELTS_P3_CONFIG)).toBe(false);
    expect(moduleSlugMatchesScope("mock", IELTS_P3_CONFIG)).toBe(false);
  });
});

describe("isSessionFocusPolicyConfig (type guard)", () => {
  it("accepts a valid config", () => {
    expect(isSessionFocusPolicyConfig(IELTS_P3_CONFIG)).toBe(true);
  });

  it("rejects null / undefined / non-object", () => {
    expect(isSessionFocusPolicyConfig(null)).toBe(false);
    expect(isSessionFocusPolicyConfig(undefined)).toBe(false);
    expect(isSessionFocusPolicyConfig("string")).toBe(false);
    expect(isSessionFocusPolicyConfig(42)).toBe(false);
  });

  it("rejects configs with the wrong category", () => {
    expect(
      isSessionFocusPolicyConfig({
        category: "something-else",
        inputSkills: [],
        selectionRules: [],
      }),
    ).toBe(false);
  });

  it("rejects configs missing arrays", () => {
    expect(
      isSessionFocusPolicyConfig({
        category: "session-focus-policy",
      }),
    ).toBe(false);
  });
});

describe("runSessionFocusPolicy (end-to-end, mocked prisma)", () => {
  it("writes ONE CallerAttribute when conditions are met — uses canonical chokepoint shape", async () => {
    mockCallerTargetFindMany.mockResolvedValue([
      { parameterId: FC, currentScore: 0.7 },
      { parameterId: LR, currentScore: 0.3 },
      { parameterId: GRA, currentScore: 0.55 },
      { parameterId: P, currentScore: 0.62 },
    ]);

    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: IELTS_P3_CONFIG,
      lockedModule: { slug: "part3", id: "part3" },
    });

    expect(result.status).toBe("wrote");
    expect(result.weakestParameterId).toBe(LR);
    expect(result.writtenLabel).toBe("expanding an answer");
    expect(result.writeKey).toBe("session_focus:next_part3");

    expect(mockCallerAttributeUpsert).toHaveBeenCalledTimes(1);
    const call = mockCallerAttributeUpsert.mock.calls[0]![0] as {
      where: {
        callerId_key_scope: { callerId: string; key: string; scope: string };
      };
      create: { stringValue: string; valueType: string; sourceSpecSlug: string };
      update: { stringValue: string };
    };
    expect(call.where.callerId_key_scope.callerId).toBe("caller-x");
    expect(call.where.callerId_key_scope.key).toBe("session_focus:next_part3");
    expect(call.where.callerId_key_scope.scope).toBe("IELTS-P3-FOCUS-001");
    expect(call.create.stringValue).toBe("expanding an answer");
    expect(call.create.valueType).toBe("STRING");
    expect(call.create.sourceSpecSlug).toBe("IELTS-P3-FOCUS-001");
    // The written value is the LEARNER-facing label, NOT the internal
    // parameter id — the core architectural invariant of the substrate.
    expect(call.create.stringValue).not.toContain("skill_");
  });

  it("writes NOTHING when ALL inputSkills have null currentScore (honest empty state)", async () => {
    mockCallerTargetFindMany.mockResolvedValue([
      { parameterId: FC, currentScore: null },
      { parameterId: LR, currentScore: null },
      { parameterId: GRA, currentScore: null },
      { parameterId: P, currentScore: null },
    ]);

    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: IELTS_P3_CONFIG,
      lockedModule: { slug: "part3", id: "part3" },
    });

    expect(result.status).toBe("skipped:no-scored-inputs");
    expect(result.writtenLabel).toBeNull();
    expect(mockCallerAttributeUpsert).not.toHaveBeenCalled();
  });

  it("writes NOTHING and returns skipped:no-locked-module when lockedModule is null", async () => {
    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: IELTS_P3_CONFIG,
      lockedModule: null,
    });

    expect(result.status).toBe("skipped:no-locked-module");
    expect(mockCallerAttributeUpsert).not.toHaveBeenCalled();
    expect(mockCallerTargetFindMany).not.toHaveBeenCalled();
  });

  it("skips with module-scope-gate status when locked module doesn't match scope", async () => {
    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: IELTS_P3_CONFIG,
      lockedModule: { slug: "part1", id: "part1" }, // doesn't match "part3" scope
    });

    expect(result.status).toBe("skipped:module-scope-gate");
    expect(mockCallerAttributeUpsert).not.toHaveBeenCalled();
    expect(mockCallerTargetFindMany).not.toHaveBeenCalled();
  });

  it("skips with invalid-config status when config is malformed", async () => {
    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "BAD-SPEC",
      config: { category: "session-focus-policy" } as SessionFocusPolicyConfig,
      lockedModule: { slug: "part3", id: "part3" },
    });

    expect(result.status).toBe("skipped:invalid-config");
    expect(mockCallerAttributeUpsert).not.toHaveBeenCalled();
  });

  it("skips with no-rule-for-weakest when picked param has no matching selectionRule", async () => {
    const partialConfig: SessionFocusPolicyConfig = {
      ...IELTS_P3_CONFIG,
      selectionRules: [
        { whenWeakest: FC, thenLabel: "structuring an argument" },
      ],
    };
    mockCallerTargetFindMany.mockResolvedValue([
      { parameterId: LR, currentScore: 0.3 }, // weakest, but no rule for LR
    ]);

    const result = await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: partialConfig,
      lockedModule: { slug: "part3", id: "part3" },
    });

    expect(result.status).toBe("skipped:no-rule-for-weakest");
    expect(mockCallerAttributeUpsert).not.toHaveBeenCalled();
  });

  it("queries CallerTarget scoped to the spec's inputSkills + callerId", async () => {
    mockCallerTargetFindMany.mockResolvedValue([
      { parameterId: LR, currentScore: 0.3 },
    ]);

    await runSessionFocusPolicy({
      callerId: "caller-x",
      specSlug: "IELTS-P3-FOCUS-001",
      config: IELTS_P3_CONFIG,
      lockedModule: { slug: "part3", id: "part3" },
    });

    expect(mockCallerTargetFindMany).toHaveBeenCalledTimes(1);
    const arg = mockCallerTargetFindMany.mock.calls[0]![0] as {
      where: { callerId: string; parameterId: { in: string[] } };
    };
    expect(arg.where.callerId).toBe("caller-x");
    expect(arg.where.parameterId.in).toEqual([FC, LR, GRA, P]);
  });
});

/**
 * #2154 dispatch integration — the pipeline route at
 * `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.ADAPT`
 * fans CALLER_ATTRIBUTE_NEXT-typed AnalysisSpecs to this runner.
 * The full integration lives in route.ts (with a live prisma context);
 * we pin the dispatch *shape contract* here: any object that satisfies
 * `isSessionFocusPolicyConfig` and is paired with a non-null lockedModule
 * MUST be runnable end-to-end without additional validation hoops.
 *
 * The contract this test pins: a spec.config retrieved from
 * `prisma.analysisSpec.findMany({where: {outputType: "CALLER_ATTRIBUTE_NEXT"}})`
 * — whose `config` is `JsonValue` — can be passed to `runSessionFocusPolicy`
 * after a single `isSessionFocusPolicyConfig` type-guard.
 */
describe("CALLER_ATTRIBUTE_NEXT dispatch contract (#2154)", () => {
  it("a JsonValue spec.config passing isSessionFocusPolicyConfig runs end-to-end", async () => {
    // Simulate what `getSpecsByOutputType("CALLER_ATTRIBUTE_NEXT")` →
    // `prisma.analysisSpec.findMany({select: {config: true}})` returns —
    // a Prisma JsonValue payload that needs the type guard to narrow.
    const jsonConfig: unknown = {
      category: "session-focus-policy",
      inputSkills: [FC, LR, GRA, P],
      outputUnion: "Part3TechniqueFocus",
      selectionRules: [
        { whenWeakest: FC, thenLabel: "structuring an argument" },
        { whenWeakest: LR, thenLabel: "expanding an answer" },
        { whenWeakest: GRA, thenLabel: "giving reasons" },
        { whenWeakest: P, thenLabel: "handling a challenge" },
      ],
      writeKey: "session_focus:next_part3",
      moduleScope: { slugPattern: "part3" },
    };

    // Type guard narrows JsonValue → SessionFocusPolicyConfig.
    expect(isSessionFocusPolicyConfig(jsonConfig)).toBe(true);

    if (!isSessionFocusPolicyConfig(jsonConfig)) {
      throw new Error("unreachable — guard passed above");
    }

    mockCallerTargetFindMany.mockResolvedValue([
      { parameterId: LR, currentScore: 0.25 },
    ]);

    const result = await runSessionFocusPolicy({
      callerId: "caller-dispatch",
      specSlug: "IELTS-P3-FOCUS-001",
      config: jsonConfig,
      lockedModule: { slug: "ielts-part3-discussion", id: "mod-id" },
    });

    expect(result.status).toBe("wrote");
    expect(result.writtenLabel).toBe("expanding an answer");
    expect(result.writeKey).toBe("session_focus:next_ielts-part3-discussion");
    expect(mockCallerAttributeUpsert).toHaveBeenCalledTimes(1);
  });
});
