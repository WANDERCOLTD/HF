import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/courses/setup/route";

const mockPrisma = vi.hoisted(() => ({
  userTask: { create: vi.fn() },
}));

const mockTaskGuidance = vi.hoisted(() => ({
  startTaskTracking: vi.fn().mockResolvedValue("task-id-123"),
  updateTaskProgress: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/ai/task-guidance", () => ({
  startTaskTracking: mockTaskGuidance.startTaskTracking,
  updateTaskProgress: mockTaskGuidance.updateTaskProgress,
  completeTask: vi.fn(),
  failTask: vi.fn().mockResolvedValue(undefined),
  backgroundRun: (taskId: string, fn: () => Promise<void>) => {
    fn().catch(() => {});
  },
}));

vi.mock("@/lib/domain/course-setup", () => ({
  courseSetup: vi.fn().mockResolvedValue({
    domainId: "domain-1",
    playbookId: "playbook-1",
  }),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-1", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn((result) => "error" in result),
}));

describe("POST /api/courses/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a course setup task and returns taskId", async () => {
    const body = {
      courseName: "Advanced Python",
      learningOutcomes: ["Learn Python", "Build Projects"],
      teachingStyle: "tutor",
      sessionCount: 12,
      durationMins: 45,
      emphasis: "balanced",
      welcomeMessage: "Welcome!",
      studentEmails: ["student@example.com"],
    };

    const req = new NextRequest("http://localhost/api/courses/setup", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe("task-id-123");

    expect(mockTaskGuidance.startTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "course_setup",
      expect.objectContaining({
        courseName: "Advanced Python",
      })
    );
  });

  it("validates required fields", async () => {
    const body = {
      courseName: "",
      learningOutcomes: [],
      teachingStyle: "",
    };

    const req = new NextRequest("http://localhost/api/courses/setup", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("required");
  });

  it("fires executor non-blocking", async () => {
    const body = {
      courseName: "Test Course",
      learningOutcomes: ["Outcome 1"],
      teachingStyle: "coach",
      sessionCount: 10,
      durationMins: 30,
      emphasis: "depth",
      welcomeMessage: "Hi",
      studentEmails: [],
    };

    const req = new NextRequest("http://localhost/api/courses/setup", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    // Response should return immediately with taskId
    expect(res.status).toBe(200);
    expect(data.taskId).toBe("task-id-123");

    // Verify task was created
    expect(mockTaskGuidance.startTaskTracking).toHaveBeenCalled();
  });

  it("passes lesson plan and student enrollment fields to executor", async () => {
    const body = {
      courseName: "Biology 101",
      learningOutcomes: ["Photosynthesis", "Cell division"],
      teachingStyle: "tutor",
      sessionCount: 8,
      durationMins: 30,
      emphasis: "depth",
      welcomeMessage: "Welcome to Biology",
      studentEmails: ["a@test.com"],
      // New lesson plan fields
      subjectId: "subject-pre-created",
      curriculumId: "curriculum-pre-created",
      planIntents: { sessionCount: 8, durationMins: 30, emphasis: "depth", assessments: "light" },
      lessonPlanMode: "reviewed",
      // New student enrollment fields
      cohortGroupIds: ["cohort-1", "cohort-2"],
      selectedCallerIds: ["caller-1"],
    };

    const req = new NextRequest("http://localhost/api/courses/setup", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe("task-id-123");
  });

  it("handles missing request body", async () => {
    const req = new NextRequest("http://localhost/api/courses/setup", {
      method: "POST",
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(data.ok).toBe(false);
  });
});
