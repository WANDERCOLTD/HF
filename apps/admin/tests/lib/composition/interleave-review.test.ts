/**
 * #492 E3 Slice 3.3 — interleaveReview loader + transform + composition wiring tests.
 *
 * Covers:
 *   - No mastered modules → hasReview: false
 *   - One mastered module → hasReview: false (need ≥ 2 for interleave to make sense)
 *   - Two mastered, both last-called < 3 days ago → hasReview: false
 *   - Two mastered, one last-called 5 days ago → that one chosen
 *   - Three mastered, all stale → OLDEST lastCallAt chosen
 *   - currentModuleId === null → hasReview: false (no anchor to nudge alongside)
 *   - currentModuleId matches a mastered module → that one excluded from candidates
 *   - playbookConfig.interleaveReviewMinDays = 7 → modules < 7 days stale don't qualify
 *   - Summary references title + day count (singular "1 day" / plural "N days")
 *   - Transform: emits a block on hasReview=true, returns null when false
 *   - Composition: section appears in llmPrompt when present, omitted otherwise
 *   - getDefaultSections registers interleave_review between mock_diagnostic
 *     and session_planning
 *
 * The loader is exercised directly with a small mock client (no Prisma
 * coupling) so the surface is narrow and the assertions are exact.
 */

import { describe, it, expect, vi } from "vitest";
import {
  loadInterleaveReview,
  buildSummary,
} from "@/lib/prompt/composition/loaders/interleaveReview";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/interleaveReview";

// =====================================================
// Helpers
// =====================================================

interface FakeProgressRow {
  callerId: string;
  moduleId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  mastery: number;
  lastCallId: string | null;
}

interface FakeCallRow {
  callerId: string;
  curriculumModuleId: string | null;
  createdAt: Date;
}

interface FakeModuleRow {
  id: string;
  slug: string;
  title: string;
}

function makePrismaStub(opts: {
  progress?: FakeProgressRow[];
  calls?: FakeCallRow[];
  modules?: FakeModuleRow[];
}) {
  const progress = opts.progress ?? [];
  const calls = opts.calls ?? [];
  const modules = opts.modules ?? [];

  const callerModuleProgress = {
    findMany: vi.fn(async ({ where }: any) => {
      return progress.filter((row) => {
        if (where.callerId && row.callerId !== where.callerId) return false;
        if (where.status && row.status !== where.status) return false;
        if (where.moduleId?.not && row.moduleId === where.moduleId.not) return false;
        return true;
      });
    }),
  };
  const call = {
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let matches = calls.filter((c) => {
        if (where.callerId && c.callerId !== where.callerId) return false;
        if (where.curriculumModuleId?.in) {
          if (
            !c.curriculumModuleId ||
            !where.curriculumModuleId.in.includes(c.curriculumModuleId)
          ) {
            return false;
          }
        }
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      return matches;
    }),
  };
  const curriculumModule = {
    findUnique: vi.fn(async ({ where }: any) => {
      return modules.find((m) => m.id === where.id) ?? null;
    }),
  };
  return { callerModuleProgress, call, curriculumModule } as any;
}

const NOW = new Date("2026-05-19T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const M1: FakeModuleRow = { id: "mod-1", slug: "intro", title: "Introduction" };
const M2: FakeModuleRow = { id: "mod-2", slug: "fluency", title: "Fluency Practice" };
const M3: FakeModuleRow = { id: "mod-3", slug: "grammar", title: "Grammar Drill" };
const MCUR: FakeModuleRow = { id: "mod-current", slug: "current", title: "Current Module" };

// =====================================================
// Loader tests
// =====================================================

describe("loadInterleaveReview", () => {
  it("returns hasReview: false when no modules are mastered", async () => {
    const prisma = makePrismaStub({ progress: [] });
    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.candidateModule).toBeNull();
  });

  it("returns hasReview: false when only one module is mastered (need >= 2)", async () => {
    const prisma = makePrismaStub({
      progress: [
        {
          callerId: "caller-1",
          moduleId: "mod-1",
          status: "COMPLETED",
          mastery: 0.9,
          lastCallId: "call-a",
        },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(30) },
      ],
      modules: [M1],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
  });

  it("returns hasReview: false when all mastered modules called within minDays", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(1) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(2) },
      ],
      modules: [M1, M2],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
  });

  it("picks the stale mastered module when one qualifies", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        // mod-1 last-called 5 days ago (stale), mod-2 last-called 1 day ago (fresh)
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(5) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(1) },
      ],
      modules: [M1, M2],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(true);
    expect(result.candidateModule).not.toBeNull();
    expect(result.candidateModule!.id).toBe("mod-1");
    expect(result.candidateModule!.title).toBe("Introduction");
    expect(result.daysSinceLastCall).toBe(5);
    expect(result.mastery).toBeCloseTo(0.9, 5);
    expect(result.summary).toContain("Introduction");
    expect(result.summary).toContain("5 days");
  });

  it("picks the OLDEST stale module when several qualify", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
        { callerId: "caller-1", moduleId: "mod-3", status: "COMPLETED", mastery: 0.95, lastCallId: "cc" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(5) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(10) }, // OLDEST
        { callerId: "caller-1", curriculumModuleId: "mod-3", createdAt: daysAgo(7) },
      ],
      modules: [M1, M2, M3],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(true);
    expect(result.candidateModule!.id).toBe("mod-2");
    expect(result.daysSinceLastCall).toBe(10);
  });

  it("returns hasReview: false when currentModuleId is null", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(30) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(30) },
      ],
      modules: [M1, M2],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: null,
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
    // Short-circuit: must NOT hit the DB when no active module.
    expect(prisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
  });

  it("excludes currentModuleId from candidates when it matches a mastered module", async () => {
    const prisma = makePrismaStub({
      progress: [
        // mod-1 is mastered AND is the active module — must NOT be picked
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
        { callerId: "caller-1", moduleId: "mod-3", status: "COMPLETED", mastery: 0.92, lastCallId: "cc" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(100) }, // oldest, but excluded
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(10) },
        { callerId: "caller-1", curriculumModuleId: "mod-3", createdAt: daysAgo(20) },
      ],
      modules: [M1, M2, M3],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-1", // mod-1 is "current" — exclude it
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(true);
    expect(result.candidateModule!.id).toBe("mod-3"); // oldest among remaining (mod-2 = 10d, mod-3 = 20d)
  });

  it("respects playbookConfig.interleaveReviewMinDays override (7-day threshold)", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        // 5 days ago — would qualify under default (3) but NOT under 7-day threshold
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(5) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(4) },
      ],
      modules: [M1, M2],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: { interleaveReviewMinDays: 7 } as any,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
  });

  it("uses default minDays=3 when playbookConfig is empty/invalid", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(4) }, // qualifies (>=3)
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(2) }, // doesn't (<3)
      ],
      modules: [M1, M2],
    });

    // Invalid config (negative) should fall back to default
    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: { interleaveReviewMinDays: -1 } as any,
      now: NOW,
    });

    expect(result.hasReview).toBe(true);
    expect(result.candidateModule!.id).toBe("mod-1");
  });

  it("ignores NOT_STARTED and IN_PROGRESS modules", async () => {
    const prisma = makePrismaStub({
      progress: [
        // Only COMPLETED rows should count
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "IN_PROGRESS", mastery: 0.5, lastCallId: "cb" },
        { callerId: "caller-1", moduleId: "mod-3", status: "NOT_STARTED", mastery: 0, lastCallId: null },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(30) },
      ],
      modules: [M1, M2, M3],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    // Only 1 COMPLETED → throttle says no
    expect(result.hasReview).toBe(false);
  });

  it("returns hasReview: false when candidate module was deleted between queries", async () => {
    const prisma = makePrismaStub({
      progress: [
        { callerId: "caller-1", moduleId: "mod-1", status: "COMPLETED", mastery: 0.9, lastCallId: "ca" },
        { callerId: "caller-1", moduleId: "mod-2", status: "COMPLETED", mastery: 0.85, lastCallId: "cb" },
      ],
      calls: [
        { callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(30) },
        { callerId: "caller-1", curriculumModuleId: "mod-2", createdAt: daysAgo(5) },
      ],
      // mod-1 is the chosen one but it's NOT in the modules table (deleted)
      modules: [M2],
    });

    const result = await loadInterleaveReview(prisma, {
      callerId: "caller-1",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
  });

  it("returns hasReview: false when callerId is empty", async () => {
    const prisma = makePrismaStub({ progress: [] });
    const result = await loadInterleaveReview(prisma, {
      callerId: "",
      currentModuleId: "mod-current",
      playbookConfig: null,
      now: NOW,
    });

    expect(result.hasReview).toBe(false);
    expect(prisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
  });
});

// =====================================================
// Summary builder helper
// =====================================================

describe("buildSummary", () => {
  it("uses singular '1 day' for daysSinceLastCall = 1", () => {
    expect(buildSummary({ title: "Part 1", daysSinceLastCall: 1 })).toContain("1 day ");
    expect(buildSummary({ title: "Part 1", daysSinceLastCall: 1 })).not.toContain("1 days");
  });

  it("uses plural 'N days' for daysSinceLastCall > 1", () => {
    expect(buildSummary({ title: "Part 2", daysSinceLastCall: 5 })).toContain("5 days");
  });

  it("references the module title and includes the 'Consider' nudge phrase", () => {
    const summary = buildSummary({ title: "Grammar Drill", daysSinceLastCall: 7 });
    expect(summary).toContain("Grammar Drill");
    expect(summary).toMatch(/Consider a brief review check-in/i);
  });
});

// =====================================================
// Transform tests
// =====================================================

describe("renderInterleaveReview transform", () => {
  it("emits a section block when hasReview=true", () => {
    const transform = getTransform("renderInterleaveReview");
    expect(transform).toBeDefined();

    const result = transform!(
      {
        hasReview: true,
        candidateModule: { id: "mod-1", slug: "intro", title: "Introduction" },
        daysSinceLastCall: 5,
        mastery: 0.9,
        summary: "It's been 5 days since the learner last practised Introduction. Consider a brief review check-in.",
      },
      {} as any,
      {} as any,
    );

    expect(result).not.toBeNull();
    expect(result!.hasReview).toBe(true);
    expect(result!.heading).toBe("Review opportunity");
    expect(result!.body).toContain("## Review opportunity");
    expect(result!.body).toContain("Introduction");
    expect(result!.summary).toContain("5 days");
    expect(result!.candidateSlug).toBe("intro");
    expect(result!.daysSinceLastCall).toBe(5);
  });

  it("returns null when hasReview=false", () => {
    const transform = getTransform("renderInterleaveReview");
    const result = transform!(
      {
        hasReview: false,
        candidateModule: null,
        daysSinceLastCall: null,
        mastery: null,
        summary: null,
      },
      {} as any,
      {} as any,
    );

    expect(result).toBeNull();
  });

  it("returns null when raw data is missing entirely", () => {
    const transform = getTransform("renderInterleaveReview");
    expect(transform!(null, {} as any, {} as any)).toBeNull();
    expect(transform!(undefined, {} as any, {} as any)).toBeNull();
  });
});

// =====================================================
// Default-sections registration
// =====================================================

describe("interleaveReview in getDefaultSections", () => {
  it("registers interleave_review between mock_diagnostic and session_planning", async () => {
    const { getDefaultSections } = await import("@/lib/prompt/composition/CompositionExecutor");
    const sections = getDefaultSections();
    const ids = sections.map((s) => s.id);

    const idxMock = ids.indexOf("mock_diagnostic");
    const idxInterleave = ids.indexOf("interleave_review");
    const idxSessionPlanning = ids.indexOf("session_planning");
    const idxGoals = ids.indexOf("learner_goals");

    expect(idxMock).toBeGreaterThanOrEqual(0);
    expect(idxInterleave).toBeGreaterThanOrEqual(0);
    expect(idxSessionPlanning).toBeGreaterThanOrEqual(0);
    expect(idxGoals).toBeGreaterThanOrEqual(0);

    expect(idxInterleave).toBeGreaterThan(idxMock);
    expect(idxInterleave).toBeLessThan(idxGoals);

    const section = sections[idxInterleave];
    expect(section.outputKey).toBe("interleaveReview");
    expect(section.dataSource).toBe("interleaveReview");
    expect(section.transform).toBe("renderInterleaveReview");
    expect(section.dependsOn).toContain("curriculum");
    expect(section.activateWhen.condition).toBe("interleaveReviewExists");
    expect(section.fallback.action).toBe("omit");
    expect(section.priority).toBe(7.8);
  });
});

// =====================================================
// Composition integration (end-to-end via executor)
// =====================================================

describe("interleaveReviewExists activation (executor end-to-end)", () => {
  it("section is emitted when hasReview=true and omitted otherwise", async () => {
    vi.resetModules();
    const baseLoaded = {
      caller: { id: "caller-1", name: "Test", email: null, phone: null, externalId: null, domain: null },
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
      onboardingSession: null,
      subjectSources: null,
      curriculumAssertions: [],
      curriculumQuestions: [],
      curriculumVocabulary: [],
      courseInstructions: [],
      openActions: [],
      visualAids: [],
    };

    vi.doMock("@/lib/prompt/composition/SectionDataLoader", async () => {
      const actual: any = await vi.importActual("@/lib/prompt/composition/SectionDataLoader");
      return {
        ...actual,
        loadAllData: vi.fn().mockImplementation(async () => {
          const hasReview = (globalThis as any).__TEST_INTERLEAVE__ as boolean;
          return {
            ...baseLoaded,
            interleaveReview: hasReview
              ? {
                  hasReview: true,
                  candidateModule: { id: "mod-1", slug: "intro", title: "Introduction" },
                  daysSinceLastCall: 5,
                  mastery: 0.9,
                  summary:
                    "It's been 5 days since the learner last practised Introduction. Consider a brief review check-in.",
                }
              : {
                  hasReview: false,
                  candidateModule: null,
                  daysSinceLastCall: null,
                  mastery: null,
                  summary: null,
                },
          };
        }),
      };
    });

    const { executeComposition, getDefaultSections } = await import(
      "@/lib/prompt/composition/CompositionExecutor"
    );
    const sections = getDefaultSections();
    const minimalConfig = {};

    // Case 1: hasReview=true → section appears
    (globalThis as any).__TEST_INTERLEAVE__ = true;
    const result1 = await executeComposition(
      "caller-1",
      sections,
      minimalConfig,
      undefined,
      "mod-current",
      "call-1",
    );
    expect(result1.metadata.sectionsActivated).toContain("interleave_review");
    expect(result1.llmPrompt.interleaveReview).toBeDefined();
    expect(result1.llmPrompt.interleaveReview.summary).toContain("Introduction");
    expect(result1.llmPrompt.interleaveReview.heading).toBe("Review opportunity");
    expect(result1.llmPrompt.interleaveReview.body).toContain("## Review opportunity");

    // Case 2: hasReview=false → section omitted
    (globalThis as any).__TEST_INTERLEAVE__ = false;
    const result2 = await executeComposition(
      "caller-1",
      sections,
      minimalConfig,
      undefined,
      "mod-current",
      "call-1",
    );
    expect(result2.metadata.sectionsSkipped).toContain("interleave_review");
    expect(result2.llmPrompt.interleaveReview).toBeUndefined();

    delete (globalThis as any).__TEST_INTERLEAVE__;
    vi.doUnmock("@/lib/prompt/composition/SectionDataLoader");
    vi.resetModules();
  });
});
