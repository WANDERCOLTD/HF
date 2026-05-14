/**
 * Tests for Caller Media History API:
 *   GET /api/callers/:callerId/media-history
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callMessage: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "ADMIN" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

const SAMPLE_MESSAGES = [
  {
    id: "msg-1",
    callId: "call-1",
    content: "Here is the passage",
    createdAt: new Date("2026-02-15T10:00:00Z"),
    mediaId: "media-1",
    media: {
      id: "media-1",
      fileName: "passage.pdf",
      mimeType: "application/pdf",
      title: "The Black Death",
    },
  },
  {
    id: "msg-2",
    callId: "call-1",
    content: "Check this image",
    createdAt: new Date("2026-02-14T09:00:00Z"),
    mediaId: "media-2",
    media: {
      id: "media-2",
      fileName: "diagram.png",
      mimeType: "image/png",
      title: null,
    },
  },
];

describe("GET /api/callers/:callerId/media-history", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/callers/[callerId]/media-history/route");
    GET = mod.GET;
  });

  it("returns media history for a caller", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue(SAMPLE_MESSAGES);

    const request = new Request("http://localhost/api/callers/caller-1/media-history");
    const res = await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.media).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.media[0].mediaId).toBe("media-1");
    expect(body.media[0].url).toBe("/api/media/media-1");
    expect(body.media[0].fileName).toBe("passage.pdf");
  });

  it("returns empty list when no media shared", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/callers/caller-1/media-history");
    const res = await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.media).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("passes sort and order params to query", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/callers/caller-1/media-history?sort=name&order=asc");
    await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ media: { fileName: "asc" } });
  });

  it("passes type filter to query", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/callers/caller-1/media-history?type=image");
    await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.where.media).toEqual({ mimeType: { startsWith: "image/" } });
  });

  it("filters by callId when provided", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/callers/caller-1/media-history?callId=call-99");
    await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.where.callId).toBe("call-99");
  });

  it("defaults to date desc sort", async () => {
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/callers/caller-1/media-history");
    await GET(request, { params: Promise.resolve({ callerId: "caller-1" }) });

    const call = mockPrisma.callMessage.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });
});
