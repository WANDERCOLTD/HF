/**
 * Tests for Student Progress API:
 *   GET /api/student/progress — Learning profile for a student
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerPersonalityProfile: { findUnique: vi.fn() },
  goal: { findMany: vi.fn() },
  call: { count: vi.fn() },
  caller: { findUnique: vi.fn() },
  callerMemorySummary: { findUnique: vi.fn() },
  conversationArtifact: { count: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/student-access", () => ({
  requireStudent: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

describe("GET /api/student/progress", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/progress/route");
    GET = mod.GET;
  });

  it("returns progress data for authenticated student", async () => {
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue({
      parameterValues: { confidence: 0.7 },
      lastUpdatedAt: new Date("2026-02-15"),
      callsUsed: 5,
    });
    mockPrisma.goal.findMany.mockResolvedValue([
      { id: "g1", name: "Improve confidence", type: "ACHIEVE", progress: 0.4, description: null },
    ]);
    mockPrisma.call.count.mockResolvedValue(10);
    mockPrisma.caller.findUnique.mockResolvedValue({
      name: "Alice",
      cohortGroup: {
        name: "Year 9",
        domain: { name: "English" },
        owner: { name: "Mr Smith" },
        institution: { name: "Test School", logoUrl: null, welcomeMessage: null },
      },
    });
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue({
      topTopics: [{ topic: "ISA allowances", lastMentioned: "2026-02-15T10:00:00Z" }],
      topicCount: 3,
    });
    mockPrisma.conversationArtifact.count.mockResolvedValue(5);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.totalCalls).toBe(10);
    expect(body.goals).toHaveLength(1);
    expect(body.profile.callsAnalyzed).toBe(5);
    expect(body.classroom).toBe("Year 9");
    expect(body.domain).toBe("English");
    expect(body.topTopics).toHaveLength(1);
    expect(body.topTopics[0].topic).toBe("ISA allowances");
    expect(body.topicCount).toBe(3);
    expect(body.keyFactCount).toBe(5);
    expect(body.teacherName).toBe("Mr Smith");
    expect(body.institutionName).toBe("Test School");
  });

  it("returns null profile when none exists", async () => {
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.caller.findUnique.mockResolvedValue({
      name: "Bob",
      cohortGroup: {
        name: "Year 10",
        domain: { name: "Maths" },
        owner: { name: "Mrs Jones" },
        institution: null,
      },
    });
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
    mockPrisma.conversationArtifact.count.mockResolvedValue(0);

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.profile).toBeNull();
    expect(body.totalCalls).toBe(0);
    expect(body.topTopics).toEqual([]);
    expect(body.topicCount).toBe(0);
    expect(body.keyFactCount).toBe(0);
  });

  it("returns auth error when requireStudentOrAdmin fails", async () => {
    const { requireStudentOrAdmin } = await import("@/lib/student-access");
    const { NextResponse } = await import("next/server");
    (requireStudentOrAdmin as any).mockResolvedValueOnce({
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET();
    expect(res.status).toBe(401);
  });
});
