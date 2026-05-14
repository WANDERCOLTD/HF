/**
 * Tests for POST /api/subjects/:subjectId/upload
 *
 * Verifies:
 * - Auth enforcement (OPERATOR required)
 * - 404 when subject not found
 * - 400 when no file uploaded
 * - 400 for unsupported file types
 * - Classifies document, stores file, creates ContentSource without extraction
 * - Auto-adds "syllabus" tag for CURRICULUM type
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  extractTextFromBuffer: vi.fn(),
  classifyDocument: vi.fn(),
  resolveExtractionConfig: vi.fn(),
  subjectFindUnique: vi.fn(),
  contentSourceCreate: vi.fn(),
  subjectSourceCreate: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetCreate: vi.fn(),
  mediaAssetUpdate: vi.fn(),
  subjectMediaUpsert: vi.fn(),
  computeContentHash: vi.fn(),
  getStorageAdapter: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/content-trust/extract-assertions", () => ({
  extractTextFromBuffer: mocks.extractTextFromBuffer,
}));

vi.mock("@/lib/content-trust/classify-document", () => ({
  classifyDocument: mocks.classifyDocument,
  fetchFewShotExamples: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/content-trust/resolve-config", () => ({
  resolveExtractionConfig: mocks.resolveExtractionConfig,
}));

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
  computeContentHash: mocks.computeContentHash,
}));

vi.mock("@/lib/config", () => ({
  config: { storage: { backend: "local" } },
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    subject: { findUnique: mocks.subjectFindUnique },
    contentSource: { create: mocks.contentSourceCreate },
    subjectSource: { create: mocks.subjectSourceCreate },
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      create: mocks.mediaAssetCreate,
      update: mocks.mediaAssetUpdate,
    },
    subjectMedia: { upsert: mocks.subjectMediaUpsert },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { POST } from "@/app/api/subjects/[subjectId]/upload/route";
import { NextRequest } from "next/server";

/**
 * Creates a mock NextRequest whose formData() returns controlled entries.
 * File-like objects include arrayBuffer() which jsdom's File doesn't support.
 */
function makeMockRequest(fields: Record<string, File | string | null>) {
  const entries: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) {
      if (value instanceof File) {
        const content = new TextEncoder().encode("test content");
        entries[key] = {
          name: value.name,
          type: value.type,
          size: content.byteLength,
          arrayBuffer: () => Promise.resolve(content.buffer),
          text: () => Promise.resolve("test content"),
        };
      } else {
        entries[key] = value;
      }
    }
  }
  return {
    formData: () =>
      Promise.resolve({
        get: (key: string) => entries[key] ?? null,
      }),
  } as unknown as NextRequest;
}

const makeParams = () => Promise.resolve({ subjectId: "sub-1" });

const MOCK_SUBJECT = {
  id: "sub-1",
  slug: "food-safety",
  name: "Food Safety",
  defaultTrustLevel: "UNVERIFIED",
};

const MOCK_EXTRACTION_CONFIG = {
  classification: {
    sampleSize: 2000,
    systemPrompt: "test",
    llmConfig: { temperature: 0.1, maxTokens: 500 },
  },
};

const MOCK_SOURCE = {
  id: "src-1",
  slug: "food-safety-test-doc",
  name: "test doc",
  trustLevel: "UNVERIFIED",
  documentType: "CURRICULUM",
  documentTypeSource: "ai:0.94",
};

const MOCK_STORAGE = {
  upload: vi.fn().mockResolvedValue({ storageKey: "media/ab/abc123.pdf" }),
  download: vi.fn(),
  getSignedUrl: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
};

describe("POST /api/subjects/:subjectId/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.subjectFindUnique.mockResolvedValue(MOCK_SUBJECT);
    mocks.resolveExtractionConfig.mockResolvedValue(MOCK_EXTRACTION_CONFIG);
    mocks.computeContentHash.mockReturnValue("abc123hash");
    mocks.getStorageAdapter.mockReturnValue(MOCK_STORAGE);
    mocks.mediaAssetFindUnique.mockResolvedValue(null); // No duplicate
    mocks.mediaAssetCreate.mockResolvedValue({ id: "media-1" });
    mocks.subjectMediaUpsert.mockResolvedValue({ id: "sm-1", subjectId: "sub-1", mediaId: "media-1" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const file = new File(["test content"], "document.pdf", { type: "application/pdf" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 when subject not found", async () => {
    mocks.subjectFindUnique.mockResolvedValue(null);

    const file = new File(["test content"], "document.pdf", { type: "application/pdf" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Subject not found");
  });

  it("returns 400 when no file uploaded", async () => {
    const req = makeMockRequest({});
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No file");
  });

  it("returns 400 for unsupported file type", async () => {
    const file = new File(["binary data"], "test.exe", { type: "application/x-msdownload" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Unsupported file type");
  });

  it("classifies, stores file, and creates source without extracting", async () => {
    const extractedText = "Module 1: Learning Outcomes\nLO1: Understand food safety";
    mocks.extractTextFromBuffer.mockResolvedValue({ text: extractedText });
    mocks.classifyDocument.mockResolvedValue({
      documentType: "CURRICULUM",
      confidence: 0.94,
      reasoning: "Contains LOs and ACs",
    });
    mocks.contentSourceCreate.mockResolvedValue(MOCK_SOURCE);
    mocks.subjectSourceCreate.mockResolvedValue({});

    const file = new File(["test content"], "test-doc.pdf", { type: "application/pdf" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.awaitingClassification).toBe(true);
    expect(data.mediaId).toBe("media-1");
    expect(data.classification.documentType).toBe("CURRICULUM");
    expect(data.classification.confidence).toBe(0.94);
    expect(data.source.id).toBe("src-1");
    expect(data.source.documentType).toBe("CURRICULUM");

    // Verify file was stored
    expect(mocks.computeContentHash).toHaveBeenCalled();
    expect(MOCK_STORAGE.upload).toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: "src-1",
          contentHash: "abc123hash",
          storageType: "local",
        }),
      })
    );

    // Verify contentSourceCreate was called with classified documentType
    expect(mocks.contentSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentType: "CURRICULUM",
          documentTypeSource: "ai:0.94",
        }),
      })
    );

    // Verify SubjectMedia link was created
    expect(mocks.subjectMediaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectId_mediaId: { subjectId: "sub-1", mediaId: "media-1" } },
        create: { subjectId: "sub-1", mediaId: "media-1" },
      })
    );

    // Verify classifyDocument was called with truncated text sample + examples
    expect(mocks.classifyDocument).toHaveBeenCalledWith(
      extractedText.substring(0, MOCK_EXTRACTION_CONFIG.classification.sampleSize),
      "test-doc.pdf",
      MOCK_EXTRACTION_CONFIG,
      [], // few-shot examples (mocked to empty)
    );
  });

  it("auto-adds syllabus tag for CURRICULUM type", async () => {
    mocks.extractTextFromBuffer.mockResolvedValue({
      text: "Module 1: Learning Outcomes\nLO1: Understand food safety",
    });
    mocks.classifyDocument.mockResolvedValue({
      documentType: "CURRICULUM",
      confidence: 0.91,
      reasoning: "Curriculum document with learning outcomes",
    });
    mocks.contentSourceCreate.mockResolvedValue(MOCK_SOURCE);
    mocks.subjectSourceCreate.mockResolvedValue({});

    const file = new File(["test content"], "curriculum.pdf", { type: "application/pdf" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    // Default tags = ["content"], CURRICULUM should auto-add "syllabus"
    expect(mocks.subjectSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectId: "sub-1",
          tags: expect.arrayContaining(["content", "syllabus"]),
        }),
      })
    );

    const data = await res.json();
    expect(data.tags).toContain("syllabus");
  });

  it("reuses existing media asset when content hash matches", async () => {
    mocks.extractTextFromBuffer.mockResolvedValue({ text: "Some content" });
    mocks.classifyDocument.mockResolvedValue({
      documentType: "TEXTBOOK",
      confidence: 0.85,
      reasoning: "Dense reference material",
    });
    mocks.contentSourceCreate.mockResolvedValue({
      ...MOCK_SOURCE,
      id: "src-2",
      documentType: "TEXTBOOK",
      documentTypeSource: "ai:0.85",
    });
    mocks.subjectSourceCreate.mockResolvedValue({});

    // Existing media with same hash
    mocks.mediaAssetFindUnique.mockResolvedValue({ id: "existing-media" });

    const file = new File(["test content"], "textbook.pdf", { type: "application/pdf" });
    const req = makeMockRequest({ file });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.mediaId).toBe("existing-media");

    // Should NOT upload a new file
    expect(MOCK_STORAGE.upload).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();

    // Should create SubjectMedia link for reused media
    expect(mocks.subjectMediaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectId_mediaId: { subjectId: "sub-1", mediaId: "existing-media" } },
        create: { subjectId: "sub-1", mediaId: "existing-media" },
      })
    );

    // Should update existing media to link to new source
    expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-media" },
        data: { sourceId: "src-2" },
      })
    );
  });
});
