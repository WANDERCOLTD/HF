import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockIsAllowedMimeType = vi.fn().mockReturnValue(true);
const mockIsAllowedFileSize = vi.fn().mockReturnValue(true);

const mockPrisma = {
  mediaAsset: {
    findUnique: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "ADMIN" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

const mockStorage = {
  getSignedUrl: vi.fn().mockResolvedValue("https://storage.example.com/signed-url"),
  download: vi.fn().mockResolvedValue(Buffer.from("fake-file-content")),
  delete: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue({ storageKey: "media/ne/newhash.png" }),
};

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: vi.fn(() => mockStorage),
  computeContentHash: vi.fn().mockReturnValue("newhash1234567890"),
  isAllowedMimeType: (...args: any[]) => mockIsAllowedMimeType(...args),
  isAllowedFileSize: (...args: any[]) => mockIsAllowedFileSize(...args),
}));

vi.mock("@/lib/config", () => ({
  config: {
    storage: {
      backend: "local",
      allowedMimeTypes: ["image/png", "image/jpeg"],
      maxFileSize: 20971520,
    },
  },
}));

describe("/api/media/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAllowedMimeType.mockReturnValue(true);
    mockIsAllowedFileSize.mockReturnValue(true);
  });

  describe("GET", () => {
    it("downloads file content for stored media", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        storageKey: "media/ab/abcdef.jpg",
        storageType: "gcs",
      });

      const { GET } = await import("@/app/api/media/[id]/route");

      const request = new NextRequest("http://localhost/api/media/media-1");
      const response = await GET(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("content-disposition")).toContain("photo.jpg");
      expect(mockStorage.download).toHaveBeenCalledWith("media/ab/abcdef.jpg");
    });

    it("returns 404 for nonexistent media", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);

      const { GET } = await import("@/app/api/media/[id]/route");

      const request = new NextRequest("http://localhost/api/media/nonexistent");
      const response = await GET(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });
  });

  describe("DELETE", () => {
    it("deletes media from storage and database", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        storageKey: "media/ab/abcdef.jpg",
      });

      const { DELETE } = await import("@/app/api/media/[id]/route");

      const request = new NextRequest("http://localhost/api/media/media-1", { method: "DELETE" });
      const response = await DELETE(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockStorage.delete).toHaveBeenCalledWith("media/ab/abcdef.jpg");
      expect(mockPrisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: "media-1" } });
    });

    it("returns 404 when deleting nonexistent media", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);

      const { DELETE } = await import("@/app/api/media/[id]/route");

      const request = new NextRequest("http://localhost/api/media/nope", { method: "DELETE" });
      const response = await DELETE(request, {
        params: Promise.resolve({ id: "nope" }),
      });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });
  });

  describe("PATCH (file replacement)", () => {
    const existingMedia = {
      id: "media-1",
      fileName: "old-photo.png",
      mimeType: "image/png",
      fileSize: 1024,
      contentHash: "oldhash1234567890",
      storageKey: "media/ol/oldhash.png",
      storageType: "local",
      title: "Old Photo",
    };

    it("replaces file content and updates DB record", async () => {
      mockPrisma.mediaAsset.findUnique
        .mockResolvedValueOnce(existingMedia)   // lookup by id
        .mockResolvedValueOnce(null);            // hash collision check
      mockPrisma.mediaAsset.update.mockResolvedValue({
        ...existingMedia,
        id: "media-1",
        fileName: "new-photo.png",
        mimeType: "image/png",
        fileSize: 2048,
        contentHash: "newhash1234567890",
        storageKey: "media/ne/newhash.png",
        title: "Old Photo",
      });

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      formData.append("file", new File(["new content"], "new-photo.png", { type: "image/png" }));

      const request = new NextRequest("http://localhost/api/media/media-1", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.media.fileName).toBe("new-photo.png");
      expect(data.previousFileName).toBe("old-photo.png");
      expect(mockStorage.delete).toHaveBeenCalledWith("media/ol/oldhash.png");
      expect(mockStorage.upload).toHaveBeenCalled();
    });

    it("returns 404 for nonexistent media", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      formData.append("file", new File(["data"], "test.png", { type: "image/png" }));

      const request = new NextRequest("http://localhost/api/media/nope", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "nope" }),
      });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });

    it("returns 400 when no file provided", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(existingMedia);

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      const request = new NextRequest("http://localhost/api/media/media-1", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain("No replacement file");
    });

    it("rejects disallowed MIME types", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(existingMedia);
      mockIsAllowedMimeType.mockReturnValue(false);

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      formData.append("file", new File(["data"], "evil.exe", { type: "application/x-msdownload" }));

      const request = new NextRequest("http://localhost/api/media/media-1", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain("not allowed");
    });

    it("returns no-change when content hash is identical", async () => {
      // computeContentHash mock returns "newhash1234567890", so set existing to match
      const sameHashMedia = { ...existingMedia, contentHash: "newhash1234567890" };
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(sameHashMedia);

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      formData.append("file", new File(["same"], "same.png", { type: "image/png" }));

      const request = new NextRequest("http://localhost/api/media/media-1", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.noChange).toBe(true);
      expect(mockStorage.upload).not.toHaveBeenCalled();
    });

    it("returns 409 when new content matches a different media asset", async () => {
      mockPrisma.mediaAsset.findUnique
        .mockResolvedValueOnce(existingMedia)                          // lookup by id
        .mockResolvedValueOnce({ id: "other-media", contentHash: "newhash1234567890" }); // collision

      const { PATCH } = await import("@/app/api/media/[id]/route");

      const formData = new FormData();
      formData.append("file", new File(["data"], "dup.png", { type: "image/png" }));

      const request = new NextRequest("http://localhost/api/media/media-1", {
        method: "PATCH",
        body: formData,
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "media-1" }),
      });

      const data = await response.json();
      expect(response.status).toBe(409);
      expect(data.error).toContain("already exists");
      expect(data.existingMediaId).toBe("other-media");
    });
  });
});
