/**
 * Tests for PATCH /api/content-sources/:sourceId/questions/:questionId
 * and POST /api/content-sources/:sourceId/questions/bulk-review
 *
 * Verifies:
 * - Auth enforcement (OPERATOR for PATCH/bulk, ADMIN for DELETE)
 * - PATCH updates fields + markReviewed sets reviewer
 * - PATCH validates difficulty range
 * - DELETE removes question
 * - Bulk review validates IDs belong to source
 * - Bulk review caps at 100
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  questionFindUnique: vi.fn(),
  questionUpdate: vi.fn(),
  questionDelete: vi.fn(),
  questionCount: vi.fn(),
  questionUpdateMany: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentQuestion: {
      findUnique: mocks.questionFindUnique,
      update: mocks.questionUpdate,
      delete: mocks.questionDelete,
      count: mocks.questionCount,
      updateMany: mocks.questionUpdateMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { PATCH, DELETE } from "@/app/api/content-sources/[sourceId]/questions/[questionId]/route";
import { POST as BULK_POST } from "@/app/api/content-sources/[sourceId]/questions/bulk-review/route";
import { NextRequest } from "next/server";

function makePatchRequest(body: Record<string, any>) {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/questions/q-1"),
    { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  );
}

function makeDeleteRequest() {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/questions/q-1"),
    { method: "DELETE" },
  );
}

function makeBulkRequest(body: Record<string, any>) {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/questions/bulk-review"),
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  );
}

const makeParams = (extra: Record<string, string> = {}) =>
  Promise.resolve({ sourceId: "src-1", questionId: "q-1", ...extra });

describe("PATCH /api/content-sources/:sourceId/questions/:questionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.questionFindUnique.mockResolvedValue({
      id: "q-1",
      sourceId: "src-1",
      questionText: "Original?",
      questionType: "MCQ",
    });
    mocks.questionUpdate.mockResolvedValue({ id: "q-1", questionText: "Updated?" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PATCH(makePatchRequest({}), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent question", async () => {
    mocks.questionFindUnique.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest({ questionText: "New?" }), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it("updates question text", async () => {
    const res = await PATCH(makePatchRequest({ questionText: "Updated question text?" }), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mocks.questionUpdate).toHaveBeenCalledWith({
      where: { id: "q-1" },
      data: expect.objectContaining({ questionText: "Updated question text?" }),
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
    expect(mocks.questionUpdate).toHaveBeenCalledWith({
      where: { id: "q-1" },
      data: expect.objectContaining({
        reviewedBy: "u1",
        reviewedAt: expect.any(Date),
      }),
    });
  });

  it("validates questionType", async () => {
    const res = await PATCH(makePatchRequest({ questionType: "INVALID" }), { params: makeParams() });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/content-sources/:sourceId/questions/:questionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "ADMIN" } },
    });
    mocks.questionFindUnique.mockResolvedValue({ id: "q-1", sourceId: "src-1" });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("deletes question and returns id", async () => {
    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted.id).toBe("q-1");
  });
});

describe("POST /api/content-sources/:sourceId/questions/bulk-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
    mocks.questionCount.mockResolvedValue(3);
    mocks.questionUpdateMany.mockResolvedValue({ count: 3 });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await BULK_POST(makeBulkRequest({ questionIds: ["q-1"] }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects empty array", async () => {
    const res = await BULK_POST(makeBulkRequest({ questionIds: [] }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 IDs", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `q-${i}`);
    const res = await BULK_POST(makeBulkRequest({ questionIds: ids }), { params: Promise.resolve({ sourceId: "src-1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects if IDs don't belong to source", async () => {
    mocks.questionCount.mockResolvedValue(2); // 3 requested but only 2 found
    const res = await BULK_POST(
      makeBulkRequest({ questionIds: ["q-1", "q-2", "q-3"] }),
      { params: Promise.resolve({ sourceId: "src-1" }) },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("marks matching questions as reviewed", async () => {
    const res = await BULK_POST(
      makeBulkRequest({ questionIds: ["q-1", "q-2", "q-3"] }),
      { params: Promise.resolve({ sourceId: "src-1" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.updated).toBe(3);
    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["q-1", "q-2", "q-3"] }, sourceId: "src-1" },
      data: { reviewedBy: "u1", reviewedAt: expect.any(Date) },
    });
  });
});
