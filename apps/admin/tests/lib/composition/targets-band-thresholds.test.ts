/**
 * Tests for #575 — the composer surfaces `Parameter.config.bandThresholds`
 * into the rendered prompt's "Skill Band Reference" section.
 *
 * Companion to #564 (which writes the field) and #565 (composer loader
 * follow-up). Locks the data flow:
 *   Parameter.config.bandThresholds → targets transform → composed prompt.
 */

import { describe, it, expect, vi } from "vitest";

// Hoist a minimal prisma mock so transforms can import @/lib/prisma without
// touching the real client.
vi.hoisted(() => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {},
  db: () => ({}),
}));

import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import "@/lib/prompt/composition/transforms/targets";
import type {
  AssembledContext,
  BehaviorTargetData,
  CallerTargetData,
  CompositionSectionDef,
  PlaybookData,
} from "@/lib/prompt/composition/types";

function buildContext(opts: {
  behaviorTargets: BehaviorTargetData[];
  callerTargets: CallerTargetData[];
}): AssembledContext {
  return {
    callerId: "caller-test",
    sharedState: { isFirstCall: false, callNumber: 3, thresholds: {} },
    loadedData: {
      behaviorTargets: opts.behaviorTargets,
      callerTargets: opts.callerTargets,
      playbooks: [{ id: "pb-1", config: { audience: "adult-professional" } }] as unknown as PlaybookData[],
      caller: { id: "caller-test", domain: null } as unknown as never,
    } as never,
    resolvedSpecs: {} as never,
    sections: {} as never,
    specConfig: {},
  } as unknown as AssembledContext;
}

describe("targets transform — band thresholds (#575)", () => {
  const mergeAndGroupTargets = getTransform("mergeAndGroupTargets")!;

  it("emits bandThresholds on the `all` rows when Parameter.config carries them", () => {
    const ctx = buildContext({
      behaviorTargets: [
        {
          parameterId: "skill_fluency_and_coherence_fc",
          targetValue: 0.7,
          confidence: 0.8,
          scope: "PLAYBOOK",
          playbookId: "pb-1",
          parameter: {
            name: "Fluency & Coherence",
            parameterId: "skill_fluency_and_coherence_fc",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: "skill",
            config: {
              bandThresholds: {
                "9": "Fluent, only very occasional repetition",
                "5": "Usually keeps going but relies on repetition",
              },
            },
          },
        },
      ],
      callerTargets: [],
    });
    const out = mergeAndGroupTargets(
      { behaviorTargets: ctx.loadedData.behaviorTargets, callerTargets: ctx.loadedData.callerTargets },
      ctx,
      {} as CompositionSectionDef,
    );
    expect(out.all).toHaveLength(1);
    const t = out.all[0] as { bandThresholds: Record<string, string> | null };
    expect(t.bandThresholds).toEqual({
      "9": "Fluent, only very occasional repetition",
      "5": "Usually keeps going but relies on repetition",
    });
  });

  it("emits bandThresholds=null when Parameter.config has no bandThresholds key", () => {
    const ctx = buildContext({
      behaviorTargets: [
        {
          parameterId: "BEH-WARMTH",
          targetValue: 0.6,
          confidence: 0.7,
          scope: "DOMAIN",
          playbookId: null,
          parameter: {
            name: "Warmth",
            parameterId: "BEH-WARMTH",
            interpretationLow: "cold",
            interpretationHigh: "warm",
            domainGroup: "behavior",
            config: null,
          },
        },
      ],
      callerTargets: [],
    });
    const out = mergeAndGroupTargets(
      { behaviorTargets: ctx.loadedData.behaviorTargets, callerTargets: ctx.loadedData.callerTargets },
      ctx,
      {} as CompositionSectionDef,
    );
    const t = out.all[0] as { bandThresholds: Record<string, string> | null };
    expect(t.bandThresholds).toBeNull();
  });

  it("CallerTarget bandThresholds override BehaviorTarget for the same parameter", () => {
    const ctx = buildContext({
      behaviorTargets: [
        {
          parameterId: "skill_fluency_and_coherence_fc",
          targetValue: 0.7,
          confidence: 0.8,
          scope: "PLAYBOOK",
          playbookId: "pb-1",
          parameter: {
            name: "Fluency & Coherence",
            parameterId: "skill_fluency_and_coherence_fc",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: "skill",
            config: {
              bandThresholds: { "9": "BT-version of band 9" },
            },
          },
        },
      ],
      callerTargets: [
        {
          parameterId: "skill_fluency_and_coherence_fc",
          targetValue: 0.65,
          confidence: 0.9,
          parameter: {
            name: "Fluency & Coherence",
            parameterId: "skill_fluency_and_coherence_fc",
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: "skill",
            config: {
              bandThresholds: { "9": "CT-version of band 9" },
            },
          },
        },
      ],
    });
    const out = mergeAndGroupTargets(
      { behaviorTargets: ctx.loadedData.behaviorTargets, callerTargets: ctx.loadedData.callerTargets },
      ctx,
      {} as CompositionSectionDef,
    );
    // CallerTarget wins on scope priority.
    const t = out.all[0] as { bandThresholds: Record<string, string> | null; scope: string };
    expect(t.bandThresholds?.["9"]).toBe("CT-version of band 9");
  });
});
