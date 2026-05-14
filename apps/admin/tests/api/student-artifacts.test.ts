/**
 * Tests for Student Artifacts API:
 *   GET  /api/student/artifacts          — List student's artifacts
 *   GET  /api/student/notifications      — Unread artifact count
 *   POST /api/student/artifacts/mark-read — Batch mark as READ
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  conversationArtifact: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
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

// =====================================================
// GET /api/student/artifacts
// =====================================================

describe("GET /api/student/artifacts", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/artifacts/route");
    GET = mod.GET;
  });

  it("returns artifacts and unread count", async () => {
    const mockArtifacts = [
      {
        id: "art-1",
        callId: null,
        type: "STUDY_NOTE",
        title: "Chapter 3 Notes",
        content: "Key points...",
        status: "DELIVERED",
        trustLevel: "VERIFIED",
        confidence: 1.0,
        channel: "educator",
        createdAt: new Date("2026-02-14"),
        readAt: null,
        createdBy: "edu-user-1",
        call: null,
      },
      {
        id: "art-2",
        callId: "call-1",
        type: "KEY_FACT",
        title: "ISA Allowance",
        content: "£20,000",
        status: "READ",
        trustLevel: "INFERRED",
        confidence: 0.95,
        channel: "sim",
        createdAt: new Date("2026-02-13"),
        readAt: new Date("2026-02-13"),
        createdBy: null,
        call: { createdAt: new Date("2026-02-13") },
      },
    ];

    mockPrisma.conversationArtifact.findMany.mockResolvedValue(mockArtifacts);
    mockPrisma.conversationArtifact.count.mockResolvedValue(1);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.artifacts).toHaveLength(2);
    expect(body.counts.total).toBe(2);
    expect(body.counts.unread).toBe(1);
  });

  it("returns empty when no artifacts", async () => {
    mockPrisma.conversationArtifact.findMany.mockResolvedValue([]);
    mockPrisma.conversationArtifact.count.mockResolvedValue(0);

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.artifacts).toHaveLength(0);
    expect(body.counts.unread).toBe(0);
  });
});

// =====================================================
// GET /api/student/notifications
// =====================================================

describe("GET /api/student/notifications", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/app/api/student/notifications/route");
    GET = mod.GET;
  });

  it("returns unread count", async () => {
    mockPrisma.conversationArtifact.count.mockResolvedValue(3);

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.unreadCount).toBe(3);
  });

  it("returns zero when no unread", async () => {
    mockPrisma.conversationArtifact.count.mockResolvedValue(0);

    const res = await GET();
    const body = await res.json();

    expect(body.unreadCount).toBe(0);
  });
});

// =====================================================
// POST /api/student/artifacts/mark-read
// =====================================================

describe("POST /api/student/artifacts/mark-read", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/app/api/student/artifacts/mark-read/route");
    POST = mod.POST;
  });

  it("marks artifacts as read", async () => {
    mockPrisma.conversationArtifact.updateMany.mockResolvedValue({ count: 2 });

    const request = new NextRequest("http://localhost:3000/api/student/artifacts/mark-read", {
      method: "POST",
      body: JSON.stringify({ artifactIds: ["art-1", "art-2"] }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.updated).toBe(2);

    const updateCall = mockPrisma.conversationArtifact.updateMany.mock.calls[0][0];
    expect(updateCall.where.id.in).toEqual(["art-1", "art-2"]);
    expect(updateCall.where.callerId).toBe("stu-caller-1");
    expect(updateCall.data.status).toBe("READ");
  });

  it("rejects empty array", async () => {
    const request = new NextRequest("http://localhost:3000/api/student/artifacts/mark-read", {
      method: "POST",
      body: JSON.stringify({ artifactIds: [] }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("rejects missing artifactIds", async () => {
    const request = new NextRequest("http://localhost:3000/api/student/artifacts/mark-read", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(request);
    expect(res.status).toBe(400);
  });
});
