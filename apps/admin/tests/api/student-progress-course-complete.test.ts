/**
 * #493 Slice 5.4 — student/progress route now calls `isCourseComplete()` and
 * surfaces the verdict as `courseComplete: { complete, mode, completedAt }`
 * for the SimProgressPanel Course Complete hero.
 *
 * Covered cases:
 *   - No modules completed → complete: false (terminal-only default)
 *   - terminal-only mode + terminal module completed → complete: true
 *   - all-modules mode + every module complete → complete: true
 *   - playbookConfig null → defaults to terminal-only
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
  resolvePlaybookId: vi.fn().mockResolvedValue("playbook-1"),
}));
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: vi.fn().mockResolvedValue("curriculum-1"),
}));

function resetDefaults(): void {
  mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
  mockPrisma.goal.findMany.mockResolvedValue([]);
  mockPrisma.call.count.mockResolvedValue(0);
  mockPrisma.caller.findUnique.mockResolvedValue({ name: "Alice", cohortGroup: null, cohortMemberships: [] });
  mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
  mockPrisma.conversationArtifact.count.mockResolvedValue(0);
  mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
  mockPrisma.callerAttribute.findFirst.mockResolvedValue(null);
  mockPrisma.session.findFirst.mockResolvedValue(null);
}

describe("GET /api/student/progress — courseComplete (#493 Slice 5.4)", () => {
  let GET: typeof import("@/app/api/student/progress/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDefaults();
    const mod = await import("@/app/api/student/progress/route");
    GET = mod.GET;
  });

  it("returns complete: false when no modules are completed", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { completionMode: "terminal-only" },
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-1", slug: "part1", terminal: false, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
      { id: "mod-mock", slug: "mock", terminal: true, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
    ]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.courseComplete).toMatchObject({
      complete: false,
      mode: "terminal-only",
      completedAt: null,
    });
  });

  it("returns complete: true when terminal-only mode + terminal module is completed", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { completionMode: "terminal-only" },
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-1", slug: "part1", terminal: false, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
      { id: "mod-mock", slug: "mock", terminal: true, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
    ]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "mod-mock",
        status: "COMPLETED",
        mastery: 0.9,
        callCount: 3,
        completedAt: new Date("2026-05-18T10:00:00Z"),
        module: { id: "mod-mock", slug: "mock", title: "Mock", sortOrder: 99, masteryThreshold: 0.7 },
      },
    ]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.courseComplete).toMatchObject({
      complete: true,
      mode: "terminal-only",
    });
    expect(body.courseComplete.completedAt).toBe("2026-05-18T10:00:00.000Z");
    // triggeringModuleIds is intentionally dropped from the API surface
    expect(body.courseComplete.triggeringModuleIds).toBeUndefined();
  });

  it("returns complete: true when all-modules mode + every module is completed", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { completionMode: "all-modules" },
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-1", slug: "part1", terminal: false, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
      { id: "mod-2", slug: "part2", terminal: false, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
    ]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "mod-1",
        status: "COMPLETED",
        mastery: 0.9,
        callCount: 2,
        completedAt: new Date("2026-05-17T10:00:00Z"),
        module: { id: "mod-1", slug: "part1", title: "Part 1", sortOrder: 1, masteryThreshold: 0.7 },
      },
      {
        moduleId: "mod-2",
        status: "COMPLETED",
        mastery: 0.9,
        callCount: 2,
        completedAt: new Date("2026-05-18T10:00:00Z"),
        module: { id: "mod-2", slug: "part2", title: "Part 2", sortOrder: 2, masteryThreshold: 0.7 },
      },
    ]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.courseComplete).toMatchObject({
      complete: true,
      mode: "all-modules",
    });
    expect(body.courseComplete.completedAt).toBe("2026-05-18T10:00:00.000Z");
  });

  it("defaults to terminal-only when playbookConfig is null", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: null });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-mock", slug: "mock", terminal: true, prerequisites: [], coversModules: [], masteryThreshold: 0.7 },
    ]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.courseComplete).toMatchObject({
      complete: false,
      mode: "terminal-only",
    });
  });
});
