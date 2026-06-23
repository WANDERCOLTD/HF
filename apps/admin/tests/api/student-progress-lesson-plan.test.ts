/**
 * #2277 Item #7 (D6) — student/progress route now surfaces the
 * `SessionLessonPlan` written by `pickNextRecommendedModule` at the
 * AGGREGATE stage. The FOH home highlights the recommended module via
 * `nextRecommended.moduleSlug`.
 *
 * Covered cases:
 *   - No COMPLETED Session → lessonPlan null + nextRecommended null
 *   - COMPLETED Session with lessonPlan → both surfaced
 *   - lessonPlan present but nextRecommendedModuleSlug undefined → nextRecommended null
 *   - Session metadata missing lessonPlan key → null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerPersonalityProfile: { findUnique: vi.fn() },
  goal: { findMany: vi.fn() },
  call: { count: vi.fn() },
  caller: { findUnique: vi.fn() },
  callerMemorySummary: { findUnique: vi.fn() },
  conversationArtifact: { count: vi.fn() },
  callerAttribute: { findMany: vi.fn(), findFirst: vi.fn() },
  callerModuleProgress: { findMany: vi.fn() },
  curriculumModule: { findMany: vi.fn() },
  playbook: { findUnique: vi.fn() },
  session: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/student-access", () => ({
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/curriculum/is-course-complete", () => ({
  isCourseComplete: vi.fn().mockResolvedValue({
    complete: false,
    mode: "terminal-only",
    completedAt: null,
    triggeringModuleIds: [],
  }),
}));

function resetDefaults(): void {
  mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
  mockPrisma.goal.findMany.mockResolvedValue([]);
  mockPrisma.call.count.mockResolvedValue(0);
  mockPrisma.caller.findUnique.mockResolvedValue({ name: "Alice", cohortGroup: null, cohortMemberships: [] });
  mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
  mockPrisma.conversationArtifact.count.mockResolvedValue(0);
  mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  mockPrisma.callerAttribute.findFirst.mockResolvedValue(null);
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
  mockPrisma.playbook.findUnique.mockResolvedValue(null);
  mockPrisma.session.findFirst.mockResolvedValue(null);
}

describe("GET /api/student/progress — lessonPlan + nextRecommended (#2277 D6)", () => {
  let GET: typeof import("@/app/api/student/progress/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDefaults();
    const mod = await import("@/app/api/student/progress/route");
    GET = mod.GET;
  });

  it("returns lessonPlan + nextRecommended null when no COMPLETED Session exists", async () => {
    mockPrisma.session.findFirst.mockResolvedValue(null);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.lessonPlan).toBeNull();
    expect(body.nextRecommended).toBeNull();
  });

  it("surfaces lessonPlan + nextRecommended from the latest COMPLETED Session's metadata", async () => {
    mockPrisma.session.findFirst.mockResolvedValue({
      id: "sess-mock-1",
      endedAt: new Date("2026-06-22T10:00:00Z"),
      metadata: {
        lessonPlan: {
          focusCriterion: "skill_fluency_and_coherence_fc",
          focusLabel: "Fluency and Coherence",
          focusScore: 0.55,
          reason:
            "Fluency and Coherence scored lowest on this session — strengthening it will lift your overall band fastest.",
          nextRecommendedModuleSlug: "part1",
          emittedAt: "2026-06-22T10:00:00Z",
        },
      },
    });

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.lessonPlan).toMatchObject({
      focusCriterion: "skill_fluency_and_coherence_fc",
      focusLabel: "Fluency and Coherence",
      nextRecommendedModuleSlug: "part1",
    });
    expect(body.nextRecommended).toEqual({
      moduleSlug: "part1",
      fromSessionId: "sess-mock-1",
    });
  });

  it("returns nextRecommended null when lessonPlan has no nextRecommendedModuleSlug", async () => {
    mockPrisma.session.findFirst.mockResolvedValue({
      id: "sess-mock-2",
      endedAt: new Date("2026-06-22T10:00:00Z"),
      metadata: {
        lessonPlan: {
          focusCriterion: "skill_unknown",
          focusLabel: "Unknown",
          focusScore: 0.5,
          reason: "No slug recommendation available.",
          emittedAt: "2026-06-22T10:00:00Z",
        },
      },
    });

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.lessonPlan).not.toBeNull();
    expect(body.nextRecommended).toBeNull();
  });

  it("returns lessonPlan null when Session.metadata exists but has no lessonPlan key", async () => {
    mockPrisma.session.findFirst.mockResolvedValue({
      id: "sess-mock-3",
      endedAt: new Date("2026-06-22T10:00:00Z"),
      metadata: { otherKey: "value" },
    });

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.lessonPlan).toBeNull();
    expect(body.nextRecommended).toBeNull();
  });

  it("queries Session with status=COMPLETED ordered by endedAt desc", async () => {
    mockPrisma.session.findFirst.mockResolvedValue(null);

    await GET({} as unknown as Parameters<typeof GET>[0]);

    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { callerId: "stu-caller-1", status: "COMPLETED" },
        orderBy: { endedAt: "desc" },
      }),
    );
  });
});
