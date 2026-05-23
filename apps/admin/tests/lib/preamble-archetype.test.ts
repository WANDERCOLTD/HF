/**
 * #604 — computePreamble archetype-aware criticalRules.
 *
 * Lives outside the quarantined `tests/lib/composition/preamble.test.ts`
 * (test-debt quarantine, vitest.config.ts:38 onwards) so the #604
 * contract gets enforced by the main `npm run test` suite, not only by
 * `test:debt`. The same assertions are also mirrored into
 * `tests/lib/composition/preamble.test.ts` so when the quarantine clears
 * the existing file no longer guards the pre-#604 hardcoded behaviour.
 *
 * What this guards:
 * - RETURNING_CALLER rule varies by playbook `teachingMode`:
 *     practice  → "warm-up attempt … attempt IS the diagnostic"
 *     recall    → "ALWAYS review before new material"
 *     comprehension / syllabus → "ALWAYS review before new material"
 * - COMP-001 spec config (`criticalRules.returningCallerByMode[mode]`)
 *   overrides the code-side default per mode.
 * - Universal pedagogy rules (#401) appear in every mode.
 * - No-curriculum branch is unaffected by teachingMode.
 *
 * See: gh issue view 604
 *      lib/prompt/composition/transforms/preamble.ts
 *      lib/prompt/composition/transforms/pedagogy-mode.ts (mirror read pattern)
 */
import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef, PlaybookData } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/preamble";

// ── Helpers ──────────────────────────────────────────────

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
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
      callNumber: 1,
      channel: "voice" as const,
      isFinalSession: false,
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "preamble",
    name: "Preamble",
    priority: 0,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "computePreamble",
    outputKey: "_preamble",
  };
}

function playbookWithMode(mode: string): PlaybookData {
  return {
    id: "pb-test",
    name: "Test Playbook",
    status: "PUBLISHED",
    config: { teachingMode: mode } as unknown as Record<string, unknown>,
    domain: null,
    items: [],
  };
}

const curriculumSharedState = {
  modules: [{ id: "m1" }] as Array<{ id: string }>,
  isFirstCall: false,
  daysSinceLastCall: 0,
  completedModules: new Set<string>(),
  estimatedProgress: 0,
  lastCompletedIndex: -1,
  moduleToReview: null,
  nextModule: null,
  reviewType: "",
  reviewReason: "",
  thresholds: { high: 0.65, low: 0.35 },
  callNumber: 1,
  channel: "voice" as const,
  isFinalSession: false,
};

async function rulesFor(modeOrNull: string | null, opts: { specOverride?: Record<string, string> } = {}): Promise<string> {
  const ctx = makeContext({
    loadedData: {
      ...makeContext().loadedData,
      playbooks: modeOrNull ? [playbookWithMode(modeOrNull)] : [],
    },
    sharedState: curriculumSharedState as any,
    specConfig: opts.specOverride
      ? ({ criticalRules: { returningCallerByMode: opts.specOverride } } as any)
      : {},
  });
  const result = await getTransform("computePreamble")!(null, ctx, makeSectionDef());
  return (result.criticalRules as string[]).join(" ");
}

// ── #604 — archetype-aware RETURNING_CALLER rule ──────────────────────

describe("#604 — computePreamble RETURNING_CALLER varies by teachingMode", () => {
  it("teachingMode=practice → warm-up-attempt rule, NOT review-first", async () => {
    const rules = await rulesFor("practice");
    expect(rules).toContain("warm-up attempt");
    expect(rules).toContain("attempt IS the diagnostic");
    expect(rules).not.toContain("ALWAYS review before new material");
  });

  it("teachingMode=recall → review-first rule (regression on happy path)", async () => {
    const rules = await rulesFor("recall");
    expect(rules).toContain("ALWAYS review before new material");
    expect(rules).not.toContain("warm-up attempt");
  });

  it("teachingMode=comprehension → review-first rule (recall-archetype family)", async () => {
    const rules = await rulesFor("comprehension");
    expect(rules).toContain("ALWAYS review before new material");
    expect(rules).not.toContain("warm-up attempt");
  });

  it("teachingMode=syllabus → review-first rule (recall-archetype family)", async () => {
    const rules = await rulesFor("syllabus");
    expect(rules).toContain("ALWAYS review before new material");
    expect(rules).not.toContain("warm-up attempt");
  });

  it("playbook with no teachingMode → defaults to recall behaviour (pre-#604 baseline)", async () => {
    const rules = await rulesFor(null);
    expect(rules).toContain("ALWAYS review before new material");
  });
});

describe("#604 — COMP-001 spec config overrides code default per mode", () => {
  it("spec override wins for practice mode", async () => {
    const customRule = "RETURNING_CALLER: spec-override rule for practice mode.";
    const rules = await rulesFor("practice", { specOverride: { practice: customRule } });
    expect(rules).toContain(customRule);
    expect(rules).not.toContain("warm-up attempt");
    expect(rules).not.toContain("ALWAYS review before new material");
  });

  it("spec override wins for recall mode", async () => {
    const customRule = "RETURNING_CALLER: bespoke recall-mode rule.";
    const rules = await rulesFor("recall", { specOverride: { recall: customRule } });
    expect(rules).toContain(customRule);
    expect(rules).not.toContain("ALWAYS review before new material");
  });

  it("spec override for one mode doesn't bleed into another", async () => {
    const customRule = "RETURNING_CALLER: only for practice.";
    const rules = await rulesFor("recall", { specOverride: { practice: customRule } });
    expect(rules).not.toContain(customRule);
    expect(rules).toContain("ALWAYS review before new material");
  });
});

describe("#604 — universal pedagogy rules appear in every mode", () => {
  it.each(["recall", "comprehension", "practice", "syllabus"])(
    "mode=%s carries the #401 universal rules",
    async (mode) => {
      const rules = await rulesFor(mode);
      expect(rules).toContain("rubric level, band descriptor");
      expect(rules).toContain("Meta-statements about how you operate are forbidden");
      expect(rules).toContain("INSTRUCTIONS, not a script");
    },
  );
});

describe("#604 — no-curriculum branch is independent of teachingMode", () => {
  it.each(["recall", "practice", "comprehension", "syllabus"])(
    "mode=%s with no curriculum → no RETURNING_CALLER rule, no warm-up rule",
    async (mode) => {
      const ctx = makeContext({
        loadedData: {
          ...makeContext().loadedData,
          playbooks: [playbookWithMode(mode)],
        },
        sharedState: { ...curriculumSharedState, modules: [] } as any,
      });
      const result = await getTransform("computePreamble")!(null, ctx, makeSectionDef());
      const rules = (result.criticalRules as string[]).join(" ");

      // No-curriculum branch does not include either RETURNING_CALLER rule
      expect(rules).not.toContain("ALWAYS review before new material");
      expect(rules).not.toContain("warm-up attempt");
      // But still carries pedagogy + pacing rules
      expect(rules).toContain("rubric level, band descriptor");
      expect(rules).toContain("Do not rush");
    },
  );
});
