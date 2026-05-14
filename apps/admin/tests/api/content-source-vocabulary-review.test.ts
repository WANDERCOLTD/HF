/**
 * Tests for PATCH /api/content-sources/:sourceId/vocabulary/:vocabId
 * and POST /api/content-sources/:sourceId/vocabulary/bulk-review
 *
 * Verifies:
 * - Auth enforcement (OPERATOR for PATCH/bulk, ADMIN for DELETE)
 * - PATCH updates fields + markReviewed sets reviewer
 * - PATCH validates term/definition length
 * - DELETE removes vocabulary entry
 * - Bulk review validates IDs belong to source
 * - Bulk review caps at 100
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  vocabFindUnique: vi.fn(),
  vocabUpdate: vi.fn(),
  vocabDelete: vi.fn(),
  vocabCount: vi.fn(),
  vocabUpdateMany: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentVocabulary: {
      findUnique: mocks.vocabFindUnique,
      update: mocks.vocabUpdate,
      delete: mocks.vocabDelete,
      count: mocks.vocabCount,
      updateMany: mocks.vocabUpdateMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { PATCH, DELETE } from "@/app/api/content-sources/[sourceId]/vocabulary/[vocabId]/route";
import { POST as BULK_POST } from "@/app/api/content-sources/[sourceId]/vocabulary/bulk-review/route";
import { NextRequest } from "next/server";

function makePatchRequest(body: Record<string, any>) {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/vocabulary/v-1"),
    { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  );
}

function makeDeleteRequest() {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/vocabulary/v-1"),
    { method: "DELETE" },
  );
}

function makeBulkRequest(body: Record<string, any>) {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/vocabulary/bulk-review"),
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  );
}

const makeParams = (extra: Record<string, string> = {}) =>
  Promise.resolve({ sourceId: "src-1", vocabId: "v-1", ...extra });

describe("PATCH /api/content-sources/:sourceId/vocabulary/:vocabId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.vocabFindUnique.mockResolvedValue({
      id: "v-1",
      sourceId: "src-1",
      term: "to clash",
      definition: "to be in conflict",
    });
    mocks.vocabUpdate.mockResolvedValue({ id: "v-1", term: "updated" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PATCH(makePatchRequest({}), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent vocabulary", async () => {
    mocks.vocabFindUnique.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest({ term: "new" }), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it("updates term and definition", async () => {
    const res = await PATCH(makePatchRequest({ term: "negotiate", definition: "to discuss terms" }), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mocks.vocabUpdate).toHaveBeenCalledWith({
      where: { id: "v-1" },
      data: expect.objectContaining({ term: "negotiate", definition: "to discuss terms" }),
    });
  });

  it("validates difficulty range", async () => {
    const res = await PATCH(makePatchRequest({ difficulty: 10 }), { params: makeParams() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("difficulty");
  });

  it("marks as reviewed with user info", async () => {
    await PATCH(makePatchRequest({ markReviewed: true }), { params: makeParams() });
    expect(mocks.vocabUpdate).toHaveBeenCalledWith({
      where: { id: "v-1" },
      data: expect.objectContaining({
        reviewedBy: "u1",
        reviewedAt: expect.any(Date),
      }),
    });
  });

  it("rejects empty term", async () => {
    const res = await PATCH(makePatchRequest({ term: "" }), { params: makeParams() });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/content-sources/:sourceId/vocabulary/:vocabId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "ADMIN" } },
    });
    mocks.vocabFindUnique.mockResolvedValue({ id: "v-1", sourceId: "src-1" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("deletes vocabulary and returns id", async () => {
    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted.id).toBe("v-1");
  });
});

describe("POST /api/content-sources/:sourceId/vocabulary/bulk-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.vocabCount.mockResolvedValue(2);
    mocks.vocabUpdateMany.mockResolvedValue({ count: 2 });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await BULK_POST(makeBulkRequest({ vocabularyIds: ["v-1"] }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects empty array", async () => {
    const res = await BULK_POST(makeBulkRequest({ vocabularyIds: [] }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 IDs", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `v-${i}`);
    const res = await BULK_POST(makeBulkRequest({ vocabularyIds: ids }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects if IDs don't belong to source", async () => {
    mocks.vocabCount.mockResolvedValue(1); // 2 requested but only 1 found
    const res = await BULK_POST(
      makeBulkRequest({ vocabularyIds: ["v-1", "v-2"] }),
      { params: Promise.resolve({ sourceId: "src-1" }) },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("marks matching vocabulary as reviewed", async () => {
    const res = await BULK_POST(
      makeBulkRequest({ vocabularyIds: ["v-1", "v-2"] }),
      { params: Promise.resolve({ sourceId: "src-1" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.updated).toBe(2);
    expect(mocks.vocabUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["v-1", "v-2"] }, sourceId: "src-1" },
      data: { reviewedBy: "u1", reviewedAt: expect.any(Date) },
    });
  });
});
