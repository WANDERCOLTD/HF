/**
 * Tests for Educator Student Artifacts API:
 *   POST /api/educator/students/:id/artifacts — Send artifact to student
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  conversationArtifact: {
    create: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
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
  requireEducatorStudentAccess: vi.fn().mockResolvedValue({
    student: { id: "stu-caller-1", name: "Alice", cohortGroup: { ownerId: "edu-caller-1" } },
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

describe("POST /api/educator/students/:id/artifacts", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/app/api/educator/students/[id]/artifacts/route");
    POST = mod.POST;
  });

  it("creates and delivers artifact to student", async () => {
    const mockArtifact = {
      id: "art-new-1",
      callerId: "stu-caller-1",
      callId: null,
      type: "STUDY_NOTE",
      title: "Key Formulas",
      content: "A = P(1 + r)^n",
      trustLevel: "VERIFIED",
      confidence: 1.0,
      channel: "educator",
      status: "PENDING",
      createdBy: "edu-user-1",
    };

    mockPrisma.conversationArtifact.create.mockResolvedValue(mockArtifact);
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "stu-caller-1" });

    const request = new NextRequest("http://localhost:3000/api/educator/students/stu-caller-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "STUDY_NOTE",
        title: "Key Formulas",
        content: "A = P(1 + r)^n",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "stu-caller-1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.artifact.type).toBe("STUDY_NOTE");
    expect(mockChannel.deliver).toHaveBeenCalledOnce();
  });

  it("rejects invalid type", async () => {
    const request = new NextRequest("http://localhost:3000/api/educator/students/stu-caller-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "INVALID_TYPE",
        title: "Test",
        content: "Test content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "stu-caller-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects missing title", async () => {
    const request = new NextRequest("http://localhost:3000/api/educator/students/stu-caller-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "STUDY_NOTE",
        content: "Test content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "stu-caller-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects missing content", async () => {
    const request = new NextRequest("http://localhost:3000/api/educator/students/stu-caller-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        type: "STUDY_NOTE",
        title: "Test",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request, { params: Promise.resolve({ id: "stu-caller-1" }) });
    expect(res.status).toBe(400);
  });
});
