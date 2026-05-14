/**
 * Tests for GET/DELETE /api/content-sources/:sourceId/vocabulary
 *
 * Verifies:
 * - Auth enforcement (VIEWER for GET, OPERATOR for DELETE)
 * - GET returns paginated vocabulary with filtering
 * - DELETE clears vocabulary and returns count
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  vocabularyFindMany: vi.fn(),
  vocabularyCount: vi.fn(),
  vocabularyDeleteMany: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentVocabulary: {
      findMany: mocks.vocabularyFindMany,
      count: mocks.vocabularyCount,
      deleteMany: mocks.vocabularyDeleteMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { GET, DELETE } from "@/app/api/content-sources/[sourceId]/vocabulary/route";
import { NextRequest } from "next/server";

function makeGetRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/content-sources/src-1/vocabulary");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function makeDeleteRequest() {
  return new NextRequest(
    new URL("http://localhost/api/content-sources/src-1/vocabulary"),
    { method: "DELETE" },
  );
}

const makeParams = () => Promise.resolve({ sourceId: "src-1" });

describe("GET /api/content-sources/:sourceId/vocabulary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "VIEWER" } },
    });
    mocks.vocabularyFindMany.mockResolvedValue([]);
    mocks.vocabularyCount.mockResolvedValue(0);
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns empty list when no vocabulary exists", async () => {
    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.vocabulary).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns paginated vocabulary", async () => {
    mocks.vocabularyFindMany.mockResolvedValue([
      { id: "v1", term: "to clash", definition: "to conflict" },
      { id: "v2", term: "to negotiate", definition: "to discuss" },
    ]);
    mocks.vocabularyCount.mockResolvedValue(10);

    const res = await GET(makeGetRequest({ limit: "2", offset: "0" }), { params: makeParams() });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.vocabulary).toHaveLength(2);
    expect(data.total).toBe(10);
  });

  it("filters by topic", async () => {
    const res = await GET(makeGetRequest({ topic: "Negotiation" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.vocabularyFindMany.mock.calls[0][0];
    expect(call.where.topic).toBe("Negotiation");
  });

  it("filters by search across term and definition", async () => {
    const res = await GET(makeGetRequest({ search: "clash" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.vocabularyFindMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR[0].term).toEqual({ contains: "clash", mode: "insensitive" });
    expect(call.where.OR[1].definition).toEqual({ contains: "clash", mode: "insensitive" });
  });

  it("caps limit at 500", async () => {
    const res = await GET(makeGetRequest({ limit: "9999" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.vocabularyFindMany.mock.calls[0][0];
    expect(call.take).toBe(500);
  });

  it("filters by reviewed=true", async () => {
    const res = await GET(makeGetRequest({ reviewed: "true" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.vocabularyFindMany.mock.calls[0][0];
    expect(call.where.reviewedAt).toEqual({ not: null });
  });

  it("filters by reviewed=false", async () => {
    const res = await GET(makeGetRequest({ reviewed: "false" }), { params: makeParams() });
    expect(res.status).toBe(200);

    const call = mocks.vocabularyFindMany.mock.calls[0][0];
    expect(call.where.reviewedAt).toBe(null);
  });

  it("includes reviewedCount and reviewProgress in response", async () => {
    mocks.vocabularyFindMany.mockResolvedValue([]);
    mocks.vocabularyCount.mockResolvedValue(10);

    const res = await GET(makeGetRequest(), { params: makeParams() });
    const data = await res.json();

    expect(data.reviewedCount).toBeDefined();
    expect(data.reviewProgress).toBeDefined();
    expect(typeof data.reviewProgress).toBe("number");
  });
});

describe("DELETE /api/content-sources/:sourceId/vocabulary", () => {
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

  it("deletes all vocabulary and returns count", async () => {
    mocks.vocabularyDeleteMany.mockResolvedValue({ count: 15 });

    const res = await DELETE(makeDeleteRequest(), { params: makeParams() });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(15);
    expect(mocks.vocabularyDeleteMany).toHaveBeenCalledWith({ where: { sourceId: "src-1" } });
  });
});
