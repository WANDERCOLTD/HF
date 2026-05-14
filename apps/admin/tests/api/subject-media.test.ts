import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  subject: {
    findUnique: vi.fn(),
  },
  subjectMedia: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  mediaAsset: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

describe("/api/subjects/[subjectId]/media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.resetModules() omitted — re-import not needed since mocks are top-level
  });

  describe("GET", () => {
    it("returns paginated media list", async () => {
      mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1" });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          id: "sm-1",
          sortOrder: 0,
          media: {
            id: "media-1",
            fileName: "photo.jpg",
            fileSize: 2048,
            mimeType: "image/jpeg",
            title: "Test Photo",
            description: null,
            tags: ["content"],
            trustLevel: "UNVERIFIED",
            createdAt: new Date("2026-01-01"),
          },
        },
      ]);
      mockPrisma.subjectMedia.count.mockResolvedValue(1);

      const { GET } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media?limit=20&offset=0");
      const response = await GET(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.media).toHaveLength(1);
      expect(data.media[0].id).toBe("media-1");
      expect(data.total).toBe(1);
    });

    it("returns 404 for nonexistent subject", async () => {
      mockPrisma.subject.findUnique.mockResolvedValue(null);

      const { GET } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/nope/media");
      const response = await GET(request, {
        params: Promise.resolve({ subjectId: "nope" }),
      });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });

    it("filters by MIME type prefix", async () => {
      mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1" });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([]);
      mockPrisma.subjectMedia.count.mockResolvedValue(0);

      const { GET } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media?type=image");
      const response = await GET(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      expect(response.status).toBe(200);
      expect(mockPrisma.subjectMedia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            media: { mimeType: { startsWith: "image" } },
          }),
        })
      );
    });
  });

  describe("POST", () => {
    it("links existing media to subject", async () => {
      mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1" });
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({ id: "media-1" });
      mockPrisma.subjectMedia.upsert.mockResolvedValue({
        id: "sm-1",
        subjectId: "sub-1",
        mediaId: "media-1",
      });

      const { POST } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: "media-1" }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("returns 400 when mediaId missing", async () => {
      const { POST } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await POST(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
    });

    it("returns 404 when media does not exist", async () => {
      mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1" });
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);

      const { POST } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: "nonexistent" }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });
  });

  describe("DELETE", () => {
    it("unlinks media from subject", async () => {
      const { DELETE } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: "media-1" }),
      });

      const response = await DELETE(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockPrisma.subjectMedia.deleteMany).toHaveBeenCalledWith({
        where: { subjectId: "sub-1", mediaId: "media-1" },
      });
    });

    it("returns 400 when mediaId missing", async () => {
      const { DELETE } = await import("@/app/api/subjects/[subjectId]/media/route");

      const request = new NextRequest("http://localhost/api/subjects/sub-1/media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await DELETE(request, {
        params: Promise.resolve({ subjectId: "sub-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
    });
  });
});
