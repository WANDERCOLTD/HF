/**
 * Tests for the companionDirectives transform (#2085 — S5 of epic #2078).
 *
 * The transform reads `sections.behaviorTargets._merged` (the cascade-
 * resolved BehaviorTarget list produced by `mergeAndGroupTargets`) and
 * emits one tutor directive per non-neutral companion-domain parameter
 * the caller has a target row for. These tests verify:
 *
 *   - all 12 producer-only COMP-* parameters are wired
 *   - HIGH classification emits `whenHigh` copy
 *   - LOW classification emits `whenLow` copy
 *   - MODERATE / neutral values are silently skipped
 *   - parameters with no merged target are skipped (null-effective)
 *   - returns null when nothing emits (empty/all-neutral)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import {
  COMPANION_PARAMETER_IDS,
  type CompanionDirectivesOutput,
} from "@/lib/prompt/composition/transforms/companion";
import type {
  AssembledContext,
  CompositionSectionDef,
} from "@/lib/prompt/composition/types";

// Trigger transform registration.
import "@/lib/prompt/composition/transforms/companion";

function makeContext(
  mergedTargets: Array<{ parameterId: string; targetValue: number }>,
): AssembledContext {
  return {
    loadedData: {
      caller: {
        id: "c1",
        name: "Test",
        email: null,
        phone: null,
        externalId: null,
        domain: null,
      },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {
      behaviorTargets: {
        _merged: mergedTargets.map((t) => ({
          parameterId: t.parameterId,
          targetValue: t.targetValue,
          parameter: { name: t.parameterId, domainGroup: "companion" },
        })),
      },
    },
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      channel: "voice",
      callNumber: 1,
      isFinalSession: false,
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "companion_directives",
    name: "Companion Directives",
    priority: 12.83,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "null" },
    transform: "companionDirectives",
    outputKey: "companionDirectives",
  };
}

describe("companionDirectives transform (#2085)", () => {
  let transform: ReturnType<typeof getTransform>;

  beforeAll(() => {
    transform = getTransform("companionDirectives");
  });

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });

  it("wires all 12 producer-only companion parameters", () => {
    // The 12 parameter IDs the survey marked as producer-only must all
    // appear in COMPANION_PARAMETER_IDS. If a future PR adds a new
    // companion-domain parameter, this list expands and the ratchet in
    // parameter-coverage.test.ts must drop again.
    expect(COMPANION_PARAMETER_IDS).toEqual(
      expect.arrayContaining([
        "BEH-CONVERSATIONAL-DEPTH",
        "BEH-INTELLECTUAL-CHALLENGE",
        "BEH-MEMORY-REFERENCE",
        "BEH-PATIENCE-LEVEL",
        "BEH-RESPECT-EXPERIENCE",
        "BEH-STORY-INVITATION",
        "BEH-DEPTH-PREFERENCE",
        "BEH-ENERGY",
        "BEH-ENGAGEMENT",
        "BEH-MOOD",
        "BEH-REMINISCENCE",
        "BEH-INSIGHT-QUALITY",
      ]),
    );
    expect(COMPANION_PARAMETER_IDS).toHaveLength(12);
  });

  it("emits whenHigh copy for a HIGH target value", async () => {
    const ctx = makeContext([
      { parameterId: "BEH-CONVERSATIONAL-DEPTH", targetValue: 0.9 },
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).not.toBeNull();
    expect(out!.directiveCount).toBe(1);
    expect(out!.directives[0].parameterId).toBe("BEH-CONVERSATIONAL-DEPTH");
    expect(out!.directives[0].targetLevel).toBe("HIGH");
    expect(out!.directives[0].directive).toContain("deep");
  });

  it("emits whenLow copy for a LOW target value", async () => {
    const ctx = makeContext([
      { parameterId: "BEH-PATIENCE-LEVEL", targetValue: 0.1 },
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).not.toBeNull();
    expect(out!.directiveCount).toBe(1);
    expect(out!.directives[0].parameterId).toBe("BEH-PATIENCE-LEVEL");
    expect(out!.directives[0].targetLevel).toBe("LOW");
    expect(out!.directives[0].directive).toContain("brisk");
  });

  it("skips emission when the value sits at the neutral midpoint", async () => {
    const ctx = makeContext([
      { parameterId: "BEH-MOOD", targetValue: 0.5 },
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).toBeNull();
  });

  it("skips emission within the neutral tolerance band", async () => {
    // ±0.05 around 0.5 → 0.48 / 0.52 should both skip.
    const ctxLow = makeContext([
      { parameterId: "BEH-ENERGY", targetValue: 0.48 },
    ]);
    expect(await transform!(null, ctxLow, makeSectionDef())).toBeNull();

    const ctxHigh = makeContext([
      { parameterId: "BEH-ENERGY", targetValue: 0.52 },
    ]);
    expect(await transform!(null, ctxHigh, makeSectionDef())).toBeNull();
  });

  it("emits soft-steer for mid-range values above midpoint but below HIGH threshold", async () => {
    // 0.6 is > NEUTRAL (0.5) but < high threshold (0.65). The transform
    // should still emit a HIGH-flavored directive rather than nothing,
    // so the LLM gets a soft steer for partial-tuning.
    const ctx = makeContext([
      { parameterId: "BEH-REMINISCENCE", targetValue: 0.6 },
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).not.toBeNull();
    expect(out!.directives[0].targetLevel).toBe("HIGH");
  });

  it("skips parameters that have no merged-target row (null-effective contract)", async () => {
    // Only one of the 12 has a target → only one directive emits.
    const ctx = makeContext([
      { parameterId: "BEH-MEMORY-REFERENCE", targetValue: 0.85 },
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).not.toBeNull();
    expect(out!.directiveCount).toBe(1);
    expect(out!.directives[0].parameterId).toBe("BEH-MEMORY-REFERENCE");
  });

  it("returns null when sections.behaviorTargets._merged is empty", async () => {
    const ctx = makeContext([]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).toBeNull();
  });

  it("emits multiple directives when several companion params are HIGH/LOW", async () => {
    const ctx = makeContext([
      { parameterId: "BEH-CONVERSATIONAL-DEPTH", targetValue: 0.9 }, // HIGH
      { parameterId: "BEH-PATIENCE-LEVEL", targetValue: 0.1 }, // LOW
      { parameterId: "BEH-INSIGHT-QUALITY", targetValue: 0.85 }, // HIGH
      { parameterId: "BEH-RESPECT-EXPERIENCE", targetValue: 0.5 }, // NEUTRAL — skip
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).not.toBeNull();
    expect(out!.directiveCount).toBe(3);
    expect(out!.directives.map((d) => d.parameterId)).toEqual([
      "BEH-CONVERSATIONAL-DEPTH",
      "BEH-PATIENCE-LEVEL",
      "BEH-INSIGHT-QUALITY",
    ]);
  });

  it("ignores non-companion parameters even when present in merged targets", async () => {
    // The transform is keyed on COMPANION_PARAMETER_IDS — a non-companion
    // param in the merged list shouldn't accidentally emit.
    const ctx = makeContext([
      { parameterId: "BEH-WARMTH", targetValue: 0.95 }, // NOT in COMPANION map
    ]);
    const out = (await transform!(null, ctx, makeSectionDef())) as
      | CompanionDirectivesOutput
      | null;
    expect(out).toBeNull();
  });
});
