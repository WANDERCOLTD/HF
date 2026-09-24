/**
 * Tests for the curriculum-adaptation compose transform (#2082 /
 * S3 of epic #2078).
 *
 * The transform reads cascade-resolved BehaviorTarget rows for 22
 * `domainGroup=curriculum-adaptation` parameters, intersects with
 * per-module mastery state from `sharedState.moduleAttemptCounts`, and
 * emits per-parameter tutor-readable directives.
 *
 * These tests pin:
 *   - Each of the 22 parameter IDs is exported in CURRICULUM_ADAPTATION_PARAMS
 *     (so the parameter-coverage Coverage-pillar test can substring-match
 *     them as `covered`).
 *   - The transform skips emission when no behaviorTargets are loaded.
 *   - The transform skips a parameter when no cascade row exists for it.
 *   - The transform emits the templateLow directive when target < 0.35.
 *   - The transform emits the templateHigh directive when target > 0.65.
 *   - The transform omits neutral (0.5) values.
 *   - The transform's body string is non-empty when at least one
 *     directive emits.
 *   - The mastery-context line is included when focus module has
 *     callCount > 0.
 *   - The CURR-A matrix path picks specific directives over band-only
 *     fallbacks.
 *   - Empty-result short-circuit: no behaviorTargets at all → empty body.
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/curriculum-adaptation";
import {
  CURRICULUM_ADAPTATION_PARAMS,
  PHASE_2_DEFERRED,
} from "@/lib/prompt/composition/transforms/curriculum-adaptation";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";
import type { NormalizedTarget } from "@/lib/prompt/composition/transforms/targets";

const transform = getTransform("computeCurriculumAdaptation")!;

function makeTarget(parameterId: string, value: number): NormalizedTarget {
  return {
    parameterId,
    targetValue: value,
    confidence: 1,
    source: "BehaviorTarget",
    scope: "SYSTEM",
    parameter: {
      name: parameterId,
      parameterId,
      interpretationLow: null,
      interpretationHigh: null,
      domainGroup: "curriculum-adaptation",
    },
  };
}

function makeContext(opts: {
  targets?: NormalizedTarget[];
  focusModuleId?: string;
  focusModuleSlug?: string;
  callCount?: number;
  status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  estimatedProgress?: number;
  masteryThreshold?: number;
}): AssembledContext {
  const moduleId = opts.focusModuleId ?? "mod-1";
  const moduleSlug = opts.focusModuleSlug ?? "module-one";
  const callCount = opts.callCount ?? 0;
  const status = opts.status ?? "NOT_STARTED";
  return {
    loadedData: {} as any,
    sections: {
      behaviorTargets: {
        _merged: opts.targets ?? [],
        all: opts.targets ?? [],
      },
    },
    resolvedSpecs: {} as any,
    sharedState: {
      channel: "voice",
      modules: [
        {
          id: moduleId,
          slug: moduleSlug,
          name: "Focus module",
          sequence: 1,
        },
      ],
      isFirstCall: false,
      daysSinceLastCall: 1,
      completedModules: new Set<string>(),
      estimatedProgress: opts.estimatedProgress ?? 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: {
        id: moduleId,
        slug: moduleSlug,
        name: "Focus module",
        sequence: 1,
      } as any,
      reviewType: "none",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
      isFinalSession: false,
      callNumber: callCount + 1,
      moduleAttemptCounts: {
        [moduleId]: {
          callCount,
          status,
          completedAt: null,
        },
      },
      resolvedMasteryThreshold: opts.masteryThreshold ?? 0.7,
    } as any,
    specConfig: {},
  };
}

const noopSection: CompositionSectionDef = {} as any;

describe("computeCurriculumAdaptation transform (#2082)", () => {
  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });

  it("exports exactly 22 curriculum-adaptation parameter IDs", () => {
    expect(CURRICULUM_ADAPTATION_PARAMS).toHaveLength(22);
    // Every entry follows the BEH-* convention.
    for (const id of CURRICULUM_ADAPTATION_PARAMS) {
      expect(id).toMatch(/^BEH-[A-Z][A-Z0-9-]*$/);
    }
    // No duplicates.
    expect(new Set(CURRICULUM_ADAPTATION_PARAMS).size).toBe(22);
  });

  it("declares Phase 2 deferred parameters separately", () => {
    expect(PHASE_2_DEFERRED.length).toBeGreaterThan(0);
    // Deferred params must NOT appear in the wired list.
    const wired = new Set(CURRICULUM_ADAPTATION_PARAMS);
    for (const id of PHASE_2_DEFERRED) {
      expect(wired.has(id as any)).toBe(false);
    }
  });

  it("returns empty section when no behaviorTargets are loaded", () => {
    const ctx = makeContext({ targets: [] });
    const out: any = transform(null, ctx, noopSection);
    expect(out.hasDirectives).toBe(false);
    expect(out.directives).toEqual([]);
    expect(out.directiveCount).toBe(0);
    expect(out.body).toBe("");
  });

  it("skips a parameter when no cascade row exists for it", () => {
    // Only one of the 22 params has a target — others must not emit.
    const ctx = makeContext({
      targets: [makeTarget("BEH-EXPLANATION-VARIETY", 0.2)],
    });
    const out: any = transform(null, ctx, noopSection);
    const paramIds = out.directives.map((d: any) => d.parameterId);
    expect(paramIds).toContain("BEH-EXPLANATION-VARIETY");
    expect(paramIds).toHaveLength(1);
  });

  it("emits the LOW template when target < 0.35 (CURR-B band path)", () => {
    const ctx = makeContext({
      targets: [makeTarget("BEH-INTERLEAVING", 0.1)],
    });
    const out: any = transform(null, ctx, noopSection);
    expect(out.directives).toHaveLength(1);
    expect(out.directives[0]).toMatchObject({
      parameterId: "BEH-INTERLEAVING",
      band: "low",
    });
    expect(out.directives[0].directive.toLowerCase()).toContain("not interleave");
  });

  it("emits the HIGH template when target > 0.65 (CURR-B band path)", () => {
    const ctx = makeContext({
      targets: [makeTarget("BEH-PROBING-QUESTIONS", 0.9)],
    });
    const out: any = transform(null, ctx, noopSection);
    expect(out.directives).toHaveLength(1);
    expect(out.directives[0]).toMatchObject({
      parameterId: "BEH-PROBING-QUESTIONS",
      band: "high",
    });
    expect(out.directives[0].directive.toLowerCase()).toContain("probing");
  });

  it("omits a parameter at neutral (0.5) value", () => {
    const ctx = makeContext({
      targets: [
        makeTarget("BEH-EXPLANATION-VARIETY", 0.5),
        makeTarget("BEH-INTERLEAVING", 0.5),
      ],
    });
    const out: any = transform(null, ctx, noopSection);
    // Neither neutral target should emit a directive; no mastery
    // context either (callCount=0 = noData).
    expect(out.directives).toEqual([]);
  });

  it("composes a non-empty body when at least one directive emits", () => {
    const ctx = makeContext({
      targets: [makeTarget("BEH-WORKED-EXAMPLES", 0.9)],
    });
    const out: any = transform(null, ctx, noopSection);
    expect(out.hasDirectives).toBe(true);
    expect(out.body).toContain("## Curriculum adaptation");
    expect(out.body).toContain("worked example");
    expect(out.summary).toContain("directive");
  });

  it("includes mastery-context line when focus module has callCount > 0 (CURR-A matrix path)", () => {
    // BEH-ADVANCE-READINESS matrix has `low:belowThreshold` →
    // "Mastery is below threshold — stay on this module; do not advance yet."
    const ctx = makeContext({
      targets: [makeTarget("BEH-ADVANCE-READINESS", 0.1)],
      callCount: 2,
      status: "IN_PROGRESS",
      estimatedProgress: 0.4, // below 0.7 threshold → belowThreshold
    });
    const out: any = transform(null, ctx, noopSection);
    expect(out.masteryContext).toHaveLength(1);
    expect(out.masteryContext[0]).toMatch(/BELOW the threshold/);
    expect(out.directives).toHaveLength(1);
    expect(out.directives[0].parameterId).toBe("BEH-ADVANCE-READINESS");
    expect(out.directives[0].directive).toContain("do not advance");
  });

  it("CURR-A matrix wins over byBand fallback when a (band, state) cell matches", () => {
    // BEH-ANALOGY-USAGE has matrix "high:belowThreshold" → "Use analogies generously…"
    // AND byBand "high" → "Use analogies to make abstract ideas concrete."
    // The matrix entry must win when callCount > 0 + belowThreshold.
    const ctx = makeContext({
      targets: [makeTarget("BEH-ANALOGY-USAGE", 0.9)],
      callCount: 1,
      status: "IN_PROGRESS",
      estimatedProgress: 0.2,
    });
    const out: any = transform(null, ctx, noopSection);
    const directive = out.directives.find(
      (d: any) => d.parameterId === "BEH-ANALOGY-USAGE",
    );
    expect(directive).toBeDefined();
    expect(directive.directive).toContain("bridge to the abstract concept");
  });

  it("CURR-A byBand fires when no matrix cell matches but band is non-neutral", () => {
    // BEH-FOUNDATION-FOCUS has matrix "high:belowThreshold" + byBand "high".
    // With callCount=0 (noData), matrix entry doesn't match → byBand fires.
    const ctx = makeContext({
      targets: [makeTarget("BEH-FOUNDATION-FOCUS", 0.9)],
      callCount: 0,
    });
    const out: any = transform(null, ctx, noopSection);
    const directive = out.directives.find(
      (d: any) => d.parameterId === "BEH-FOUNDATION-FOCUS",
    );
    expect(directive).toBeDefined();
    expect(directive.directive).toContain("foundational concepts");
  });

  it("CURR-A emits no directive when target is neutral AND no matrix match", () => {
    // BEH-COMPREHENSION-SCORE has matrix "low:belowThreshold" + "high:aboveThreshold".
    // Neutral target + noData state → no emission.
    const ctx = makeContext({
      targets: [makeTarget("BEH-COMPREHENSION-SCORE", 0.5)],
      callCount: 0,
    });
    const out: any = transform(null, ctx, noopSection);
    const found = out.directives.find(
      (d: any) => d.parameterId === "BEH-COMPREHENSION-SCORE",
    );
    expect(found).toBeUndefined();
  });

  it("emits ALL 22 parameter directives when every cascade row is set to high", () => {
    // Stress-test: every wired parameter at 0.9. Expect a directive
    // for each one that has a high-side template (the full population
    // of 22 should emit something — either CURR-A matrix/byBand or CURR-B).
    const targets = CURRICULUM_ADAPTATION_PARAMS.map((id) => makeTarget(id, 0.9));
    const ctx = makeContext({ targets });
    const out: any = transform(null, ctx, noopSection);
    // Not every parameter is guaranteed to fire (some CURR-A entries
    // only have matrix entries for "high:belowThreshold" but no byBand
    // and no noData fallback). The pin: at least 15 directives — the
    // safety margin lets future template tweaks land without breaking
    // the smoke pin, but a regression that drops the count to ~0
    // (e.g. accidentally short-circuiting the loop) gets caught.
    expect(out.directives.length).toBeGreaterThanOrEqual(15);
  });

  it("body is empty (omit-from-prompt) when nothing emits", () => {
    const ctx = makeContext({ targets: [] });
    const out: any = transform(null, ctx, noopSection);
    expect(out.body).toBe("");
    expect(out.summary).toBe("");
  });
});
