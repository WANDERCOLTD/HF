/**
 * Tests for `GET /api/callers/[callerId]/assessment-moment-mcqs?moduleSlug=…`.
 *
 * W4 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md`.
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign callerId (403)
 *   2. Missing moduleSlug → 400 (Zod)
 *   3. No active enrollment → `{ result: null, reason: "no-moment" }`
 *   4. Playbook with no assessmentPlan → `{ result: null, reason: "no-moment" }`
 *   5. Playbook with `noAssessmentPlan: true` → `{ result: null, reason: "no-moment" }`
 *   6. AssessmentMoment present but engine returns `empty-pool` → `{ result: null, reason: "empty-pool" }`
 *   7. AssessmentMoment present + engine returns questions → payload with MCQs
 *   8. moduleSlug matches midpoints[] entry → moment resolves
 *   9. moduleSlug matches end-of-course entry → moment resolves
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockStudentAllowed, mockSampleQuestions } = vi.hoisted(
  () => ({
    mockPrisma: {
      callerPlaybook: { findFirst: vi.fn() },
    },
    mockStudentAllowed: vi.fn(),
    mockSampleQuestions: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: mockStudentAllowed,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/assessment/sample-questions", () => ({
  sampleQuestionsForMoment: mockSampleQuestions,
}));

const PARAMS = { params: Promise.resolve({ callerId: "caller-1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/assessment-moment-mcqs/route");
}

function makeReq(moduleSlug?: string): NextRequest {
  const url = moduleSlug
    ? `http://x?moduleSlug=${encodeURIComponent(moduleSlug)}`
    : "http://x";
  return new NextRequest(url);
}

function moment(
  override: Partial<{
    kind: string;
    moduleSlug: string;
    samplingPolicy: {
      scope: string;
      count: { min: number; target: number; max: number };
      contentKind: string;
    };
    shellKind: string;
    scoringSpec: string;
  }> = {},
) {
  return {
    kind: "popquiz",
    moduleSlug: "module-foo",
    samplingPolicy: {
      scope: "per-unit",
      count: { min: 1, target: 5, max: 5 },
      contentKind: "mcq",
    },
    shellKind: "mcq-rounds",
    scoringSpec: "QUIZ-SCORE-V1",
    ...override,
  };
}

function playbookConfigWith(plan: unknown) {
  return {
    playbook: {
      id: "pb-1",
      config: { assessmentPlan: plan },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/callers/[callerId]/assessment-moment-mcqs", () => {
  it("rejects STUDENT reading foreign caller (403)", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 400 when moduleSlug query param is missing", async () => {
    const route = await loadRoute();
    const res = await route.GET(makeReq(), PARAMS);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/moduleSlug/);
  });

  it("returns null + reason:'no-moment' when caller has no active enrollment", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: unknown;
      reason: string;
    };
    expect(body.ok).toBe(true);
    expect(body.result).toBeNull();
    expect(body.reason).toBe("no-moment");
  });

  it("returns null + reason:'no-moment' when Playbook has no assessmentPlan", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: { id: "pb-1", config: {} },
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: unknown;
      reason: string;
    };
    expect(body.result).toBeNull();
    expect(body.reason).toBe("no-moment");
  });

  it("returns null + reason:'no-moment' when plan declares noAssessmentPlan:true", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({ noAssessmentPlan: true }),
    );
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: unknown;
      reason: string;
    };
    expect(body.result).toBeNull();
    expect(body.reason).toBe("no-moment");
    expect(mockSampleQuestions).not.toHaveBeenCalled();
  });

  it("returns null + reason:'no-moment' when no moment cites the supplied moduleSlug", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        upfront: moment({ moduleSlug: "other-module" }),
      }),
    );
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: unknown;
      reason: string;
    };
    expect(body.result).toBeNull();
    expect(body.reason).toBe("no-moment");
    expect(mockSampleQuestions).not.toHaveBeenCalled();
  });

  it("returns null + engine reason when sampling engine reports empty-pool", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        upfront: moment({ moduleSlug: "module-foo" }),
      }),
    );
    mockSampleQuestions.mockResolvedValue({
      ok: false,
      reason: "empty-pool",
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: unknown;
      reason: string;
    };
    expect(body.ok).toBe(true);
    expect(body.result).toBeNull();
    expect(body.reason).toBe("empty-pool");
  });

  it("returns the sampled MCQ payload on the happy path (upfront moment)", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        upfront: moment({ moduleSlug: "module-foo", kind: "upfront-baseline" }),
      }),
    );
    mockSampleQuestions.mockResolvedValue({
      ok: true,
      questions: [
        {
          id: "q-1",
          questionText: "Pick one",
          options: [
            { label: "A", text: "First" },
            { label: "B", text: "Second" },
          ],
          questionType: "MULTIPLE_CHOICE",
          correctAnswer: null,
          answerExplanation: null,
          learningOutcomeRef: null,
          skillRef: null,
          bloomLevel: null,
          difficulty: null,
        },
      ],
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      ok: boolean;
      result: {
        momentKind: string;
        moduleSlug: string;
        feedbackMode: string;
        mcqs: Array<{ id: string; questionText: string; options: unknown }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.momentKind).toBe("upfront-baseline");
    expect(body.result.moduleSlug).toBe("module-foo");
    expect(body.result.feedbackMode).toBe("immediate");
    expect(body.result.mcqs).toHaveLength(1);
    expect(body.result.mcqs[0].id).toBe("q-1");
    expect(body.result.mcqs[0].options).toEqual([
      { label: "A", text: "First" },
      { label: "B", text: "Second" },
    ]);
  });

  it("resolves a moment from midpoints[] when slug matches", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        midpoints: [
          moment({ moduleSlug: "unit-1", kind: "midpoint-check" }),
          moment({ moduleSlug: "unit-2", kind: "popquiz" }),
        ],
      }),
    );
    mockSampleQuestions.mockResolvedValue({ ok: true, questions: [] });
    const route = await loadRoute();
    const res = await route.GET(makeReq("unit-2"), PARAMS);
    const body = (await res.json()) as {
      result: { momentKind: string };
    };
    expect(body.result.momentKind).toBe("popquiz");
    expect(mockSampleQuestions).toHaveBeenCalledOnce();
  });

  it("resolves a moment from end-of-course when slug matches", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        end: moment({ moduleSlug: "mock-exam", kind: "end-mock" }),
      }),
    );
    mockSampleQuestions.mockResolvedValue({ ok: true, questions: [] });
    const route = await loadRoute();
    const res = await route.GET(makeReq("mock-exam"), PARAMS);
    const body = (await res.json()) as {
      result: { momentKind: string };
    };
    expect(body.result.momentKind).toBe("end-mock");
  });

  it("narrows malformed options to null rather than passing through unknown shape", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(
      playbookConfigWith({
        upfront: moment({ moduleSlug: "module-foo" }),
      }),
    );
    mockSampleQuestions.mockResolvedValue({
      ok: true,
      questions: [
        {
          id: "q-1",
          questionText: "x",
          // Wrong shape — engine return is `unknown`; the route should narrow.
          options: { not: "an array" },
          questionType: "MULTIPLE_CHOICE",
          correctAnswer: null,
          answerExplanation: null,
          learningOutcomeRef: null,
          skillRef: null,
          bloomLevel: null,
          difficulty: null,
        },
      ],
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("module-foo"), PARAMS);
    const body = (await res.json()) as {
      result: { mcqs: Array<{ options: unknown }> };
    };
    expect(body.result.mcqs[0].options).toBeNull();
  });
});
