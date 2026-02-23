/**
 * Tests for Course Readiness checks (lib/domain/course-readiness.ts)
 *
 * Key behavior:
 *   - Loads checks from COURSE-READY-001 spec (spec-driven)
 *   - Falls back to defaults when spec not found
 *   - Critical checks determine overall readiness
 *   - hrefTemplate variables are resolved from context
 *   - All checks run in parallel
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = vi.hoisted(() => ({
  analysisSpec: {
    findFirst: vi.fn(),
  },
  contentAssertion: {
    count: vi.fn(),
  },
  subjectSource: {
    findMany: vi.fn(),
  },
  playbook: {
    findFirst: vi.fn(),
  },
  domain: {
    findUnique: vi.fn(),
  },
  composedPrompt: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      courseReady: "COURSE-READY-001",
      communityReady: "COMMUNITY-READY-001",
    },
  },
}));

// =====================================================
// IMPORT AFTER MOCKING
// =====================================================

import {
  checkCourseReadiness,
  type CourseReadinessContext,
} from "@/lib/domain/course-readiness";

// =====================================================
// HELPERS
// =====================================================

const CTX: CourseReadinessContext = {
  domainId: "dom-1",
  callerId: "caller-1",
  sourceId: "src-1",
  subjectId: "subj-1",
};

function useDefaultChecks() {
  mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);
}

// =====================================================
// TESTS
// =====================================================

describe("checkCourseReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDefaultChecks();
  });

  it("returns incomplete when no assertions and no prompt", async () => {
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.playbook.findFirst.mockResolvedValue(null);
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: null,
      onboardingFlowPhases: null,
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);

    const result = await checkCourseReadiness(CTX);

    expect(result.ready).toBe(false);
    expect(result.level).toBe("incomplete");
    expect(result.checks).toHaveLength(4);
    expect(result.criticalPassed).toBe(0);
    expect(result.criticalTotal).toBe(1); // prompt_composed is the only critical
  });

  it("returns almost when prompt composed but assertions not reviewed", async () => {
    // Assertions exist but not reviewed
    mockPrisma.contentAssertion.count
      .mockResolvedValueOnce(50) // total
      .mockResolvedValueOnce(0); // reviewed
    // Playbook with content spec but no lesson plan
    mockPrisma.playbook.findFirst.mockResolvedValue({
      items: [{
        spec: { specRole: "CONTENT", isActive: true, config: { modules: [{ id: "MOD-1" }] } },
      }],
    });
    // Onboarding configured
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: "spec-1",
      onboardingFlowPhases: [{ id: "welcome" }],
    });
    // Prompt composed (critical check passes)
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ id: "prompt-1", createdAt: new Date() });

    const result = await checkCourseReadiness(CTX);

    expect(result.ready).toBe(true); // critical passed
    expect(result.level).toBe("almost"); // recommended checks failing
    expect(result.criticalPassed).toBe(1);
    expect(result.criticalTotal).toBe(1);
  });

  it("returns ready when all checks pass", async () => {
    // Use mockImplementation to handle parallel count calls from different checks
    mockPrisma.contentAssertion.count.mockImplementation(async (args: any) => {
      const where = args?.where || {};
      // assertions_reviewed: { sourceId: "src-1" }
      if (where.sourceId === "src-1" && where.reviewedAt) return 25; // reviewed
      if (where.sourceId === "src-1") return 50; // total
      // lesson_plan: { source: { subjects: { some: ... } } }
      if (where.source) return 50; // has assertions → passes lesson_plan check
      return 0;
    });
    // Onboarding configured
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: "spec-1",
      onboardingFlowPhases: [{ id: "welcome" }],
    });
    // Prompt composed
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ id: "prompt-1", createdAt: new Date() });

    const result = await checkCourseReadiness(CTX);

    expect(result.ready).toBe(true);
    expect(result.level).toBe("ready");
    expect(result.score).toBe(100);
  });

  it("resolves hrefTemplate variables in fixAction", async () => {
    // All checks failing to see fixActions
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.playbook.findFirst.mockResolvedValue(null);
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: null,
      onboardingFlowPhases: null,
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);

    const result = await checkCourseReadiness(CTX);

    const assertionCheck = result.checks.find((c) => c.id === "assertions_reviewed");
    expect(assertionCheck?.fixAction?.href).toBe("/x/content-sources/src-1");

    const lessonCheck = result.checks.find((c) => c.id === "lesson_plan_set");
    expect(lessonCheck?.fixAction?.href).toBe("/x/subjects?id=subj-1");

    const promptCheck = result.checks.find((c) => c.id === "prompt_composed");
    expect(promptCheck?.fixAction?.href).toBe("/x/callers/caller-1");
  });

  it("handles missing callerId gracefully for prompt check", async () => {
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.playbook.findFirst.mockResolvedValue(null);
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: null,
      onboardingFlowPhases: null,
    });

    const result = await checkCourseReadiness({
      domainId: "dom-1",
      // no callerId
    });

    const promptCheck = result.checks.find((c) => c.id === "prompt_composed");
    expect(promptCheck?.passed).toBe(false);
    expect(promptCheck?.detail).toContain("No test caller");
  });

  it("auto-passes assertions_reviewed when source has 0 teaching points", async () => {
    // Source exists but has 0 assertions (questions/exercises document)
    mockPrisma.contentAssertion.count.mockImplementation(async (args: any) => {
      const where = args?.where || {};
      if (where.sourceId === "src-1") return 0; // 0 assertions for the source
      if (where.source) return 0; // lesson_plan check
      return 0;
    });
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: null,
      onboardingFlowPhases: null,
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);

    const result = await checkCourseReadiness(CTX);

    const assertionCheck = result.checks.find((c) => c.id === "assertions_reviewed");
    expect(assertionCheck?.passed).toBe(true);
    expect(assertionCheck?.detail).toContain("No content to review");
  });

  it("falls back to domain-wide assertion check when no sourceId", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { sourceId: "src-a" },
      { sourceId: "src-b" },
    ]);
    // contentAssertion.count is called by both assertions_reviewed (2 calls) and lesson_plan (1 call) in parallel.
    // lesson_plan calls count({ source: { subjects: ... } }) and assertions_reviewed calls count({ sourceId: { in: ... } }).
    // Mock enough calls: all return positive values so both checks pass their count queries.
    mockPrisma.contentAssertion.count.mockResolvedValue(100);
    // Override the second call to assertions_reviewed (reviewed count) — but since we can't
    // guarantee order with parallel execution, use mockImplementation to distinguish by args.
    mockPrisma.contentAssertion.count.mockImplementation(async (args: any) => {
      const where = args?.where || {};
      // reviewed count: has reviewedAt filter
      if (where.reviewedAt || where.sourceId?.in) {
        if (where.reviewedAt) return 50; // reviewed
        return 100; // total for domain-wide
      }
      // lesson_plan count: has source.subjects filter
      if (where.source) return 100;
      return 0;
    });
    mockPrisma.playbook.findFirst.mockResolvedValue(null);
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingIdentitySpecId: null,
      onboardingFlowPhases: null,
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);

    const result = await checkCourseReadiness({
      domainId: "dom-1",
      callerId: "caller-1",
      // no sourceId — triggers domain-wide fallback
    });

    const assertionCheck = result.checks.find((c) => c.id === "assertions_reviewed");
    expect(assertionCheck?.passed).toBe(true);
    expect(assertionCheck?.detail).toContain("50/100");
  });
});

// =====================================================
// SPEC FILE VALIDATION
// =====================================================

describe("COURSE-READY-001 spec file", () => {
  it("exists and has valid structure", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const specPath = pathMod.resolve(
      __dirname,
      "../../docs-archive/bdd-specs/COURSE-READY-001-course-readiness.spec.json",
    );
    expect(fs.existsSync(specPath)).toBe(true);

    const raw = fs.readFileSync(specPath, "utf-8");
    const spec = JSON.parse(raw);

    expect(spec.id).toBe("COURSE-READY-001");
    expect(spec.specRole).toBe("ORCHESTRATE");
    expect(spec.specType).toBe("SYSTEM");

    const checks = spec.parameters?.[0]?.config?.checks;
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(4);

    // Every check must have required fields
    for (const check of checks) {
      expect(check.id).toBeTruthy();
      expect(check.name).toBeTruthy();
      expect(check.severity).toMatch(/^(critical|recommended|optional)$/);
      expect(check.query).toBeTruthy();
    }
  });
});
