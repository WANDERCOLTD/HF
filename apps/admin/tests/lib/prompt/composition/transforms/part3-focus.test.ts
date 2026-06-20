/**
 * Behavioural tests for `lib/prompt/composition/transforms/part3-focus.ts` (#1955).
 *
 * Pins (Boaz/Eldar pre-voice gap analysis Unit 4.1 / 4.2 bar):
 *   - Emits directive when locked Part 3 module + scoring history + flag ON
 *   - Returns null when the feature flag is OFF
 *   - Returns null when no module is locked (continuous mode)
 *   - Returns null when locked module isn't Part-3-shape (Part 1, Mock, etc.)
 *   - Returns null when G8 pinFocusArea toggle is explicitly false
 *   - Returns null when deriveFocusArea finds no scores (first-ever session)
 *   - Directive text names the lowest-scoring criterion's label
 *   - V3 / non-IELTS compose paths unaffected — gated by flag
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModuleFocusArea, isPart3ShapedModule } from "@/lib/prompt/composition/transforms/part3-focus";
import type { AssembledContext } from "@/lib/prompt/composition/types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const FC = "skill_fluency_and_coherence_fc";
const P = "skill_pronunciation_p";
const LR = "skill_lexical_resource_lr";
const GRA = "skill_grammatical_range_and_accuracy_gra";

const FLAG = "HF_FLAG_IELTS_MODULE_SETTINGS";

function buildContext(args: {
  lockedModule: { id?: string | null; slug?: string | null } | null;
  callerTargets: Array<{ parameterId: string; currentScore: number | null }>;
}): AssembledContext {
  return {
    loadedData: {
      callerTargets: args.callerTargets,
      playbooks: [{ config: {} }],
    },
    sharedState: {
      lockedModule: args.lockedModule,
    },
  } as unknown as AssembledContext;
}

function buildConfig(opts: {
  moduleSlug: string;
  pinFocusArea?: boolean;
}): PlaybookConfig {
  return {
    modules: [
      {
        id: opts.moduleSlug,
        slug: opts.moduleSlug,
        title: "Test",
        settings: {
          pinFocusArea: opts.pinFocusArea,
        },
      } as unknown as PlaybookConfig["modules"] extends Array<infer T> ? T : never,
    ],
  } as PlaybookConfig;
}

describe("resolveModuleFocusArea", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("emits directive naming the lowest-scoring criterion when conditions met", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3" }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [
          { parameterId: FC, currentScore: 0.7 },
          { parameterId: P, currentScore: 0.6 },
          { parameterId: LR, currentScore: 0.4 },
          { parameterId: GRA, currentScore: 0.55 },
        ],
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.parameterId).toBe(LR);
    expect(out!.label).toBe("Lexical Resource");
    expect(out!.paramSlug).toBe("lexical_resource");
    expect(out!.directive).toContain("Lexical Resource");
    expect(out!.directive).toContain("0.40");
  });

  it("returns null when feature flag is OFF (V3 / non-IELTS path unaffected)", () => {
    delete process.env[FLAG];
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3" }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null when no module is locked (continuous mode)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3" }),
      buildContext({
        lockedModule: null,
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null when locked module isn't Part-3-shape (Part 1)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part1" }),
      buildContext({
        lockedModule: { id: "part1", slug: "part1" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null when locked module isn't Part-3-shape (Mock)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "mock" }),
      buildContext({
        lockedModule: { id: "mock", slug: "mock" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null when G8 pinFocusArea toggle is explicitly false", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3", pinFocusArea: false }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).toBeNull();
  });

  it("emits directive when pinFocusArea is true (explicit opt-in)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3", pinFocusArea: true }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).not.toBeNull();
  });

  it("emits directive when pinFocusArea is undefined (default ON for Part-3)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3" }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
      }),
    );
    expect(out).not.toBeNull();
  });

  it("returns null when no scoring history exists (first-ever session)", () => {
    const out = resolveModuleFocusArea(
      buildConfig({ moduleSlug: "part3" }),
      buildContext({
        lockedModule: { id: "part3", slug: "part3" },
        callerTargets: [],
      }),
    );
    expect(out).toBeNull();
  });
});

describe("isPart3ShapedModule", () => {
  it("matches slug = 'part3'", () => {
    expect(isPart3ShapedModule({ slug: "part3" })).toBe(true);
  });
  it("matches slug containing 'part-3' / 'part_3' / 'discussion'", () => {
    expect(isPart3ShapedModule({ slug: "ielts-part-3-discussion" })).toBe(true);
    expect(isPart3ShapedModule({ slug: "part_3_abstract" })).toBe(true);
    expect(isPart3ShapedModule({ slug: "abstract-discussion" })).toBe(true);
  });
  it("rejects Part 1 / Part 2 / Mock / Baseline slugs", () => {
    expect(isPart3ShapedModule({ slug: "part1" })).toBe(false);
    expect(isPart3ShapedModule({ slug: "part2" })).toBe(false);
    expect(isPart3ShapedModule({ slug: "mock" })).toBe(false);
    expect(isPart3ShapedModule({ slug: "baseline" })).toBe(false);
  });
  it("returns false on null / empty input", () => {
    expect(isPart3ShapedModule(null)).toBe(false);
    expect(isPart3ShapedModule({})).toBe(false);
    expect(isPart3ShapedModule({ slug: "" })).toBe(false);
  });
});
