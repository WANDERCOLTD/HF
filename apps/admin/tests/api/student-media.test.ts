/**
 * Tests for Student Media API:
 *   GET /api/student/media
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callMessage: { findMany: vi.fn() },
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

const SAMPLE_MESSAGES = [
  {
    id: "msg-1",
    callId: "call-1",
    content: "Read this passage",
    createdAt: new Date("2026-02-15T10:00:00Z"),
    mediaId: "media-1",
    media: {
      id: "media-1",
      fileName: "passage.pdf",
      mimeType: "application/pdf",
      title: "Chapter 3",
    },
  },
];

describe("GET /api/student/media", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/media/route");
    GET = mod.GET;
  });

  it("returns media for authenticated student", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue(SAMPLE_MESSAGES);

    const request = new Request("http://localhost/api/student/media");
    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.media).toHaveLength(1);
    expect(body.media[0].mediaId).toBe("media-1");
    expect(body.media[0].url).toBe("/api/media/media-1");
  });

  it("returns empty list when no media shared", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/student/media");
    const res = await GET(request);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.media).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("scopes query to student callerId", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/student/media");
    await GET(request);

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.where.call.callerId).toBe("stu-caller-1");
  });

  it("supports sort and filter params", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/student/media?sort=type&order=asc&type=pdf");
    await GET(request);

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ media: { mimeType: "asc" } });
    expect(call.where.media).toEqual({ mimeType: "application/pdf" });
  });

  it("defaults to date desc", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/student/media");
    await GET(request);

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });
});
