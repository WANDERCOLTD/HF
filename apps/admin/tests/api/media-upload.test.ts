import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Local mocks
const mockPrisma = {
  mediaAsset: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  subjectMedia: {
    upsert: vi.fn(),
    create: vi.fn(),
  },
};

const mockIsAllowedMimeType = vi.fn().mockReturnValue(true);
const mockIsAllowedFileSize = vi.fn().mockReturnValue(true);

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({ storageKey: "media/ab/abcdef.png" }),
  })),
  computeContentHash: vi.fn().mockReturnValue("abcdef1234567890"),
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

describe("POST /api/media/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAllowedMimeType.mockReturnValue(true);
    mockIsAllowedFileSize.mockReturnValue(true);
  });

  it("uploads a new file and creates MediaAsset", async () => {
    mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);
    mockPrisma.mediaAsset.create.mockResolvedValue({
      id: "media-1",
      fileName: "test.png",
      mimeType: "image/png",
      fileSize: 1024,
      title: null,
    });

    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    formData.append("file", new File(["hello"], "test.png", { type: "image/png" }));

    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.media.id).toBe("media-1");
    expect(data.media.url).toBe("/api/media/media-1");
  });

  it("deduplicates by content hash", async () => {
    mockPrisma.mediaAsset.findUnique.mockResolvedValue({
      id: "existing-1",
      fileName: "original.png",
      mimeType: "image/png",
      fileSize: 1024,
      title: "Original",
    });

    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    formData.append("file", new File(["hello"], "duplicate.png", { type: "image/png" }));

    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.deduplicated).toBe(true);
    expect(data.media.id).toBe("existing-1");
  });

  it("returns 400 when no file provided", async () => {
    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No file");
  });

  it("rejects disallowed MIME types", async () => {
    mockIsAllowedMimeType.mockReturnValue(false);

    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    formData.append("file", new File(["data"], "evil.exe", { type: "application/x-msdownload" }));

    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not allowed");
  });

  it("rejects files that exceed max size", async () => {
    mockIsAllowedFileSize.mockReturnValue(false);

    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    formData.append("file", new File(["data"], "big.png", { type: "image/png" }));

    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("too large");
  });

  it("links to subject when subjectId provided", async () => {
    mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);
    mockPrisma.mediaAsset.create.mockResolvedValue({
      id: "media-2",
      fileName: "test.png",
      mimeType: "image/png",
      fileSize: 1024,
      title: null,
    });

    const { POST } = await import("@/app/api/media/upload/route");

    const formData = new FormData();
    formData.append("file", new File(["data"], "test.png", { type: "image/png" }));
    formData.append("subjectId", "subject-1");

    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockPrisma.subjectMedia.create).toHaveBeenCalledWith({
      data: { subjectId: "subject-1", mediaId: "media-2" },
    });
  });
});
