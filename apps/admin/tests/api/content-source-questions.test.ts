/**
 * Tests for GET/DELETE /api/content-sources/:sourceId/questions
 *
 * Verifies:
 * - Auth enforcement (VIEWER for GET, OPERATOR for DELETE)
 * - GET returns paginated questions with filtering
 * - DELETE clears questions and returns count
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  questionFindMany: vi.fn(),
  questionCount: vi.fn(),
  questionDeleteMany: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentQuestion: {
      findMany: mocks.questionFindMany,
      count: mocks.questionCount,
      deleteMany: mocks.questionDeleteMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { GET, DELETE } from "@/app/api/content-sources/[sourceId]/questions/route";
import { NextRequest } from "next/server";

function makeGetRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/content-sources/src-1/questions");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function makeDeleteRequest() {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/questions"),
    { method: "DELETE" },
  );
}

const makeParams = () => Promise.resolve({ sourceId: "src-1" });

describe("GET /api/content-sources/:sourceId/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "VIEWER" } },
    });
    mocks.questionFindMany.mockResolvedValue([]);
    mocks.questionCount.mockResolvedValue(0);
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns empty list when no questions exist", async () => {
    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.questions).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns paginated questions", async () => {
    mocks.questionFindMany.mockResolvedValue([
      { id: "q1", questionText: "Q1?", questionType: "MCQ" },
      { id: "q2", questionText: "Q2?", questionType: "TRUE_FALSE" },
    ]);
    mocks.questionCount.mockResolvedValue(5);

    const res = await GET(makeGetRequest({ limit: "2", offset: "0" }), { params: makeParams() });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.questions).toHaveLength(2);
    expect(data.total).toBe(5);
  });

  it("filters by questionType", async () => {
    const res = await GET(makeGetRequest({ questionType: "MCQ" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.questionFindMany.mock.calls[0][0];
    expect(call.where.questionType).toBe("MCQ");
  });

  it("filters by search text", async () => {
    const res = await GET(makeGetRequest({ search: "plague" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.questionFindMany.mock.calls[0][0];
    expect(call.where.questionText).toEqual({ contains: "plague", mode: "insensitive" });
  });

  it("caps limit at 500", async () => {
    const res = await GET(makeGetRequest({ limit: "9999" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.questionFindMany.mock.calls[0][0];
    expect(call.take).toBe(500);
  });

  it("filters by reviewed=true", async () => {
    const res = await GET(makeGetRequest({ reviewed: "true" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.questionFindMany.mock.calls[0][0];
    expect(call.where.reviewedAt).toEqual({ not: null });
  });

  it("filters by reviewed=false", async () => {
    const res = await GET(makeGetRequest({ reviewed: "false" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.questionFindMany.mock.calls[0][0];
    expect(call.where.reviewedAt).toBe(null);
  });

  it("includes reviewedCount and reviewProgress in response", async () => {
    mocks.questionFindMany.mockResolvedValue([]);
    mocks.questionCount.mockResolvedValue(10);

    const res = await GET(makeGetRequest(), { params: makeParams() });
    const data = await res.json();

    expect(data.reviewedCount).toBeDefined();
    expect(data.reviewProgress).toBeDefined();
    expect(typeof data.reviewProgress).toBe("number");
  });
});

describe("DELETE /api/content-sources/:sourceId/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("deletes all questions and returns count", async () => {
    mocks.questionDeleteMany.mockResolvedValue({ count: 8 });

    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(8);
    expect(mocks.questionDeleteMany).toHaveBeenCalledWith({ where: { sourceId: "src-1" } });
  });
});
