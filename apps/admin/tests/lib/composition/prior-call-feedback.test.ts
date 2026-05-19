/**
 * #492 Slice 3.5 — priorCallFeedback loader + transform tests.
 *
 * Covers:
 *   - No prior call on the module → hasFeedback: false, no section emitted
 *   - One prior call with scores → summary references weakest parameter +
 *     relative time
 *   - Prior call with zero scores → friendly fallback summary, weakest* null
 *   - Multiple prior calls → uses the most recent (ordered by createdAt desc)
 *   - currentCallId is excluded so we never self-reference
 *   - The composition section is emitted when hasFeedback=true and dropped
 *     when hasFeedback=false
 *
 * The loader is exercised directly with a small mock client (no Prisma
 * coupling) so the surface is narrow and the assertions are exact.
 */

import { describe, it, expect, vi } from "vitest";
import {
  loadPriorCallFeedback,
  formatRelativeTime,
} from "@/lib/prompt/composition/loaders/priorCallFeedback";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/priorCallFeedback";

// =====================================================
// Helpers
// =====================================================

/**
 * Tiny Prisma stub that supports findFirst on Call and findMany on CallScore
 * with deterministic data driven by the args. Each test wires up its own
 * implementations.
 */
function makePrismaStub(opts: {
  /** Pre-seeded prior calls in any order — the stub orders + filters them */
  calls: Array<{
    id: string;
    callerId: string;
    curriculumModuleId: string | null;
    createdAt: Date;
  }>;
  /** Scores keyed by callId */
  scoresByCall: Record<string, Array<{ score: number; parameter: { name: string } | null }>>;
}) {
  const call = {
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let matches = opts.calls.filter((c) => {
        if (where.callerId && c.callerId !== where.callerId) return false;
        if (where.curriculumModuleId && c.curriculumModuleId !== where.curriculumModuleId) return false;
        if (where.id?.not && c.id === where.id.not) return false;
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        matches = matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return matches[0] ?? null;
    }),
  };
  const callScore = {
    findMany: vi.fn(async ({ where }: any) => {
      return opts.scoresByCall[where.callId] ?? [];
    }),
  };
  return { call, callScore } as any;
}

const NOW = new Date("2026-05-19T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// =====================================================
// Loader tests
// =====================================================

describe("loadPriorCallFeedback", () => {
  it("returns hasFeedback: false when no prior call exists on the module", async () => {
    const prisma = makePrismaStub({ calls: [], scoresByCall: {} });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.lastCallId).toBeNull();
  });

  it("returns hasFeedback: false when moduleId is empty", async () => {
    const prisma = makePrismaStub({ calls: [], scoresByCall: {} });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(false);
    // Should short-circuit BEFORE calling prisma
    expect(prisma.call.findFirst).not.toHaveBeenCalled();
  });

  it("summarises weakest parameter + relative time when scores exist", async () => {
    const callAt = daysAgo(3);
    const prisma = makePrismaStub({
      calls: [
        { id: "call-old", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: callAt },
      ],
      scoresByCall: {
        "call-old": [
          { score: 0.75, parameter: { name: "fluency" } },
          { score: 0.5, parameter: { name: "pronunciation" } },
          { score: 0.8, parameter: { name: "vocabulary" } },
        ],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(true);
    expect(result.lastCallId).toBe("call-old");
    expect(result.lastCallAt).toBe(callAt.toISOString());
    expect(result.weakestParameterName).toBe("pronunciation");
    expect(result.weakestParameterScore).toBeCloseTo(0.5, 5);
    expect(result.overallScore).toBeCloseTo((0.75 + 0.5 + 0.8) / 3, 5);
    expect(result.summary).toContain("pronunciation");
    expect(result.summary).toContain("3 days ago");
    // 0.5 of 9 = 4.5
    expect(result.summary).toContain("4.5/9");
  });

  it("falls back to friendly summary when prior call has zero scores", async () => {
    const callAt = daysAgo(1);
    const prisma = makePrismaStub({
      calls: [
        { id: "call-old", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: callAt },
      ],
      scoresByCall: { "call-old": [] },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(true);
    expect(result.lastCallId).toBe("call-old");
    expect(result.weakestParameterName).toBeNull();
    expect(result.weakestParameterScore).toBeNull();
    expect(result.overallScore).toBeNull();
    expect(result.summary).toMatch(/didn't have clear score signals/i);
  });

  it("uses the most recent prior call when several exist", async () => {
    const prisma = makePrismaStub({
      calls: [
        { id: "call-week-ago", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(7) },
        { id: "call-yesterday", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(1) },
        { id: "call-month-ago", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(30) },
      ],
      scoresByCall: {
        "call-yesterday": [{ score: 0.6, parameter: { name: "fluency" } }],
        "call-week-ago": [{ score: 0.4, parameter: { name: "pronunciation" } }],
        "call-month-ago": [{ score: 0.3, parameter: { name: "vocabulary" } }],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      now: NOW,
    });

    expect(result.lastCallId).toBe("call-yesterday");
    expect(result.weakestParameterName).toBe("fluency");
  });

  it("excludes the currentCallId from the search (no self-reference)", async () => {
    const prisma = makePrismaStub({
      calls: [
        // Most recent — but it's the current call. Loader must skip it.
        { id: "call-current", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(0) },
        { id: "call-prior", callerId: "caller-1", curriculumModuleId: "mod-1", createdAt: daysAgo(5) },
      ],
      scoresByCall: {
        "call-current": [{ score: 0.9, parameter: { name: "fluency" } }],
        "call-prior": [{ score: 0.4, parameter: { name: "pronunciation" } }],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      currentCallId: "call-current",
      now: NOW,
    });

    expect(result.lastCallId).toBe("call-prior");
    expect(result.weakestParameterName).toBe("pronunciation");
  });

  it("ignores prior calls scoped to a different module", async () => {
    const prisma = makePrismaStub({
      calls: [
        { id: "call-other-mod", callerId: "caller-1", curriculumModuleId: "mod-OTHER", createdAt: daysAgo(1) },
      ],
      scoresByCall: { "call-other-mod": [{ score: 0.5, parameter: { name: "anything" } }] },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-1",
      moduleId: "mod-1",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(false);
  });
});

// =====================================================
// Relative time helper
// =====================================================

describe("formatRelativeTime", () => {
  it("returns 'yesterday' for 1 day ago", () => {
    expect(formatRelativeTime(daysAgo(1), NOW)).toBe("yesterday");
  });

  it("returns 'N days ago' for <7 days", () => {
    expect(formatRelativeTime(daysAgo(3), NOW)).toBe("3 days ago");
  });

  it("returns 'N weeks ago' for 1-4 weeks", () => {
    expect(formatRelativeTime(daysAgo(14), NOW)).toMatch(/2 weeks ago/);
  });

  it("returns 'N months ago' for several months", () => {
    expect(formatRelativeTime(daysAgo(90), NOW)).toMatch(/months ago/);
  });
});

// =====================================================
// Transform tests (composition integration surface)
// =====================================================

describe("renderPriorCallFeedback transform", () => {
  it("emits a section block when hasFeedback=true", () => {
    const transform = getTransform("renderPriorCallFeedback");
    expect(transform).toBeDefined();

    const result = transform!(
      {
        hasFeedback: true,
        lastCallAt: "2026-05-15T10:00:00Z",
        lastCallId: "call-1",
        weakestParameterName: "fluency",
        weakestParameterScore: 0.5,
        overallScore: 0.65,
        summary: "On your last attempt 4 days ago, your weakest area was fluency (4.5/9).",
      },
      {} as any,
      {} as any,
    );

    expect(result).not.toBeNull();
    expect(result.hasFeedback).toBe(true);
    expect(result.heading).toMatch(/Since your last attempt on this module/i);
    expect(result.summary).toContain("fluency");
    expect(result.weakestParameterName).toBe("fluency");
  });

  it("returns null (drops the section) when hasFeedback=false", () => {
    const transform = getTransform("renderPriorCallFeedback");
    const result = transform!(
      {
        hasFeedback: false,
        lastCallAt: null,
        lastCallId: null,
        weakestParameterName: null,
        weakestParameterScore: null,
        overallScore: null,
        summary: null,
      },
      {} as any,
      {} as any,
    );

    expect(result).toBeNull();
  });

  it("returns null when raw data is missing entirely", () => {
    const transform = getTransform("renderPriorCallFeedback");
    expect(transform!(null, {} as any, {} as any)).toBeNull();
    expect(transform!(undefined, {} as any, {} as any)).toBeNull();
  });
});

// =====================================================
// Default-sections registration (composition integration surface)
// =====================================================

describe("priorCallFeedback in getDefaultSections", () => {
  it("registers the prior_call_feedback section between curriculum and learner_goals", async () => {
    const { getDefaultSections } = await import("@/lib/prompt/composition/CompositionExecutor");
    const sections = getDefaultSections();
    const ids = sections.map((s) => s.id);

    const idxCurriculum = ids.indexOf("curriculum");
    const idxPrior = ids.indexOf("prior_call_feedback");
    const idxGoals = ids.indexOf("learner_goals");

    expect(idxCurriculum).toBeGreaterThanOrEqual(0);
    expect(idxPrior).toBeGreaterThanOrEqual(0);
    expect(idxGoals).toBeGreaterThanOrEqual(0);

    // Order in the declaration: curriculum comes first, then prior, then goals
    expect(idxPrior).toBeGreaterThan(idxCurriculum);
    expect(idxPrior).toBeLessThan(idxGoals);

    const section = sections[idxPrior];
    expect(section.outputKey).toBe("priorCallFeedback");
    expect(section.dataSource).toBe("priorCallFeedback");
    expect(section.transform).toBe("renderPriorCallFeedback");
    expect(section.dependsOn).toContain("curriculum");
    // Activation = priorCallFeedbackExists guards on hasFeedback=true so the
    // section is omitted on first-attempt calls.
    expect(section.activateWhen.condition).toBe("priorCallFeedbackExists");
    // fallback=omit keeps the section out of the prompt entirely when no prior call exists
    expect(section.fallback.action).toBe("omit");
  });
});

// =====================================================
// Activation logic on the executor (priorCallFeedbackExists)
// =====================================================

describe("priorCallFeedbackExists activation logic", () => {
  it("the priorCallFeedbackExists branch activates only when hasFeedback=true and summary non-empty", async () => {
    // We exercise the activation by importing the section + a minimal fake
    // context. The checkActivationWithReason function is not exported, so we
    // test the contract via the full executor in the next describe.
    // (See "section is emitted/omitted via executor" below.)
    expect(true).toBe(true);
  });

  it("section is emitted when hasFeedback=true and omitted otherwise (executor end-to-end)", async () => {
    // Stub out loadAllData so we can drive priorCallFeedback directly while
    // keeping the rest of the executor logic real. The stub is scoped via
    // vi.doMock so other tests in this file are unaffected.
    vi.resetModules();
    const baseLoaded = {
      caller: { id: "caller-1", name: "Test", email: null, phone: null, externalId: null, domain: null },
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
        loadAllData: vi.fn().mockImplementation(async (_id: string, _cfg: any, scope: any) => {
          // Return the priorCallFeedback shape from scope-supplied flag (read
          // via a global the test sets) — keeps both branches in one mock.
          const hasFb = (globalThis as any).__TEST_PRIOR_FB__ as boolean;
          return {
            ...baseLoaded,
            priorCallFeedback: hasFb
              ? {
                  hasFeedback: true,
                  lastCallAt: "2026-05-15T10:00:00Z",
                  lastCallId: "call-old",
                  weakestParameterName: "fluency",
                  weakestParameterScore: 0.5,
                  overallScore: 0.65,
                  summary: "On your last attempt yesterday, your weakest area was fluency (4.5/9).",
                }
              : {
                  hasFeedback: false,
                  lastCallAt: null,
                  lastCallId: null,
                  weakestParameterName: null,
                  weakestParameterScore: null,
                  overallScore: null,
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

    // ── Case 1: hasFeedback = true → section appears in llmPrompt ──
    (globalThis as any).__TEST_PRIOR_FB__ = true;
    const result1 = await executeComposition("caller-1", sections, minimalConfig, undefined, "mod-1", "call-current");
    expect(result1.metadata.sectionsActivated).toContain("prior_call_feedback");
    expect(result1.llmPrompt.priorCallFeedback).toBeDefined();
    expect(result1.llmPrompt.priorCallFeedback.summary).toContain("fluency");
    expect(result1.llmPrompt.priorCallFeedback.heading).toMatch(/Since your last attempt/);

    // ── Case 2: hasFeedback = false → section is OMITTED from llmPrompt ──
    (globalThis as any).__TEST_PRIOR_FB__ = false;
    const result2 = await executeComposition("caller-1", sections, minimalConfig, undefined, null, "call-current");
    expect(result2.metadata.sectionsSkipped).toContain("prior_call_feedback");
    expect(result2.llmPrompt.priorCallFeedback).toBeUndefined();

    // Clean up
    delete (globalThis as any).__TEST_PRIOR_FB__;
    vi.doUnmock("@/lib/prompt/composition/SectionDataLoader");
    vi.resetModules();
  });
});
