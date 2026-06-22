/**
 * Pin the pure classifier across the 4 status buckets.
 *
 * Story: #2176 S13 — AssessmentPlan resolution status badge.
 *
 * The Coverage gate
 * (`tests/lib/assessment/course-assessment-plan-coverage.test.ts`)
 * exercises this classifier against the curated manifest with the
 * real spec corpus; this test pins the classifier's branch
 * behaviour against synthetic fixtures so a refactor that breaks
 * a branch fails here AND in the Coverage gate's failure message.
 */

import { describe, it, expect } from "vitest";
import {
  classifyPlanResolution,
  type PlanModuleRef,
  type PlanResolutionInput,
} from "@/lib/assessment/classify-plan-resolution";
import type {
  AssessmentMoment,
  CourseAssessmentPlan,
} from "@/lib/types/json-fields";

// ────────────────────────────────────────────────────────────────────
// Fixtures — minimal viable shapes
// ────────────────────────────────────────────────────────────────────

const EXAMINER_MODULE: PlanModuleRef = { slug: "baseline", mode: "examiner" };
const TUTOR_MODULE: PlanModuleRef = { slug: "part-1", mode: "tutor" };
const QUIZ_MODULE: PlanModuleRef = { slug: "pop-quiz", mode: "quiz" };
const MOCK_MODULE: PlanModuleRef = { slug: "mock-exam", mode: "mock-exam" };

const ALL_MODULES = [
  EXAMINER_MODULE,
  TUTOR_MODULE,
  QUIZ_MODULE,
  MOCK_MODULE,
] as const;

/** A canonical upfront-baseline moment that resolves cleanly when modules + spec slug are present. */
function upfrontBaselineMoment(
  overrides: Partial<AssessmentMoment> = {},
): AssessmentMoment {
  return {
    kind: "upfront-baseline",
    moduleSlug: "baseline",
    samplingPolicy: {
      scope: "cross-curriculum",
      count: { min: 4, target: 8, max: 12 },
      contentKind: "topic-prompt",
    },
    shellKind: "exam",
    scoringSpec: "IELTS-MEASURE-001-ielts-speaking-criteria",
    ...overrides,
  };
}

function endMockMoment(
  overrides: Partial<AssessmentMoment> = {},
): AssessmentMoment {
  return {
    kind: "end-mock",
    moduleSlug: "mock-exam",
    samplingPolicy: {
      scope: "cross-curriculum",
      count: { min: 10, target: 12, max: 14 },
      contentKind: "topic-prompt",
    },
    shellKind: "exam",
    scoringSpec: "IELTS-MEASURE-001-ielts-speaking-criteria",
    ...overrides,
  };
}

const KNOWN_SPEC_SLUGS = new Set<string>([
  "IELTS-MEASURE-001-ielts-speaking-criteria",
]);

function inputWith(
  plan: CourseAssessmentPlan | undefined,
  rest: Partial<PlanResolutionInput> = {},
): PlanResolutionInput {
  return {
    plan,
    modules: ALL_MODULES,
    firstCallMode: rest.firstCallMode,
    knownSpecSlugs: rest.knownSpecSlugs,
  };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("classifyPlanResolution", () => {
  it("missing — when no plan is declared", () => {
    const result = classifyPlanResolution(inputWith(undefined));
    expect(result.kind).toBe("missing");
  });

  it("no-plan — when noAssessmentPlan:true and no moments", () => {
    const result = classifyPlanResolution(
      inputWith({ noAssessmentPlan: true }),
    );
    expect(result.kind).toBe("no-plan");
  });

  it("partial — contradiction: noAssessmentPlan:true AND a declared moment", () => {
    const result = classifyPlanResolution(
      inputWith(
        {
          noAssessmentPlan: true,
          upfront: upfrontBaselineMoment(),
        },
        { firstCallMode: "baseline_assessment" },
      ),
    );
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/contradiction/i);
    }
  });

  it("partial — plan object with no moments declared", () => {
    const result = classifyPlanResolution(inputWith({}));
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/no upfront/i);
    }
  });

  it("resolved — upfront-baseline moment with consistent firstCallMode and known spec slug", () => {
    const result = classifyPlanResolution(
      inputWith(
        { upfront: upfrontBaselineMoment() },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("resolved");
  });

  it("resolved — multi-moment plan (upfront + end) when everything checks", () => {
    const result = classifyPlanResolution(
      inputWith(
        {
          upfront: upfrontBaselineMoment(),
          end: endMockMoment(),
        },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("resolved");
  });

  it("partial — moduleSlug missing from modules[]", () => {
    const result = classifyPlanResolution(
      inputWith(
        {
          upfront: upfrontBaselineMoment({ moduleSlug: "no-such-module" }),
        },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/no-such-module/);
    }
  });

  it("partial — module mode incompatible with moment.kind (upfront-baseline pointing at a tutor module)", () => {
    const result = classifyPlanResolution(
      inputWith(
        {
          upfront: upfrontBaselineMoment({ moduleSlug: "part-1" }), // tutor mode
        },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/tutor/);
      expect(result.reasons.join("\n")).toMatch(/upfront-baseline/);
    }
  });

  it("partial — firstCallMode says baseline_assessment but plan has no upfront-baseline", () => {
    const result = classifyPlanResolution(
      inputWith(
        { end: endMockMoment() },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/baseline_assessment/);
    }
  });

  it("partial — plan has upfront-baseline but firstCallMode disagrees", () => {
    const result = classifyPlanResolution(
      inputWith(
        { upfront: upfrontBaselineMoment() },
        {
          firstCallMode: "teach_immediately",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("partial");
  });

  it("partial — scoringSpec not in known corpus", () => {
    const result = classifyPlanResolution(
      inputWith(
        {
          upfront: upfrontBaselineMoment({
            scoringSpec: "NOT-A-REAL-SPEC-V99",
          }),
        },
        {
          firstCallMode: "baseline_assessment",
          knownSpecSlugs: KNOWN_SPEC_SLUGS,
        },
      ),
    );
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reasons.join("\n")).toMatch(/NOT-A-REAL-SPEC-V99/);
    }
  });

  it("resolved — no spec corpus provided, scoringSpec is NOT cross-checked (badge runtime path)", () => {
    // When knownSpecSlugs is omitted the classifier skips that
    // check — the badge runs in the browser without filesystem access
    // and the Coverage gate enforces spec existence at PR time.
    const result = classifyPlanResolution(
      inputWith(
        {
          upfront: upfrontBaselineMoment({
            scoringSpec: "WHATEVER-SLUG-X",
          }),
        },
        { firstCallMode: "baseline_assessment" }, // no knownSpecSlugs
      ),
    );
    expect(result.kind).toBe("resolved");
  });
});
