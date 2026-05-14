/**
 * Tests for Educator Classroom Artifacts API:
 *   POST /api/educator/classrooms/:id/artifacts — Send artifact to all students in class
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  conversationArtifact: {
    create: vi.fn(),
  },
  caller: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  callerCohortMembership: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/educator-access", () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: { user: { id: "edu-user-1", role: "EDUCATOR" } },
    callerId: "edu-caller-1",
    institutionId: null,
  }),
  isEducatorAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
  requireEducatorCohortOwnership: vi.fn().mockResolvedValue({
    cohort: { id: "cohort-1", ownerId: "edu-caller-1" },
  }),
}));

const mockChannel = {
  name: "sim",
  canDeliver: vi.fn().mockReturnValue(true),
  deliver: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock("@/lib/artifacts/channels", () => ({
  getDeliveryChannel: () => mockChannel,
}));

describe("POST /api/educator/classrooms/:id/artifacts", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/app/api/educator/classrooms/[id]/artifacts/route");
    POST = mod.POST;
  });

  it("creates artifacts for all students in class", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([
      { callerId: "stu-1", cohortGroupId: "cohort-1", caller: { id: "stu-1", role: "LEARNER" } },
      { callerId: "stu-2", cohortGroupId: "cohort-1", caller: { id: "stu-2", role: "LEARNER" } },
      { callerId: "stu-3", cohortGroupId: "cohort-1", caller: { id: "stu-3", role: "LEARNER" } },
    ]);
    mockPrisma.conversationArtifact.create.mockResolvedValue({
      id: "art-new",
      type: "EXERCISE",
      status: "PENDING",
    });
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "stu-1" });

    const request = new NextRequest("http://localhost:3000/api/educator/classrooms/cohort-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "EXERCISE",
        title: "Practice Problem Set",
        content: "Solve the following...",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "cohort-1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(3);
    expect(body.total).toBe(3);
    expect(mockPrisma.conversationArtifact.create).toHaveBeenCalledTimes(3);
  });

  it("rejects when no students in classroom", async () => {
    mockPrisma.callerCohortMembership.findMany.mockResolvedValue([]);

    const request = new NextRequest("http://localhost:3000/api/educator/classrooms/cohort-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "STUDY_NOTE",
        title: "Notes",
        content: "Content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "cohort-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("No students");
  });

  it("rejects invalid artifact type", async () => {
    const request = new NextRequest("http://localhost:3000/api/educator/classrooms/cohort-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "BOGUS",
        title: "Test",
        content: "Content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "cohort-1" }) });
    expect(res.status).toBe(400);
  });
});
