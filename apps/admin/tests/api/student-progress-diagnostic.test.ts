/**
 * #493 Slice 5.3 — student/progress route now reads the latest
 * DIAGNOSTIC/fromMock `CallerAttribute` (written by E2 AGGREGATE) and resolves
 * its module IDs into `{id, slug, title}` triples for the SimProgressPanel
 * Focus Areas section.
 *
 * Covered cases:
 *   - No DIAGNOSTIC row → diagnosticFromMock null
 *   - Valid DIAGNOSTIC row → IDs resolve to title triples
 *   - Malformed JSON → logs warn, returns null
 *   - strengthModule null in storage → strengthModule null in response
 *   - A focusModules ID whose CurriculumModule was deleted → entry dropped
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

// resolvePlaybookId / resolveCurriculumIdForPlaybook / isCourseComplete are
// called by the same route — stub them to return null so the diagnostic
// path is exercised independently of the course-complete path.
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
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
  mockPrisma.playbook.findUnique.mockResolvedValue(null);
  mockPrisma.session.findFirst.mockResolvedValue(null);
}

describe("GET /api/student/progress — diagnosticFromMock (#493 Slice 5.3)", () => {
  let GET: typeof import("@/app/api/student/progress/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDefaults();
    const mod = await import("@/app/api/student/progress/route");
    GET = mod.GET;
  });

  it("returns null when no DIAGNOSTIC row exists", async () => {
    mockPrisma.callerAttribute.findFirst.mockResolvedValue(null);

    const res = await GET({} as unknown as Request as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.diagnosticFromMock).toBeNull();
  });

  it("resolves module IDs to {id, slug, title} triples", async () => {
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({
      stringValue: JSON.stringify({
        focusModules: ["mod-part1", "mod-part2"],
        strengthModule: "mod-part3",
        weakSkill: "fluency",
        summary: "On your Mock, your strongest area was Part 3. To improve, focus next on Part 1, Part 2.",
        fromCallId: "call-mock-1",
        generatedAt: "2026-05-19T10:00:00Z",
      }),
      updatedAt: new Date("2026-05-19T10:00:00Z"),
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-part1", slug: "part1", title: "Part 1" },
      { id: "mod-part2", slug: "part2", title: "Part 2" },
      { id: "mod-part3", slug: "part3", title: "Part 3" },
    ]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.diagnosticFromMock).toMatchObject({
      focusModules: [
        { id: "mod-part1", slug: "part1", title: "Part 1" },
        { id: "mod-part2", slug: "part2", title: "Part 2" },
      ],
      strengthModule: { id: "mod-part3", slug: "part3", title: "Part 3" },
      weakSkill: "fluency",
      fromCallId: "call-mock-1",
    });
    expect(body.diagnosticFromMock.summary).toContain("Part 3");
  });

  it("logs warn and returns null when stringValue is malformed JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({
      stringValue: "not-json{",
      updatedAt: new Date(),
    });

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.diagnosticFromMock).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns strengthModule null when stored strengthModule is null", async () => {
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({
      stringValue: JSON.stringify({
        focusModules: ["mod-part1"],
        strengthModule: null,
        weakSkill: null,
        summary: "On your Mock, focus next on Part 1.",
        fromCallId: "call-mock-2",
        generatedAt: "2026-05-19T10:00:00Z",
      }),
      updatedAt: new Date("2026-05-19T10:00:00Z"),
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-part1", slug: "part1", title: "Part 1" },
    ]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.diagnosticFromMock.strengthModule).toBeNull();
    expect(body.diagnosticFromMock.weakSkill).toBeNull();
    expect(body.diagnosticFromMock.focusModules).toHaveLength(1);
  });

  it("drops focus entries whose CurriculumModule has been deleted", async () => {
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({
      stringValue: JSON.stringify({
        focusModules: ["mod-part1", "mod-deleted"],
        strengthModule: "mod-part3",
        weakSkill: "fluency",
        summary: "Diagnostic summary",
        fromCallId: "call-mock-3",
        generatedAt: "2026-05-19T10:00:00Z",
      }),
      updatedAt: new Date("2026-05-19T10:00:00Z"),
    });
    // mod-deleted is missing from the resolver result
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      { id: "mod-part1", slug: "part1", title: "Part 1" },
      { id: "mod-part3", slug: "part3", title: "Part 3" },
    ]);

    const res = await GET({} as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.diagnosticFromMock.focusModules).toEqual([
      { id: "mod-part1", slug: "part1", title: "Part 1" },
    ]);
    expect(body.diagnosticFromMock.strengthModule).toEqual({
      id: "mod-part3",
      slug: "part3",
      title: "Part 3",
    });
  });
});
