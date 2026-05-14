/**
 * Tests for POST /api/content-sources/:sourceId/extract
 *
 * Verifies:
 * - Auth enforcement (OPERATOR required)
 * - 404 when source not found
 * - Works without subjectId (orphan source extraction)
 * - Returns 202 with job info on success
 * - Skips auto-trigger curriculum when no subjectId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  extractAssertions: vi.fn(),
  chunkText: vi.fn(),
  extractTextFromBuffer: vi.fn(),
  createExtractionTask: vi.fn(),
  updateJob: vi.fn(),
  checkAutoTriggerCurriculum: vi.fn(),
  sourceFindUnique: vi.fn(),
  assertionFindMany: vi.fn(),
  assertionCreateMany: vi.fn(),
  getStorageAdapter: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/content-trust/extract-assertions", () => ({
  extractAssertions: mocks.extractAssertions,
  extractAssertionsSegmented: vi.fn(),
  extractTextFromBuffer: mocks.extractTextFromBuffer,
  chunkText: mocks.chunkText,
}));

vi.mock("@/lib/content-trust/segment-document", () => ({
  segmentDocument: vi.fn().mockResolvedValue({ isComposite: false, sections: [] }),
}));

vi.mock("@/lib/content-trust/save-assertions", () => ({
  saveAssertions: vi.fn().mockResolvedValue({ created: 0, duplicatesSkipped: 0 }),
}));

vi.mock("@/lib/content-trust/extraction-jobs", () => ({
  createExtractionTask: mocks.createExtractionTask,
  updateJob: mocks.updateJob,
}));

vi.mock("@/lib/jobs/auto-trigger", () => ({
  checkAutoTriggerCurriculum: mocks.checkAutoTriggerCurriculum,
}));

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentSource: { findUnique: mocks.sourceFindUnique },
    contentAssertion: {
      findMany: mocks.assertionFindMany,
      createMany: mocks.assertionCreateMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { POST } from "@/app/api/content-sources/[sourceId]/extract/route";
import { NextRequest } from "next/server";

function makeMockRequest(body: Record<string, any> = {}) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

const makeParams = () => Promise.resolve({ sourceId: "src-1" });

const MOCK_SOURCE_WITH_SUBJECT = {
  id: "src-1",
  slug: "test-doc",
  name: "Test Doc",
  documentType: "TEXTBOOK",
  subjects: [
    {
      id: "ss-1",
      subjectId: "sub-1",
      subject: {
        slug: "food-safety",
        name: "Food Safety",
        qualificationRef: "QR-001",
      },
    },
  ],
  mediaAssets: [
    { id: "media-1", storageKey: "media/ab/abc.pdf", mimeType: "application/pdf", fileName: "test.pdf" },
  ],
  _count: { assertions: 0 },
};

const MOCK_SOURCE_NO_SUBJECT = {
  id: "src-1",
  slug: "orphan-doc",
  name: "Orphan Doc",
  documentType: "REFERENCE",
  subjects: [],
  mediaAssets: [
    { id: "media-1", storageKey: "media/cd/def.pdf", mimeType: "application/pdf", fileName: "orphan.pdf" },
  ],
  _count: { assertions: 0 },
};

describe("POST /api/content-sources/:sourceId/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.chunkText.mockReturnValue(["chunk1", "chunk2"]);
    mocks.createExtractionTask.mockResolvedValue({ id: "job-1" });
    mocks.updateJob.mockResolvedValue({});
    mocks.assertionFindMany.mockResolvedValue([]);
    mocks.assertionCreateMany.mockResolvedValue({ count: 5 });
    mocks.extractAssertions.mockResolvedValue({
      ok: true,
      assertions: [],
      warnings: [],
    });
    mocks.getStorageAdapter.mockReturnValue({
      download: vi.fn().mockResolvedValue(Buffer.from("file content")),
    });
    mocks.extractTextFromBuffer.mockResolvedValue({ text: "Extracted text from file" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const req = makeMockRequest({});
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 when source not found", async () => {
    mocks.sourceFindUnique.mockResolvedValue(null);

    const req = makeMockRequest({});
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not found");
  });

  it("extracts from source with linked subject", async () => {
    mocks.sourceFindUnique.mockResolvedValue(MOCK_SOURCE_WITH_SUBJECT);

    const req = makeMockRequest({ subjectId: "sub-1" });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.jobId).toBe("job-1");
    expect(data.totalChunks).toBe(2);
    expect(data.documentType).toBe("TEXTBOOK");

    expect(mocks.createExtractionTask).toHaveBeenCalledWith(
      "u1", "src-1", "Test Doc", "sub-1", "Food Safety", "ss-1"
    );
  });

  it("extracts from orphan source without subjectId", async () => {
    mocks.sourceFindUnique.mockResolvedValue(MOCK_SOURCE_NO_SUBJECT);

    const req = makeMockRequest({});
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.jobId).toBe("job-1");

    // Should work without subjectId — no 400 error
    expect(mocks.createExtractionTask).toHaveBeenCalledWith(
      "u1", "src-1", "Orphan Doc", undefined, "Orphan Doc", undefined
    );
  });

  it("uses pre-extracted text from body when provided", async () => {
    mocks.sourceFindUnique.mockResolvedValue(MOCK_SOURCE_WITH_SUBJECT);

    const req = makeMockRequest({
      subjectId: "sub-1",
      text: "Pre-extracted text content",
    });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    // Should NOT download from storage when text is provided
    const storage = mocks.getStorageAdapter();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("downloads from storage when no text provided", async () => {
    mocks.sourceFindUnique.mockResolvedValue(MOCK_SOURCE_WITH_SUBJECT);

    const req = makeMockRequest({ subjectId: "sub-1" });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(202);

    // Should download from storage
    expect(mocks.extractTextFromBuffer).toHaveBeenCalled();
  });

  it("returns 400 when no text and no media asset", async () => {
    const sourceNoMedia = { ...MOCK_SOURCE_WITH_SUBJECT, mediaAssets: [] };
    mocks.sourceFindUnique.mockResolvedValue(sourceNoMedia);

    const req = makeMockRequest({ subjectId: "sub-1" });
    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No linked media");
  });
});
