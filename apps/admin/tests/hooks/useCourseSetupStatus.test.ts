/**
 * Tests for `deriveStages` — the pure function backing the
 * `useCourseSetupStatus` React hook.
 *
 * Focus: #884 S0 — "Ready to Teach gating lie" stopgap.
 *
 * Invariant: `ready_to_teach ⇒ ∀ prior step done`. Stage 6 (the "Ready to
 * Teach" gate) MUST NOT report `done` while any of stages 1–5 is still
 * pending/active, even if the server reports `allCriticalPass=true`.
 *
 * Prior behaviour: stage 6 was driven solely by `readiness.allCriticalPass`,
 * which only verifies stages 4–5 (lesson plan + onboarding + #444
 * strategies). A course with no content uploaded could show Stage 6 green
 * while Stage 2/3 were still pending — the banner contradicting the badge.
 */

import { describe, it, expect } from "vitest";
import { deriveStages, type SetupStatusInput } from "@/hooks/useCourseSetupStatus";

// ── Fixture helpers ───────────────────────────────────

const PLAYBOOK_ID = "playbook-1";

function makeInput(overrides: Partial<SetupStatusInput> = {}): SetupStatusInput {
  return {
    detail: {
      id: PLAYBOOK_ID,
      name: "IELTS Speaking",
      status: "DRAFT",
      domain: { id: "dom-1", name: "ELT" },
      config: {},
    },
    subjects: [],
    sourceStatusMap: {},
    sessions: null,
    readiness: null,
    ...overrides,
  };
}

/** A subject with N sources (and optional assertions). */
function subjectWithSources(opts: {
  sourceCount: number;
  assertionCount?: number;
}) {
  return {
    id: "sub-1",
    name: "ELT",
    sourceCount: opts.sourceCount,
    assertionCount: opts.assertionCount ?? 0,
    sources: Array.from({ length: opts.sourceCount }).map((_, i) => ({
      id: `src-${i + 1}`,
      name: `Source ${i + 1}`,
      documentType: "TEXTBOOK",
      assertionCount: 0,
    })),
  };
}

/** sourceStatusMap entries reporting extraction state for each source. */
function sourceStatusMap(opts: {
  sourceIds: string[];
  jobStatus: "extracting" | "done" | "pending" | "error" | "importing";
  assertionsEach?: number;
}): SetupStatusInput["sourceStatusMap"] {
  return Object.fromEntries(
    opts.sourceIds.map((id) => [
      id,
      {
        jobStatus: opts.jobStatus,
        assertionCount: opts.assertionsEach ?? 0,
        questionCount: 0,
        vocabularyCount: 0,
        embeddedCount: 0,
        structuredCount: 0,
      },
    ]),
  );
}

// =====================================================
// #884 S0 — stage 6 ("Ready to Teach") gating
// =====================================================

describe("deriveStages — #884 S0 Ready to Teach dependency gate", () => {
  it("stage 6 stays pending when allCriticalPass=true but hasSources=false (Foundation missing)", () => {
    const input = makeInput({
      // Server: lesson plan + onboarding configured, critical passed
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        allCriticalPass: true,
        hasSources: false,
        hasAssertions: false,
      },
    });

    const { stages } = deriveStages(input);
    const stage6 = stages.find((s) => s.number === 6)!;

    expect(stage6.status).toBe("pending");
    expect(stage6.label).toBe("Ready to Teach");
    // Detail should hint why it's blocked
    expect(stage6.detail.toLowerCase()).toContain("upload");
  });

  it("stage 6 stays pending when hasSources=true but hasAssertions=false (extraction still running)", () => {
    const input = makeInput({
      // Some content uploaded — but no teaching points extracted yet
      subjects: [subjectWithSources({ sourceCount: 1 })],
      sourceStatusMap: sourceStatusMap({
        sourceIds: ["src-1"],
        jobStatus: "extracting",
        assertionsEach: 0,
      }),
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        allCriticalPass: true,
        hasSources: true,
        hasAssertions: false,
      },
    });

    const { stages } = deriveStages(input);
    const stage6 = stages.find((s) => s.number === 6)!;

    expect(stage6.status).toBe("pending");
    // Detail should reference extraction / teaching points
    expect(stage6.detail.toLowerCase()).toMatch(/extract|teaching point/);
  });

  it("stage 6 stays pending when Foundation passes server-side but client stages 1-3 not all done (multi-source mid-extraction)", () => {
    // A race we want to defend against: server may report hasAssertions=true
    // because at least ONE source has finished, but a second source is still
    // mid-extraction. Stage 3 is then 'active', not 'done', and Stage 6 must
    // hold the gate even though the server's `allCriticalPass` is true.
    const input = makeInput({
      subjects: [
        {
          id: "sub-1",
          name: "ELT",
          sourceCount: 2,
          assertionCount: 0,
          sources: [
            { id: "src-1", name: "Source 1", documentType: "TEXTBOOK", assertionCount: 0 },
            { id: "src-2", name: "Source 2", documentType: "TEXTBOOK", assertionCount: 0 },
          ],
        },
      ],
      sourceStatusMap: {
        // src-1 finished — produced some assertions
        "src-1": {
          jobStatus: "done",
          assertionCount: 5,
          questionCount: 0,
          vocabularyCount: 0,
          embeddedCount: 0,
          structuredCount: 0,
        },
        // src-2 still extracting, no assertions yet
        "src-2": {
          jobStatus: "extracting",
          assertionCount: 0,
          questionCount: 0,
          vocabularyCount: 0,
          embeddedCount: 0,
          structuredCount: 0,
        },
      },
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        allCriticalPass: true,
        // Server has seen the src-1 assertions land
        hasSources: true,
        hasAssertions: true,
      },
    });

    const { stages } = deriveStages(input);
    const stage3 = stages.find((s) => s.number === 3)!;
    const stage6 = stages.find((s) => s.number === 6)!;

    // Stage 3 is 'active' because src-2 is still extracting (anyExtracting=true).
    expect(stage3.status).toBe("active");
    // Stage 6 must hold even though server thinks Foundation is satisfied.
    expect(stage6.status).toBe("pending");
  });

  it("stage 6 goes done when ALL prior gates pass AND server confirms allCriticalPass", () => {
    const input = makeInput({
      subjects: [subjectWithSources({ sourceCount: 1, assertionCount: 12 })],
      sourceStatusMap: sourceStatusMap({
        sourceIds: ["src-1"],
        jobStatus: "done",
        assertionsEach: 12,
      }),
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        allCriticalPass: true,
        hasSources: true,
        hasAssertions: true,
      },
    });

    const { stages, allComplete } = deriveStages(input);
    const stage6 = stages.find((s) => s.number === 6)!;

    expect(stage6.status).toBe("done");
    expect(stage6.detail.toLowerCase()).toContain("ready");
    expect(allComplete).toBe(true);
  });

  it("stage 6 reports 'pending' (not 'done') when configure-stage is done but Foundation booleans undefined", () => {
    // Legacy / pre-migration response that doesn't include hasSources/hasAssertions.
    // We must default to the safe path: gate stays pending.
    const input = makeInput({
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        allCriticalPass: true,
        // hasSources / hasAssertions intentionally omitted
      },
    });

    const { stages } = deriveStages(input);
    const stage6 = stages.find((s) => s.number === 6)!;

    // With Foundation booleans missing the gate stays pending — fail closed.
    expect(stage6.status).toBe("pending");
  });
});

// =====================================================
// Regression: existing behaviour preserved
// =====================================================

describe("deriveStages — regression checks unchanged by #884 S0", () => {
  it("stage 6 still active (not done) when configure-stage done but allCriticalPass=false", () => {
    const input = makeInput({
      subjects: [subjectWithSources({ sourceCount: 1, assertionCount: 12 })],
      sourceStatusMap: sourceStatusMap({
        sourceIds: ["src-1"],
        jobStatus: "done",
        assertionsEach: 12,
      }),
      readiness: {
        lessonPlanBuilt: true,
        onboardingConfigured: true,
        // allCriticalPass false — strategy assignment pending (#444)
        allCriticalPass: false,
        hasSources: true,
        hasAssertions: true,
      },
    });

    const { stages } = deriveStages(input);
    const stage6 = stages.find((s) => s.number === 6)!;

    // Server gate still failing → 'active' (running final checks).
    expect(stage6.status).toBe("active");
  });

  it("returns 6 stages with correct labels (structure unchanged)", () => {
    const input = makeInput();
    const { stages } = deriveStages(input);

    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.label)).toEqual([
      "Course Created",
      "Content Uploaded",
      "Teaching Points Ready",
      "Lesson Plan Built",
      "Tutor Configured",
      "Ready to Teach",
    ]);
  });
});
