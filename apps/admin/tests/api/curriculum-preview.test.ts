/**
 * Tests for GET /api/subjects/:subjectId/curriculum/preview
 *
 * Verifies:
 *   - Returns preview from completed curriculum_generation task
 *   - Returns in_progress status for running tasks
 *   - Returns error for abandoned tasks
 *   - Validates taskId and subject ownership
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock Setup (vi.hoisted to avoid TDZ in mock factories) ──

const mockPrisma = vi.hoisted(() => ({
  userTask: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@example.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn((result: any) => "error" in result),
}));

import { GET } from "@/app/api/subjects/[subjectId]/curriculum/preview/route";

// ── Helpers ──

function makeRequest(taskId?: string) {
  const url = taskId
    ? `http://localhost:3000/api/subjects/sub-1/curriculum/preview?taskId=${taskId}`
    : "http://localhost:3000/api/subjects/sub-1/curriculum/preview";
  return new NextRequest(new URL(url), { method: "GET" });
}

function makeParams(subjectId: string) {
  return { params: Promise.resolve({ subjectId }) };
}

// ── Tests ──

describe("GET /api/subjects/:subjectId/curriculum/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 without taskId", async () => {
    const res = await GET(makeRequest(), makeParams("sub-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("taskId");
  });

  it("returns 404 for unknown task", async () => {
    mockPrisma.userTask.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest("unknown-task"), makeParams("sub-1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-curriculum task", async () => {
    mockPrisma.userTask.findUnique.mockResolvedValue({
      id: "task-1",
      taskType: "extraction",
      status: "completed",
      context: { subjectId: "sub-1" },
    });

    const res = await GET(makeRequest("task-1"), makeParams("sub-1"));
    expect(res.status).toBe(400);
  });

  it("returns 403 when subject does not match", async () => {
    mockPrisma.userTask.findUnique.mockResolvedValue({
      id: "task-1",
      taskType: "curriculum_generation",
      status: "completed",
      context: { subjectId: "different-subject" },
    });

    const res = await GET(makeRequest("task-1"), makeParams("sub-1"));
    expect(res.status).toBe(403);
  });

  it("returns in_progress status for running task", async () => {
    mockPrisma.userTask.findUnique.mockResolvedValue({
      id: "task-1",
      taskType: "curriculum_generation",
      status: "in_progress",
      context: { subjectId: "sub-1", assertionCount: 50 },
    });

    const res = await GET(makeRequest("task-1"), makeParams("sub-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.taskStatus).toBe("in_progress");
    expect(body.curriculum).toBeNull();
    expect(body.assertionCount).toBe(50);
  });

  it("returns error for abandoned task", async () => {
    mockPrisma.userTask.findUnique.mockResolvedValue({
      id: "task-1",
      taskType: "curriculum_generation",
      status: "abandoned",
      context: { subjectId: "sub-1", error: "AI call failed" },
    });

    const res = await GET(makeRequest("task-1"), makeParams("sub-1"));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.taskStatus).toBe("error");
    expect(body.error).toBe("AI call failed");
  });

  it("returns preview for completed task", async () => {
    const mockPreview = {
      name: "Food Safety L2",
      description: "A curriculum for food safety",
      modules: [{ id: "m1", title: "Introduction" }],
    };

    mockPrisma.userTask.findUnique.mockResolvedValue({
      id: "task-1",
      taskType: "curriculum_generation",
      status: "completed",
      context: {
        subjectId: "sub-1",
        preview: mockPreview,
        moduleCount: 1,
        warnings: [],
      },
    });

    const res = await GET(makeRequest("task-1"), makeParams("sub-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.taskStatus).toBe("completed");
    expect(body.curriculum).toEqual(mockPreview);
    expect(body.moduleCount).toBe(1);
  });
});
